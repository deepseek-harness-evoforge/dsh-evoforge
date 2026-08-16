import { Context } from '@deepseek-ai/cordis'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as DeliveryPlugin from '../src/index.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')

describe.skipIf(process.platform !== 'darwin')('assembled DSH software-delivery Skill', () => {
  it('loads through the native Skill tool in a real Agent while preserving one stable model surface', async () => {
    const sourcePackage = (path: string) => pathToFileURL(
      join(dshSourceDir, 'packages', path, 'lib', 'index.js'),
    ).href
    const [llm, session, systemPrompt, tools, skill, toolSkill, agent, goal, agentLoop] = await Promise.all([
      import(sourcePackage('llm/llm')),
      import(sourcePackage('core/session')),
      import(sourcePackage('core/system-prompt')),
      import(sourcePackage('core/tools')),
      import(sourcePackage('skill/skill')),
      import(sourcePackage('skill/tool-skill')),
      import(sourcePackage('core/agent')),
      import(sourcePackage('goal/goal')),
      import(sourcePackage('core/agent-loop')),
    ])
    const ctx = new Context()
    await ctx.plugin(llm.default)
    await ctx.plugin(session.default)
    await ctx.plugin(systemPrompt.default, { persona: 'Stable delivery fixture.' })
    await ctx.plugin(tools.default)
    await ctx.plugin(skill.default)
    const deliveryFiber = await ctx.plugin(DeliveryPlugin)
    await ctx.plugin(toolSkill)
    await ctx.plugin(agent.default)
    await ctx.plugin(goal.default)
    await ctx.plugin(agentLoop.default, { agents: [] })

    class ScriptedAdapter extends llm.LlmAdapter {
      readonly requests: unknown[] = []

      resolveModel(provider: string, model: string) {
        return Promise.resolve({ provider, id: model, name: model })
      }

      async * stream(options: unknown) {
        this.requests.push(structuredClone(options))
        if (this.requests.length === 1) {
          const callId = llm.CallId('load-delivery')
          const input = '{"name":"software-delivery"}'
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id: callId, name: 'skill', argumentsDelta: input }
          yield {
            type: 'block-end',
            index: 0,
            block: { type: 'tool-call', id: callId, name: 'skill', arguments: input },
          }
          yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'delivery skill loaded' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'delivery skill loaded' } }
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }

    const adapter = new ScriptedAdapter()
    const llmService = ctx.get('llm') as { registerAdapter(routes: string[], adapter: unknown): void } | undefined
    const agentService = ctx.get('agents') as {
      create(options: unknown): Promise<{
        agent: { followup(message: unknown): void; whenIdle(): Promise<void> }
      }>
    } | undefined
    if (llmService === undefined || agentService === undefined) throw new Error('native Agent runtime missing')
    llmService.registerAdapter(['delivery-fixture'], adapter)
    const handle = await agentService.create({
      sessionId: session.SessionId('dsh-software-delivery-assembled'),
      agentOptions: { provider: 'delivery-fixture', model: 'delivery-fixture' },
      meta: { cwd: suiteRoot },
    })
    handle.agent.followup(llm.createUserMessage({
      content: [{ type: 'text', text: 'Deliver this software change.' }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    const first = requestView(adapter.requests[0])
    const second = requestView(adapter.requests[1])
    expect(JSON.stringify(first.messages)).toContain('software-delivery')
    expect(JSON.stringify(first.messages)).not.toContain('Use the native DSH Goal')
    expect(JSON.stringify(second.messages)).toContain('<skill_content name=\\"software-delivery\\">')
    expect(JSON.stringify(second.messages)).toContain('Use the native DSH Goal')
    expect(second.tools).toEqual(first.tools)
    expect(ctx.get('goals')).toBeDefined()

    await deliveryFiber.dispose()
    expect(await ctx.skills.get('software-delivery')).toBeUndefined()
    await ctx.fiber.dispose()
  }, 30_000)
})

function requestView(value: unknown): { messages: unknown[]; tools: unknown[] } {
  if (typeof value !== 'object' || value === null) throw new Error('adapter request missing')
  const request = value as { messages?: unknown; tools?: unknown }
  if (!Array.isArray(request.messages) || !Array.isArray(request.tools)) {
    throw new Error('adapter request has no messages/tools arrays')
  }
  return { messages: request.messages, tools: request.tools }
}
