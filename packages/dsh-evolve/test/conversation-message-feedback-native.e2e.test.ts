import { chmod, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { openCorrectionLedger } from '../src/conversation-correction-intake.ts'
import { openConversationDraftStore, type ConversationDraftRecord, type ConversationLearningPolicy } from '../src/conversation-skill-draft.ts'
import { installConversationSkillDraftMonitor } from '../src/conversation-skill-draft-monitor.ts'
import { openConversationDraftTrialStore, type ConversationDraftTrialRecord } from '../src/conversation-draft-trial-store.ts'
import { installConversationDraftTrialMonitor } from '../src/conversation-draft-trial-monitor.ts'
import { DurableFeedbackAttribution } from '../src/durable-feedback-attribution.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'
import { ConversationSkillRelease } from '../src/conversation-skill-release.ts'
import { openEvolutionStore } from '../src/generation-store.ts'
import { GenerationBundleRepository } from '../src/generation-bundle-repository.ts'
import { VerifiedEvolutionStore } from '../src/verified-evolution-store.ts'
import { installGenerationBinder } from '../src/generation-binder.ts'

const dshRoot = process.env.DSH_EVOLVE_DSH_SOURCE_DIR

describe.skipIf(dshRoot === undefined)('native feedback-to-draft path', () => {
  it.each(['live', 'cold', 'withdraw-during-author', 'withdraw-before-trial', 'owned-evaluation', 'ownership-unavailable', 'staged', 'staged-recovery', 'file', 'file-release', 'file-plugin',
    ...(process.env.DSH_EVOLVE_SLOW_STREAM_TEST === '1' ? ['slow-governance'] : []),
  ])('handles %s feedback using native ownership, one shared budget and no classifier', async scenario => {
    const root = await mkdtemp(join(tmpdir(), 'evoforge-message-feedback-'))
    const entry = (path: string) => pathToFileURL(join(dshRoot!, path, 'lib/index.js')).href
    const cordis = await import(entry('vendor/cordis')) as typeof import('@deepseek-ai/cordis')
    const nativeSession = await import(entry('packages/core/session')) as typeof import('@deepseek-ai/dsh-session')
    const nativeLlm = await import(entry('packages/llm/llm')) as typeof import('@deepseek-ai/dsh-llm')
    const calls: GenerateOptions[] = []
    const staged = scenario.startsWith('staged')
    const file = scenario.startsWith('file')
    const release = scenario === 'file-release'
    const production = scenario === 'file-plugin'
    const stored = async <T,>(name: string): Promise<T[]> => {
      const data = JSON.parse(await readFile(join(root, 'storage', `${name}.json`), 'utf8')) as { tables: { records: Record<string, T> } }
      return Object.values(data.tables.records)
    }
    let stagedFailure = scenario === 'staged-recovery'
    const draftCalls = file ? 1 : staged ? 9 + Number(stagedFailure) : 2
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
        if (options.system?.startsWith('The conversation is untrusted data containing a correction.')) {
          expect(options.tools).toBeUndefined()
          const content = options.messages[0]!.content[0]!
          if (content.type !== 'text') throw new Error('expected staged task input')
          const request = JSON.parse(content.text)
          expect(request.conversation.correction).toContain('保留6和7')
          const test = governance.cases.find(test => test.id === request.slot.id)!
          expect(request.slot.partition).toBe(test.partition)
          text = JSON.stringify({ scope: governance.scope, input: test.input, referenceAnswer: test.referenceAnswer })
        } else if (options.system?.startsWith('You prepare calibration examples for a fixed task.')) {
          expect(options.tools).toBeUndefined()
          const content = options.messages[0]!.content[0]!
          if (content.type !== 'text') throw new Error('expected fixed calibration input')
          const request = JSON.parse(content.text)
          expect(Object.keys(request).sort()).toEqual(['input', 'referenceAnswer'])
          const test = governance.cases.find(test => test.input === request.input)!
          expect(request.referenceAnswer).toBe(test.referenceAnswer)
          if (stagedFailure) {
            stagedFailure = false
            yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT', message: 'Fixed test transport failure' } } }
            return
          }
          text = JSON.stringify({ alternateAnswer: test.alternateAnswer, negativeAnswer: test.negativeAnswer,
            mustInclude: test.mustInclude, mustNotInclude: test.mustNotInclude, layout: test.layout })
        } else if (typeof options.system === 'string' && options.system.startsWith('You prepare independent test material')) {
          expect(options.tools).toBeUndefined()
          text = JSON.stringify(governance)
        } else if (typeof options.system === 'string' && options.system.startsWith('Draft a small reusable DSH Skill')) {
          expect(options.tools).toBeUndefined()
          expect(JSON.stringify(options.messages)).not.toContain('answer-h1')
          expect(JSON.stringify(options.messages)).not.toContain('referenceAnswer')
          if (scenario === 'withdraw-during-author') await withdraw()
          text = JSON.stringify(proposal)
        } else if (String(options.sessionId).startsWith('evoforge-trial-') || String(options.sessionId).startsWith('future-file-')) {
          const catalog = JSON.stringify(options.messages).includes('preserve-conflicts')
          if (file && String(options.sessionId).startsWith('evoforge-trial-')) {
            const source = production ? (await stored<ConversationDraftRecord>('evoforge_conversation_skill_drafts')).at(-1)! : drafts!.records(WORKSPACE_ID).at(-1)!
            const plan = production ? (await stored<ConversationDraftTrialRecord>('evoforge_conversation_draft_trials'))[0]! : trials!.records(WORKSPACE_ID)[0]!
            const leg = plan.legs.find(leg => leg.sessionId === options.sessionId)!
            const test = source.fileWorkflow!.cases.find(test => test.id === leg.caseId)!
            const folder = `.evoforge/workflow-trials/${plan.id}/${leg.index}`
            const output = release && !catalog && leg.partition === 'holdout' ? { wrong: true } : test.expected
            const actions: { name: string; args: unknown }[] = [
              ...(catalog ? [{ name: 'skill', args: { name: 'preserve-conflicts' } }] : []),
              ...test.files.map(input => ({ name: 'read', args: { file_path: `${folder}/${input.path}` } })),
              { name: 'write', args: { file_path: `${folder}/result.json`, content: JSON.stringify(output, null, 2) } },
              { name: 'read', args: { file_path: `${folder}/result.json` } },
              { name: 'present', args: { files: [{ path: `${folder}/result.json` }] } },
            ]
            const previous = options.messages.flatMap(message => message.content.filter(block => block.type === 'tool-call')).length
            const action = actions[previous]
            if (action !== undefined) {
              const id = nativeLlm.ToolCallId(`file-step-${previous}`), args = JSON.stringify(action.args)
              yield { type: 'block-start', index: 0, blockType: 'tool-call' }
              yield { type: 'tool-call-delta', index: 0, id, name: action.name, argumentsDelta: args }
              yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: action.name, arguments: args } }
              yield { type: 'usage', usage: { inputTokens: 21, outputTokens: 9 } }
              yield { type: 'finish', reason: { kind: 'tool-calls' } }
              return
            }
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text: '已交付。' }
            yield { type: 'block-end', index: 0, block: { type: 'text', text: '已交付。' } }
            yield { type: 'usage', usage: { inputTokens: 21, outputTokens: 9 } }
            yield { type: 'finish', reason: { kind: 'stop' } }
            return
          }
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
        if (scenario === 'slow-governance' && options.system?.startsWith('You prepare independent test material')) {
          // Opt-in wall-clock integration: a real native Job/adapter remains
          // productive beyond the previous total deadline, without paid calls.
          const width = Math.ceil(text.length / 5)
          for (let part = 0; part < 5; part++) {
            await delay(15_000, undefined, { signal: options.signal })
            yield { type: 'text-delta', index: 0, text: text.slice(part * width, (part + 1) * width) }
          }
        } else yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'usage', usage: { inputTokens: 21, outputTokens: 9 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    const boot = async (): Promise<Context> => {
      const context = new cordis.Context()
      context.provide('workspaceRegistry', { resolveByPath: async () => ({ id: WORKSPACE_ID }) })
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
      if (file) {
        await context.plugin((await import(entry('packages/sandbox/sandbox-policy'))).default, { mode: 'workspace-write' })
        await context.plugin((await import(entry(production ? 'packages/fs/fs-sandbox' : 'packages/fs/fs-local'))).default)
      }
      context.llm.registerAdapter(['fixture'], new FixtureAdapter())
      return context
    }
    let writer: { close(): Promise<void> } | undefined
    let ledger: Awaited<ReturnType<typeof openCorrectionLedger>> | undefined
    let drafts: Awaited<ReturnType<typeof openConversationDraftStore>> | undefined
    let trials: Awaited<ReturnType<typeof openConversationDraftTrialStore>> | undefined
    let draftMonitor: ReturnType<typeof installConversationSkillDraftMonitor> | undefined
    let trialMonitor: ReturnType<typeof installConversationDraftTrialMonitor> | undefined
    let generationStore: Awaited<ReturnType<typeof openEvolutionStore>> | undefined
    let stopBinder: (() => Promise<void>) | undefined
    let releaseGate: ConversationSkillRelease | undefined
    let policy: ConversationLearningPolicy[] = [{ workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: staged ? 20 : 2,
      ...(file ? { testPreparation: 'file-records-v1' as const } : staged ? { testPreparation: 'staged-v1' as const } : {}), explicitFeedbackSessionIds: [sessionId] }]
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
      if (production) {
        // Exercise the actual Cordis consumer, not only monitors installed on a
        // root Context (which bypasses declared-dependency enforcement).
        await ctx.plugin(await import('../src/index.ts'), { conversationLearningPolicies: policy,
          conversationDraftTrialPolicies: [{ workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: 1000 }] })
        expect((await ctx.messageFeedback.put({ sessionId, messageId: message.id, rating: 'negative',
          note: '你把尚未确认的数量当成已确认了。请保留6和7两个候选，不要自行选择。', ifVersion: null })).ok).toBe(true)
        await vi.waitFor(async () => {
          const records = await stored<ConversationDraftTrialRecord>('evoforge_conversation_draft_trials')
          expect(records[0]?.phase).toBe('completed')
        }, { timeout: 10_000 })
        const record = (await stored<ConversationDraftTrialRecord>('evoforge_conversation_draft_trials'))[0]!
        expect(record.comparison).toMatchObject({ outcome: 'no-improvement', baselinePassed: 4, draftPassed: 4, comparablePairs: 4 })
        expect(record.legs.every(leg => leg.result?.fileResult?.deliveryPassed)).toBe(true)
        expect(calls).toHaveLength(47)
        expect(await ctx.skills.list()).toEqual([])
        return
      }
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
      if (scenario === 'staged-recovery') {
        await vi.waitFor(() => expect(drafts!.records(WORKSPACE_ID)[0]?.phase).toBe('uncertain'))
        await drained()
        const failed = drafts.records(WORKSPACE_ID)[0]!
        expect(failed).toMatchObject({ reason: 'provider-error', modelCalls: 5, reservedModelCalls: 9 })
        expect(failed.preparationSteps).toHaveLength(4)
        await draftMonitor.dispose(); draftMonitor = undefined
        await drafts.close()
        policy = [{ ...policy[0]!, retryFailedDrafts: [{ draftId: failed.id, expiresAt: Date.now() + 60_000 }] }]
        drafts = await openConversationDraftStore(ctx.storageDomain, policy)
        draftMonitor = installConversationSkillDraftMonitor(ctx, ledger, drafts, policy)
        await vi.waitFor(() => expect(drafts!.records(WORKSPACE_ID).find(r => r.retryOf === failed.id)?.phase).toBe('draft'))
        expect(drafts.records(WORKSPACE_ID).find(r => r.id === failed.id)).toEqual(failed)
        const recovered = drafts.records(WORKSPACE_ID).find(r => r.retryOf === failed.id)!
        expect(recovered).toMatchObject({ preparationInheritedCount: 4, reservedModelCalls: 5, modelCalls: 5 })
        expect(recovered.preparationSteps?.slice(0, 4)).toEqual(failed.preparationSteps)
      }
      await vi.waitFor(() => expect(drafts!.records(WORKSPACE_ID).at(-1)?.phase).toBe(scenario === 'withdraw-during-author' ? 'uncertain' : 'draft'), { timeout: scenario === 'slow-governance' ? 90_000 : 10_000 })
      expect(calls).toHaveLength(draftCalls)
      expect(ledger.records(WORKSPACE_ID)).toEqual([])
      const draft = drafts.records(WORKSPACE_ID).at(-1)!
      expect(draft.messageFeedbackSource?.messageId).toBe(message.id)
      expect(draft.reservedModelCalls).toBe(file ? 1 : staged ? scenario === 'staged-recovery' ? 5 : 9 : 2)
      if (staged) {
        expect(draft.governance).toEqual(governance)
        expect(draft.requestTimings).toHaveLength(draft.modelCalls)
        expect(draft.requestTimings!.map(t => t.requestIndex)).toEqual(Array.from({ length: draft.modelCalls }, (_, index) => index))
      }
      if (scenario === 'withdraw-during-author') {
        expect(draft).toMatchObject({ reason: 'source-conflict', modelCalls: 2 })
        expect(draft.usages).toHaveLength(2)
        expect(draft.draft).toBeUndefined()
      }
      await draftMonitor.dispose(); draftMonitor = undefined
      if (scenario === 'withdraw-before-trial') await withdraw()
      const trialPolicy = [{ workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: file ? 1000 : 24 }]
      trials = await openConversationDraftTrialStore(ctx.storageDomain, trialPolicy)
      generationStore = await openEvolutionStore(ctx.storageDomain)
      const bundles = new GenerationBundleRepository(join(root, 'generation-cache'))
      const verifiedStore = new VerifiedEvolutionStore(generationStore, bundles)
      stopBinder = installGenerationBinder(ctx, verifiedStore, bundles)
      trialMonitor = installConversationDraftTrialMonitor(ctx, ledger, drafts, trials, trialPolicy, verifiedStore)
      if (scenario === 'live' || scenario === 'cold' || scenario === 'slow-governance' || staged || file) {
        await vi.waitFor(() => expect(trials!.records(WORKSPACE_ID)[0]?.phase).toBe('completed'), { timeout: 10_000 })
        expect(calls).toHaveLength(draftCalls + (file ? 46 : 12))
        expect(trials.records(WORKSPACE_ID)[0]?.comparison).toMatchObject({ outcome: release ? 'improvement-observed' : 'no-improvement', comparablePairs: 4, loadedDraftLegs: 4 })
        if (file) {
          expect(trials.records(WORKSPACE_ID)[0]?.comparison).toMatchObject({ baselinePassed: release ? 2 : 4, draftPassed: 4 })
          expect(trials.records(WORKSPACE_ID)[0]?.legs.every(leg => leg.result?.fileResult?.deliveryPassed)).toBe(true)
          expect(trials.summarize(WORKSPACE_ID).items[0]?.fileArtifacts).toHaveLength(8)
          expect(trials.summarize(WORKSPACE_ID).items[0]?.fileArtifacts?.[0]?.outputs[0]?.content).toBeDefined()
          expect(trials.summarize(WORKSPACE_ID).items[0]?.fileEvaluation?.version).toBe('file-records-v1')
        }
      }
      await drained()
      await trialMonitor.dispose(); trialMonitor = undefined
      if (file) {
        const trial = trials.records(WORKSPACE_ID)[0]!
        releaseGate = new ConversationSkillRelease(ctx, { corrections: ledger, drafts, trials, store: verifiedStore, bundles })
        const sourceIdentity = { workspaceId: WORKSPACE_ID, sessionId, createdAt: session.header.createdAt, cwd: root }
        await verifiedStore.pinSession(sourceIdentity)
        if (!release) {
          await expect(releaseGate.enable(WORKSPACE_ID, trial.id, draft.draft!.contentHash, 0)).rejects.toThrow('blocked')
        } else {
          expect(await releaseGate.eligibility(WORKSPACE_ID, trial.id)).toMatchObject({ status: 'eligible', selectionSequence: 0 })
          for (const mutate of [
            (copy: typeof trial) => { delete copy.fileEvaluation },
            (copy: typeof trial) => { delete copy.baseline },
            (copy: typeof trial) => { copy.comparison!.improved = 0 },
            (copy: typeof trial) => { copy.legs[1]!.result!.fileEvidence!.outputs[0]!.content = '{"fake":true}' },
            (copy: typeof trial) => { copy.legs[1]!.result!.fileResult!.checks[0]!.passed = false },
            (copy: typeof trial) => { copy.legs[1]!.result!.fileEvidence!.inputs[0]!.read = false },
            (copy: typeof trial) => { copy.legs[1]!.result!.fileEvidence!.outputs[0]!.readBack = false },
            (copy: typeof trial) => { copy.legs[1]!.result!.skillLoaded = false },
            (copy: typeof trial) => { copy.legs[5]!.result!.passed = false },
          ]) {
            const copy = structuredClone(trial)
            mutate(copy)
            const denied = new ConversationSkillRelease(ctx, { corrections: ledger, drafts,
              trials: { records: () => [copy], policy: () => trialPolicy[0] }, store: verifiedStore, bundles })
            try { await expect(denied.enable(WORKSPACE_ID, trial.id, draft.draft!.contentHash, 0)).rejects.toThrow('blocked') }
            finally { await denied.close() }
            expect(verifiedStore.getActiveGeneration(WORKSPACE_ID)).toBeUndefined()
          }
          const enabled = await releaseGate.enable(WORKSPACE_ID, trial.id, draft.draft!.contentHash, 0)
          expect(verifiedStore.getSessionGeneration(sourceIdentity)).toBeUndefined()
          const future = await ctx.agents.create({ sessionId: nativeSession.SessionId('future-file-enabled'),
            meta: { cwd: root }, agentOptions: { provider: 'fixture', model: 'fixture' },
            async setup(scoped) { await scoped.plugin(await import(entry('packages/skill/tool-skill'))) },
          })
          const futureIdentity = { workspaceId: WORKSPACE_ID, sessionId: 'future-file-enabled', createdAt: future.agent.session.header.createdAt, cwd: root }
          try {
            future.agent.followup(nativeLlm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'A new fixture task.' }] }))
            await future.agent.whenIdle()
            expect(future.agent.session.snapshotEvents().filter(e => e.type === 'tool/call').map(e => e.data.name)).toEqual(['skill'])
            expect(JSON.stringify(future.agent.session.snapshotEvents().filter(e => e.type === 'tool/result'))).toContain(proposal.body)
            expect(verifiedStore.getSessionGeneration(futureIdentity)?.id).toBe(enabled.generation.id)
            await expect(releaseGate.disable(WORKSPACE_ID, '0'.repeat(64))).rejects.toThrow('changed')
            await releaseGate.disable(WORKSPACE_ID, enabled.generation.id)
            expect(verifiedStore.getActiveGeneration(WORKSPACE_ID)).toBeUndefined()
            expect(verifiedStore.getSessionGeneration(futureIdentity)?.id).toBe(enabled.generation.id)
          } finally { await future.dispose() }
          const rolledBack = await ctx.agents.create({ sessionId: nativeSession.SessionId('future-file-rolled-back'),
            meta: { cwd: root }, agentOptions: { provider: 'fixture', model: 'fixture' },
            async setup(scoped) { await scoped.plugin(await import(entry('packages/skill/tool-skill'))) },
          })
          try {
            rolledBack.agent.followup(nativeLlm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'A second new fixture task.' }] }))
            await rolledBack.agent.whenIdle()
            expect(rolledBack.agent.session.snapshotEvents().filter(e => e.type === 'tool/call')).toEqual([])
          } finally { await rolledBack.dispose() }
          expect(verifiedStore.listGenerationSelectionEvents(WORKSPACE_ID).map(e => e.kind)).toEqual(['promotion', 'rollback'])
        }
        await releaseGate.close(); releaseGate = undefined
      }
      await stopBinder(); stopBinder = undefined
      await generationStore.close(); generationStore = undefined
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
      generationStore = await openEvolutionStore(ctx.storageDomain)
      expect(generationStore.listGenerationSelectionEvents(WORKSPACE_ID)).toHaveLength(release ? 2 : 0)
      expect(generationStore.getActiveGeneration(WORKSPACE_ID)).toBeUndefined()
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
      await releaseGate?.close()
      await stopBinder?.()
      await generationStore?.close()
      await trialMonitor?.dispose()
      await draftMonitor?.dispose()
      await trials?.close()
      await drafts?.close()
      await ledger?.close()
      await writer?.close()
      await ctx?.fiber.dispose()
      await writable(root)
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})

async function writable(root: string): Promise<void> {
  await chmod(root, 0o700)
  for (const item of await readdir(root, { withFileTypes: true })) {
    const path = join(root, item.name)
    if (item.isDirectory()) await writable(path)
    else if (item.isFile()) await chmod(path, 0o600)
  }
}
