import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { openCorrectionLedger } from '../src/conversation-correction-intake.ts'
import { openConversationDraftStore } from '../src/conversation-skill-draft.ts'
import { installConversationSkillDraftMonitor } from '../src/conversation-skill-draft-monitor.ts'
import { openConversationDraftTrialStore } from '../src/conversation-draft-trial-store.ts'
import { installConversationDraftTrialMonitor } from '../src/conversation-draft-trial-monitor.ts'
import { DurableFeedbackAttribution } from '../src/durable-feedback-attribution.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const dshRoot = process.env.DSH_EVOLVE_DSH_SOURCE_DIR

describe.skipIf(dshRoot === undefined)('native feedback-to-draft path', () => {
  it.each(['live', 'cold', 'withdraw-during-author', 'withdraw-before-trial', 'owned-evaluation', 'ownership-unavailable'])('handles %s feedback using native ownership, one shared budget and no classifier', async scenario => {
    const root = await mkdtemp(join(tmpdir(), 'evoforge-message-feedback-'))
    const entry = (path: string) => pathToFileURL(join(dshRoot!, path, 'lib/index.js')).href
    const cordis = await import(entry('vendor/cordis')) as typeof import('@deepseek-ai/cordis')
    const nativeSession = await import(entry('packages/core/session')) as typeof import('@deepseek-ai/dsh-session')
    const nativeLlm = await import(entry('packages/llm/llm')) as typeof import('@deepseek-ai/dsh-llm')
    const calls: GenerateOptions[] = []
    const governance = { scope: 'Private native feedback protocol fixture, not evidence of task improvement.',
      cases: ['h1', 'h2', 'r1', 'r2'].map((id, index) => ({ id, partition: index < 2 ? 'holdout' : 'retention',
        input: `New fixture ${id}: output answer-${id}.`, mustInclude: [`answer-${id}`], mustNotInclude: [], layout: 'any',
        referenceAnswer: `answer-${id}`, alternateAnswer: `Result: answer-${id}`, negativeAnswer: 'wrong' })) }
    const proposal = { status: 'draft', name: 'preserve-conflicts', description: 'Preserve unresolved alternatives in reports.',
      body: 'Preserve each unresolved alternative and its source. Do not choose a value without evidence. Respect explicit user resolutions and leave unrelated tasks unchanged.' }
    let ctx: Context | undefined
    const sessionId = nativeSession.SessionId('session-11111111-1111-4111-8111-111111111111')
    const withdraw = async () => {
      const listed = await ctx!.messageFeedback.list({ sessionId })
      if (!listed.ok || listed.value.items.length !== 1) throw new Error('missing native feedback')
      const item = listed.value.items[0]!
      expect((await ctx!.messageFeedback.delete({ sessionId, messageId: item.messageId, ifVersion: item.version })).ok).toBe(true)
    }
    class FixtureAdapter extends nativeLlm.LlmAdapter {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        calls.push(options)
        let text: string
        if (typeof options.system === 'string' && options.system.startsWith('You prepare independent test material')) {
          expect(options.tools).toBeUndefined()
          text = JSON.stringify(governance)
        } else if (typeof options.system === 'string' && options.system.startsWith('Draft a small reusable DSH Skill')) {
          expect(options.tools).toBeUndefined()
          expect(JSON.stringify(options.messages)).not.toContain('answer-h1')
          expect(JSON.stringify(options.messages)).not.toContain('referenceAnswer')
          if (scenario === 'withdraw-during-author') await withdraw()
          text = JSON.stringify(proposal)
        } else if (String(options.sessionId).startsWith('evoforge-trial-')) {
          const catalog = JSON.stringify(options.messages).includes('preserve-conflicts')
          const loaded = options.messages.some(message => message.content.some(block => block.type === 'tool-result'))
          if (catalog && !loaded) {
            const id = nativeLlm.ToolCallId('feedback-trial-load'), args = JSON.stringify({ name: 'preserve-conflicts' })
            yield { type: 'block-start', index: 0, blockType: 'tool-call' }
            yield { type: 'tool-call-delta', index: 0, id, name: 'skill', argumentsDelta: args }
            yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'skill', arguments: args } }
            yield { type: 'finish', reason: { kind: 'tool-calls' } }
            return
          }
          const task = options.messages.find(message => message.role === 'user' && message.source.kind === 'plugin' && message.source.plugin === 'dsh-evolve')
          text = JSON.stringify(task).match(/answer-(h1|h2|r1|r2)/u)?.[0] ?? 'wrong'
        } else throw new Error('unexpected classifier or auxiliary request')
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'usage', usage: { inputTokens: 21, outputTokens: 9 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    const boot = async (): Promise<Context> => {
      const context = new cordis.Context()
      Object.defineProperty(context, 'workspaceRegistry', { configurable: true, value: { resolveByPath: async () => ({ id: WORKSPACE_ID }) } })
      await context.plugin((await import(entry('packages/storage/storage'))).default)
      await context.plugin(await import(entry('packages/storage/storage-json')), { root: join(root, 'storage') })
      await context.plugin(await import(entry('packages/storage/storage-domain')), { backend: 'json' })
      await context.plugin(nativeSession.default)
      await context.plugin((await import(entry('packages/session/session-persistence-jsonl'))).default, { root: join(root, 'sessions'), compression: 'none' })
      await context.plugin(nativeLlm.default)
      await context.plugin((await import(entry('packages/jobs/jobs-local'))).default)
      await context.plugin((await import(entry('packages/feedback/message-feedback'))).default, { maxNoteBytes: 24_000 })
      await context.plugin((await import(entry('packages/core/agent'))).default)
      await context.plugin((await import(entry('packages/session/session-projection'))).default)
      await context.plugin((await import(entry('packages/core/system-prompt'))).default)
      await context.plugin((await import(entry('packages/core/tools'))).default)
      await context.plugin((await import(entry('packages/skill/skill'))).default)
      await context.plugin((await import(entry('packages/core/agent-loop'))).default, { agents: [] })
      context.llm.registerAdapter(['fixture'], new FixtureAdapter())
      return context
    }
    let writer: { close(): Promise<void> } | undefined
    let ledger: Awaited<ReturnType<typeof openCorrectionLedger>> | undefined
    let drafts: Awaited<ReturnType<typeof openConversationDraftStore>> | undefined
    let trials: Awaited<ReturnType<typeof openConversationDraftTrialStore>> | undefined
    let draftMonitor: ReturnType<typeof installConversationSkillDraftMonitor> | undefined
    let trialMonitor: ReturnType<typeof installConversationDraftTrialMonitor> | undefined
    const policy = [{ workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: 2, explicitFeedbackSessionIds: [sessionId] }]
    const drained = () => vi.waitFor(() => expect(ctx!.jobs.list().every(job => job.status !== 'running' && job.status !== 'stopping')).toBe(true), { timeout: 10_000 })
    try {
      ctx = await boot()
      const session = ctx.sessions.create(sessionId, { meta: { cwd: root } })
      writer = await ctx.sessionPersistence.create(session.header)
      session.append('turn/start', { turn: 1 })
      session.append('step/start', { turn: 1, step: 1 })
      session.append('request/header', { reason: 'initial', header: { config: { provider: 'fixture', model: 'fixture' } } })
      session.append('user/message', nativeLlm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '整理数量6或7尚未确认的订单。' }] }), { surfaceOp: 'append' })
      const answer = '数量7已经确认。', accumulator = new nativeLlm.AssistantStreamAccumulator()
      accumulator.push({ time: 1, chunk: { type: 'text-delta', index: 0, text: answer } })
      accumulator.push({ time: 2, chunk: { type: 'finish', reason: { kind: 'stop' } } })
      const message = nativeLlm.createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: answer }] })
      session.append('assistant/message', { turn: 1, step: 1, stream: [...accumulator.snapshot()], message }, { surfaceOp: 'append' })
      session.append('step/end', { turn: 1, step: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      await ctx.sessions.flush(session)
      const original = JSON.stringify(session.snapshotEvents())
      if (scenario === 'cold') {
        await writer.close(); writer = undefined
        await ctx.fiber.dispose()
        ctx = await boot()
        expect(ctx.sessions.get(sessionId)).toBeUndefined()
      }
      ledger = await openCorrectionLedger(ctx.storageDomain, [])
      drafts = await openConversationDraftStore(ctx.storageDomain, policy)
      draftMonitor = installConversationSkillDraftMonitor(ctx, ledger, drafts, policy, () => {
        if (scenario === 'ownership-unavailable') throw new Error('fixture ownership unavailable')
        return scenario === 'owned-evaluation'
      })
      const result = await ctx.messageFeedback.put({ sessionId, messageId: message.id, rating: 'negative',
        note: '你把尚未确认的数量当成已确认了。请保留6和7两个候选，不要自行选择。', ifVersion: null })
      expect(result.ok).toBe(true)
      if (scenario === 'owned-evaluation' || scenario === 'ownership-unavailable') {
        await drained()
        expect(drafts.records(WORKSPACE_ID)).toEqual([])
        expect(calls).toEqual([])
        expect(ctx.jobs.list()).toEqual([])
        return
      }
      await vi.waitFor(() => expect(drafts!.records(WORKSPACE_ID)[0]?.phase).toBe(scenario === 'withdraw-during-author' ? 'uncertain' : 'draft'), { timeout: 10_000 })
      expect(calls).toHaveLength(2)
      expect(ledger.records(WORKSPACE_ID)).toEqual([])
      const draft = drafts.records(WORKSPACE_ID)[0]!
      expect(draft.messageFeedbackSource?.messageId).toBe(message.id)
      expect(draft.reservedModelCalls).toBe(2)
      if (scenario === 'withdraw-during-author') {
        expect(draft).toMatchObject({ reason: 'source-conflict', modelCalls: 2 })
        expect(draft.usages).toHaveLength(2)
        expect(draft.draft).toBeUndefined()
      }
      await draftMonitor.dispose(); draftMonitor = undefined
      if (scenario === 'withdraw-before-trial') await withdraw()
      trials = await openConversationDraftTrialStore(ctx.storageDomain, [{ workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: 24 }])
      trialMonitor = installConversationDraftTrialMonitor(ctx, ledger, drafts, trials, [{ workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: 24 }])
      if (scenario === 'live' || scenario === 'cold') {
        await vi.waitFor(() => expect(trials!.records(WORKSPACE_ID)[0]?.phase).toBe('completed'), { timeout: 10_000 })
        expect(calls).toHaveLength(14)
        expect(trials.records(WORKSPACE_ID)[0]?.comparison).toMatchObject({ outcome: 'no-improvement', comparablePairs: 4, loadedDraftLegs: 4 })
      }
      await drained()
      await trialMonitor.dispose(); trialMonitor = undefined
      if (scenario.startsWith('withdraw')) {
        expect(trials.records(WORKSPACE_ID)).toEqual([])
        expect(calls).toHaveLength(2)
      }
      const reader = new DurableFeedbackAttribution(ctx.sessionPersistence, { lifecycle: ctx })
      const saved = await reader.readStoredSession(sessionId)
      expect(JSON.stringify(saved.events.filter(event => event.type !== 'feedback/message-put' && event.type !== 'feedback/message-delete'))).toBe(original)
      expect(await ctx.skills.list()).toEqual([])
      const persistedDrafts = drafts.records(WORKSPACE_ID), persistedTrials = trials.records(WORKSPACE_ID), count = calls.length
      await drafts.close(); drafts = undefined
      await trials.close(); trials = undefined
      await ledger.close(); ledger = undefined
      await writer?.close(); writer = undefined
      await ctx.fiber.dispose()
      ctx = await boot()
      ledger = await openCorrectionLedger(ctx.storageDomain, [])
      drafts = await openConversationDraftStore(ctx.storageDomain, policy, () => Date.now() + 86_400_000)
      trials = await openConversationDraftTrialStore(ctx.storageDomain, [{ workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: 24 }])
      draftMonitor = installConversationSkillDraftMonitor(ctx, ledger, drafts, policy)
      await drained()
      await draftMonitor.dispose(); draftMonitor = undefined
      expect(drafts.records(WORKSPACE_ID)).toEqual(persistedDrafts)
      expect(trials.records(WORKSPACE_ID)).toEqual(persistedTrials)
      expect(calls).toHaveLength(count)
      expect(ctx.sessions.get(sessionId)).toBeUndefined()
    } finally {
      await trialMonitor?.dispose()
      await draftMonitor?.dispose()
      await trials?.close()
      await drafts?.close()
      await ledger?.close()
      await writer?.close()
      await ctx?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
