import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import Skills from '@deepseek-ai/dsh-skill'
import { runConversationDraftTrialLeg } from '../src/conversation-draft-trial-native.ts'
import { projectConversationDraftTrialResult, sameTrialInitialComposition } from '../src/conversation-draft-trial-result.ts'
import { installConversationDraftTrialGuard } from '../src/conversation-draft-trial-guard.ts'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { executeConversationDraftTrial } from '../src/conversation-draft-trial-monitor.ts'
import { openConversationDraftTrialStore } from '../src/conversation-draft-trial-store.ts'
import { digest } from '../src/conversation-correction-intake.ts'
import type { ConversationDraftRecord } from '../src/conversation-skill-draft.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

async function fixture(failing = false, respond?: (options: GenerateOptions) => AsyncIterable<StreamChunk>) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Projections)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  await ctx.plugin(Skills)
  await ctx.plugin(AgentLoop, { agents: [] })
  let calls = 0
  const requests: GenerateOptions[] = []
  class Adapter extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      calls++
      requests.push(options)
      if (respond !== undefined) { yield* respond(options); return }
      if (failing) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'fixture failure' } } }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'answer' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'answer' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['fixed'], new Adapter())
  const registrations = ['skill', 'external_write'].map(name => ctx.tools.register(defineTool({
    name, description: name, parameters: {},
    output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'ok' }] },
    execute: async () => 'ok',
  })))
  return { ctx, requests, registrations, calls: () => calls }
}

it('provides the official scoped Skill tool when the Host has no global Skill tool', async () => {
  const f = await fixture()
  f.registrations[0]!()
  const result = await runConversationDraftTrialLeg(f.ctx, {
    sessionId: SessionId('trial-without-global-skill'), cwd: '/repo', input: 'Return an answer.',
    provider: 'fixed', model: 'fixed', signal: new AbortController().signal, beforeDispatch: async () => {},
  })
  expect(result.dispatchMarkers).toBe(1)
  expect(f.calls()).toBe(1)
  expect(f.requests[0]?.tools?.map(tool => tool.name)).toEqual(['skill'])
  expect(f.ctx.tools.get('skill')).toBeUndefined()
})

it('runs an owned native leg, mounts the exact draft only there, and keeps its native trace', async () => {
  const f = await fixture(false, async function* (options) {
    const hasResult = options.messages.some(message => message.content.some(block => block.type === 'tool-result'))
    if (hasResult) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Task result' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Task result' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } else {
      const id = ToolCallId('load-native-skill')
      const args = JSON.stringify({ name: 'item-sections' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'skill', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'skill', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  })
  f.registrations[0]!()
  const source = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(process.cwd(), '../../../deepseek-harness')
  const toolSkill = await import(pathToFileURL(resolve(source, 'packages/skill/tool-skill/lib/index.js')).href)
  await f.ctx.plugin(toolSkill)
  const markdown = '---\nname: item-sections\ndescription: "Use for narrow report layouts"\n---\n\nKeep each item in its own section.\n'
  const draft = { name: 'item-sections', description: 'Use for narrow report layouts', markdown,
    contentHash: createHash('sha256').update(markdown).digest('hex') }
  const result = await runConversationDraftTrialLeg(f.ctx, {
    sessionId: SessionId('native-trial-leg'), cwd: '/repo', input: 'Organize these self-contained facts.',
    provider: 'fixed', model: 'fixed', draft, signal: new AbortController().signal,
    beforeDispatch: async () => {
      expect(await f.ctx.skills.list()).toEqual([])
    },
  })
  expect(result.events.filter(event => event.type === 'turn/end')).toEqual([expect.objectContaining({ data: expect.objectContaining({ reason: { kind: 'completed' } }) })])
  expect(result.dispatchMarkers).toBe(2)
  expect(f.ctx.agents.get(SessionId('native-trial-leg'))).toBeUndefined()
  expect(await f.ctx.skills.list()).toEqual([])
  expect(JSON.stringify(f.requests)).toContain('item-sections')
  expect(JSON.stringify(f.requests[0])).not.toContain('Keep each item in its own section.')
  expect(JSON.stringify(f.requests[1])).toContain('Keep each item in its own section.')
  expect(JSON.stringify(result.events.filter(event => event.type === 'tool/result'))).toContain('evoforge-conversation-draft-trial')
  const projected = projectConversationDraftTrialResult(result, {
    mustInclude: ['Task result'], mustNotInclude: [], layout: 'any',
  }, draft)
  expect(projected).toMatchObject({ status: 'completed', passed: true, skillLoaded: true, requestCount: 2, usageMissingCount: 2 })
  const baseline = await runConversationDraftTrialLeg(f.ctx, {
    sessionId: SessionId('native-trial-baseline'), cwd: '/repo', input: 'Organize these self-contained facts.',
    provider: 'fixed', model: 'fixed', signal: new AbortController().signal, beforeDispatch: async () => {},
  })
  expect(sameTrialInitialComposition(baseline.requestSnapshots[0], result.requestSnapshots[0], draft)).toBe(true)
  expect(sameTrialInitialComposition(baseline.requestSnapshots[0]?.replace('Organize', 'Summarize'), result.requestSnapshots[0], draft)).toBe(false)
  expect(projectConversationDraftTrialResult(baseline, {
    mustInclude: ['Task result'], mustNotInclude: [], layout: 'any',
  })).toMatchObject({ status: 'incomplete', passed: false, skillLoaded: false })
})

it('restricts only its new native Session and persists the marker before dispatch', async () => {
  const f = await fixture()
  const markers: number[] = []
  const handle = await f.ctx.agents.create({
    sessionId: SessionId('guarded'), agentOptions: { provider: 'fixed', model: 'fixed', maxTokens: 2000 },
    async setup(scoped, agent) {
      await installConversationDraftTrialGuard(scoped, agent, {
        provider: 'fixed', model: 'fixed', maxCalls: 1, maxTokens: 2000,
        beforeDispatch: async call => { expect(f.calls()).toBe(0); markers.push(call) },
      })
    },
  })
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'task' }], source: { kind: 'plugin', plugin: 'dsh-evolve' } }))
  await handle.agent.whenIdle()
  expect(f.calls()).toBe(1)
  expect(markers).toEqual([1])
  expect(f.ctx.tools.schemas(handle.agent).map(tool => tool.name)).toEqual(['skill'])
  expect(f.ctx.tools.schemas().map(tool => tool.name)).toEqual(['skill', 'external_write'])
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'extra turn' }], source: { kind: 'plugin', plugin: 'dsh-evolve' } }))
  await handle.agent.whenIdle()
  expect(f.calls()).toBe(1)
  await handle.dispose()
  expect(f.ctx.agents.get(SessionId('guarded'))).toBeUndefined()
})

it('does not enter an earlier global retry policy on provider failure', async () => {
  const f = await fixture(true)
  let retries = 0
  f.ctx.on('agent/request-error', async () => { retries++; return retries < 3 ? { kind: 'retry' } : undefined })
  const handle = await f.ctx.agents.create({
    sessionId: SessionId('no-retry'), agentOptions: { provider: 'fixed', model: 'fixed', maxTokens: 2000 },
    async setup(scoped, agent) {
      await installConversationDraftTrialGuard(scoped, agent, {
        provider: 'fixed', model: 'fixed', maxCalls: 3, maxTokens: 2000, beforeDispatch: async () => {},
      })
    },
  })
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'task' }], source: { kind: 'plugin', plugin: 'dsh-evolve' } }))
  await handle.agent.whenIdle()
  expect(f.calls()).toBe(1)
  expect(retries).toBe(0)
  await handle.dispose()
})

it('dispatches nothing when the durable marker fails', async () => {
  const f = await fixture()
  const handle = await f.ctx.agents.create({
    sessionId: SessionId('write-failure'), agentOptions: { provider: 'fixed', model: 'fixed', maxTokens: 2000 },
    async setup(scoped, agent) {
      await installConversationDraftTrialGuard(scoped, agent, {
        provider: 'fixed', model: 'fixed', maxCalls: 3, maxTokens: 2000,
        beforeDispatch: async () => { throw new Error('storage unavailable') },
      })
    },
  })
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'task' }], source: { kind: 'plugin', plugin: 'dsh-evolve' } }))
  await handle.agent.whenIdle()
  expect(f.calls()).toBe(0)
  await handle.dispose()
})

it('caps a native tool loop at three provider calls rather than just limiting turns', async () => {
  let id = 0
  const f = await fixture(false, async function* () {
    const callId = ToolCallId(`loop-${++id}`)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id: callId, name: 'skill', argumentsDelta: '{}' }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'skill', arguments: '{}' } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  })
  const markers: number[] = []
  const result = await runConversationDraftTrialLeg(f.ctx, {
    sessionId: SessionId('native-three-calls'), cwd: '/repo', input: 'Self-contained task', provider: 'fixed', model: 'fixed',
    signal: new AbortController().signal, beforeDispatch: async call => { markers.push(call) },
  })
  expect(f.calls()).toBe(3)
  expect(markers).toEqual([1, 2, 3])
  expect(result.events.filter(event => event.type === 'turn/end')).not.toEqual([
    expect.objectContaining({ data: expect.objectContaining({ reason: { kind: 'completed' } }) }),
  ])
})

it('rejects same-schema tool replacement after a durable dispatch marker', async () => {
  const f = await fixture()
  const handle = await f.ctx.agents.create({
    sessionId: SessionId('tool-shadow'), agentOptions: { provider: 'fixed', model: 'fixed', maxTokens: 2000 },
    async setup(scoped, agent) {
      await installConversationDraftTrialGuard(scoped, agent, {
        provider: 'fixed', model: 'fixed', maxCalls: 3, maxTokens: 2000,
        beforeDispatch: async () => {
          scoped.tools.register(defineTool({
            name: 'skill', description: 'skill', parameters: {},
            output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'ok' }] },
            execute: async () => 'ok',
          }))
        },
      })
    },
  })
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'task' }], source: { kind: 'plugin', plugin: 'dsh-evolve' } }))
  await handle.agent.whenIdle()
  expect(f.calls()).toBe(0)
  await handle.dispose()
})

it('rejects changed provider settings before recording or dispatching a call', async () => {
  const f = await fixture()
  let markers = 0
  f.ctx.on('agent/request', async (_payload, next) => ({ ...await next(), maxTokens: 2001 }))
  await runConversationDraftTrialLeg(f.ctx, {
    sessionId: SessionId('route-drift'), cwd: '/repo', input: 'Self-contained task', provider: 'fixed', model: 'fixed',
    signal: new AbortController().signal, beforeDispatch: async () => { markers++ },
  })
  expect(f.calls()).toBe(0)
  expect(markers).toBe(0)
})

it('cancels between the durable marker and dispatch without entering the provider', async () => {
  const f = await fixture()
  const controller = new AbortController()
  const result = await runConversationDraftTrialLeg(f.ctx, {
    sessionId: SessionId('cancel-before-provider'), cwd: '/repo', input: 'Self-contained task', provider: 'fixed', model: 'fixed',
    signal: controller.signal, beforeDispatch: async () => { controller.abort() },
  })
  expect(f.calls()).toBe(0)
  expect(result.dispatchMarkers).toBe(1) // conservative committed reservation, not measured provider use
  expect(result.requestSnapshots).toEqual([])
  expect(f.ctx.agents.get(SessionId('cancel-before-provider'))).toBeUndefined()
})

it('does not run with an unavailable Skill dependency', async () => {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Projections)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  await ctx.plugin(AgentLoop, { agents: [] })
  await expect(runConversationDraftTrialLeg(ctx, {
    sessionId: SessionId('missing-skills'), cwd: '/repo', input: 'Self-contained task', provider: 'fixed', model: 'fixed',
    signal: new AbortController().signal, beforeDispatch: async () => { throw new Error('must not dispatch') },
  })).rejects.toThrow('dependencies unavailable')
  expect(ctx.agents.get(SessionId('missing-skills'))).toBeUndefined()
})

it('finishes all eight native legs, retains equal outcomes, and never converts them to improvement', async () => {
  const f = await fixture(false, async function* (options) {
    const catalog = JSON.stringify(options.messages).includes('item-sections')
    const loaded = options.messages.some(message => message.content.some(block => block.type === 'tool-result'))
    if (catalog && !loaded) {
      const id = ToolCallId('pair-load')
      const args = JSON.stringify({ name: 'item-sections' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'skill', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'skill', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Preserved fact' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Preserved fact' } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  f.registrations[0]!()
  const sourceRoot = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(process.cwd(), '../../../deepseek-harness')
  await f.ctx.plugin(await import(pathToFileURL(resolve(sourceRoot, 'packages/skill/tool-skill/lib/index.js')).href))
  // Resolver fixture only; the Agent, loop, scoped Skill and tool dispatch are native.
  f.ctx.provide('workspaceRegistry', { resolveByPath: async () => ({ id: WORKSPACE_ID }) })
  const rows = new Map<string, unknown>()
  const facility = { async open() { return { close: async () => {}, table: () => ({
    get size() { return rows.size }, get: (key: string) => structuredClone(rows.get(key)), entries: () => [...rows],
    put: async (key: string, value: unknown) => { rows.set(key, structuredClone(value)) },
  }) } } } as unknown as DomainFacility
  const store = await openConversationDraftTrialStore(facility, [{ workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: 24 }])
  const markdown = '---\nname: item-sections\ndescription: "Use short sections for reports"\n---\n\nPreserve every fact and explicit choice.\n'
  const governance = { scope: 'Fixture-only self-contained preservation checks.',
    cases: ['h1', 'h2', 'r1', 'r2'].map((id, index) => ({ id, partition: index < 2 ? 'holdout' as const : 'retention' as const,
      input: `Task ${id}: preserve this stated fact.`, mustInclude: ['Preserved fact'], mustNotInclude: ['invented'],
      layout: 'any' as const, referenceAnswer: 'Preserved fact', alternateAnswer: 'Preserved fact.', negativeAnswer: 'invented' })) }
  const source: ConversationDraftRecord = {
    schemaVersion: 1, id: 'a'.repeat(64), workspaceId: WORKSPACE_ID, correctionId: 'b'.repeat(64), sourceDigest: 'c'.repeat(64),
    sourceSessionId: 'original-user-session', sourceTurn: 3, inputDigest: 'd'.repeat(64), reservedAt: 100,
    reservedModelCalls: 2, modelCalls: 2, usages: [], phase: 'draft', governance, governanceDigest: digest(governance),
    draft: { name: 'item-sections', description: 'Use short sections for reports', markdown,
      contentHash: createHash('sha256').update(markdown).digest('hex'), lifecycle: 'inactive', verification: 'unevaluated', releaseAuthority: 'none' },
  }
  const initial = (await store.reserve(source, { provider: 'fixed', model: 'fixed' }))!
  const completed = await executeConversationDraftTrial(f.ctx, store, initial, source, '/repo', new AbortController().signal, () => true)
  expect(completed.phase).toBe('completed')
  expect(completed.comparison).toEqual({ baselinePassed: 4, draftPassed: 4, improved: 0, regressed: 0,
    comparablePairs: 4, loadedDraftLegs: 4, outcome: 'no-improvement' })
  expect(f.calls()).toBe(12)
  expect(await f.ctx.skills.list()).toEqual([])
  for (const leg of completed.legs) expect(f.ctx.agents.get(SessionId(leg.sessionId))).toBeUndefined()
  const publicView = JSON.stringify(store.summarize(WORKSPACE_ID))
  expect(publicView).not.toContain('Task h1')
  expect(publicView).not.toContain('Preserved fact')
  await store.close()
  const reopened = await openConversationDraftTrialStore(facility, [])
  expect(reopened.records(WORKSPACE_ID)[0]).toEqual(completed)
  expect(source.draft?.lifecycle).toBe('inactive')
})
