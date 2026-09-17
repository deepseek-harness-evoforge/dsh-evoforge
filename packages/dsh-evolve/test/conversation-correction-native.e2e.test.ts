import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { installConversationCorrectionMonitor } from '../src/conversation-correction-monitor.ts'
import { openCorrectionLedger } from '../src/conversation-correction-intake.ts'
import { openConversationDraftStore, type ConversationLearningPolicy } from '../src/conversation-skill-draft.ts'
import { installConversationSkillDraftMonitor } from '../src/conversation-skill-draft-monitor.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'
import { openConversationDraftTrialStore, type ConversationDraftTrialPolicy } from '../src/conversation-draft-trial-store.ts'
import { installConversationDraftTrialMonitor } from '../src/conversation-draft-trial-monitor.ts'
import { DurableFeedbackAttribution } from '../src/durable-feedback-attribution.ts'
import { compareConversationDraftTrial } from '../src/conversation-draft-trial-result.ts'

const dshRoot = process.env.DSH_EVOLVE_DSH_SOURCE_DIR

describe.skipIf(dshRoot === undefined)('native DSH conversation correction intake', () => {
  it.each([[false, false, false], [true, false, false], [false, true, false], [false, false, true]])('uses native no-Goal turns and cold recovery without duplicate calls (draft retry: %s, trial recovery: %s, semantic judge: %s)', async (retry, trialRecovery, semantic) => {
    const root = await mkdtemp(join(tmpdir(), 'evoforge-correction-native-'))
    const entry = (path: string) => pathToFileURL(join(dshRoot!, path, 'lib/index.js')).href
    const cordis = await import(entry('vendor/cordis')) as typeof import('@deepseek-ai/cordis')
    const nativeSession = await import(entry('packages/core/session')) as typeof import('@deepseek-ai/dsh-session')
    const nativeLlm = await import(entry('packages/llm/llm')) as typeof import('@deepseek-ai/dsh-llm')
    const persistence = await import(entry('packages/session/session-persistence-jsonl'))
    const storage = await import(entry('packages/storage/storage'))
    const storageJson = await import(entry('packages/storage/storage-json'))
    const storageDomain = await import(entry('packages/storage/storage-domain'))
    const jobs = await import(entry('packages/jobs/jobs-local'))
    const calls: GenerateOptions[] = []
    const fixtureGovernance = { scope: 'A private calibration fixture for native role separation, not a real evaluation.',
      cases: ['h1', 'h2', 'r1', 'r2'].map((id, index) => ({ id, partition: index < 2 ? 'holdout' : 'retention',
        input: `Unseen fixture ${id}: respond with answer-${id}.`, mustInclude: [`answer-${id}`], mustNotInclude: [],
        layout: 'any', referenceAnswer: `answer-${id}`, alternateAnswer: `Fact: answer-${id}`, negativeAnswer: 'wrong' })) }
    const fixtureDraft = { status: 'draft', name: 'readable-report', description: 'Readable reports for narrow chat previews.',
      body: 'Use short sections for narrow report previews. Preserve source facts and unknown states. Follow an explicit format request and leave unrelated answers unchanged.' }
    let waitForCancellation = false
    let failFirstDraft = retry
    class ClassifierAdapter extends nativeLlm.LlmAdapter {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        calls.push(options)
        if (typeof options.system === 'string' && options.system.startsWith('You independently assess one answer')) {
          expect(options.tools).toBeUndefined()
          const content = options.messages[0]!.content[0]!
          if (content.type !== 'text') throw new Error('expected blind judge text')
          const input = JSON.parse(content.text) as { task: string; answer: string }
          expect(Object.keys(input).sort()).toEqual(['answer', 'task'])
          const decision = { verdict: input.answer === 'wrong' ? 'fail' : 'pass', explanation: 'Fixture-only semantic protocol verdict.',
            citations: [{ source: 'task', quote: input.task }, { source: 'answer', quote: input.answer }] }
          yield { type: 'text-delta', index: 0, text: JSON.stringify(decision) }
          yield { type: 'usage', usage: { inputTokens: 17, outputTokens: 9 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        if (String(options.sessionId).startsWith('evoforge-trial-')) {
          const catalog = JSON.stringify(options.messages).includes('readable-report')
          const loaded = options.messages.some(message => message.content.some(block => block.type === 'tool-result'))
          if (catalog && !loaded) {
            const id = nativeLlm.ToolCallId('native-trial-load')
            const args = JSON.stringify({ name: 'readable-report' })
            yield { type: 'block-start', index: 0, blockType: 'tool-call' }
            yield { type: 'tool-call-delta', index: 0, id, name: 'skill', argumentsDelta: args }
            yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'skill', arguments: args } }
            yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 6 } }
            yield { type: 'finish', reason: { kind: 'tool-calls' } }
            return
          }
          const task = options.messages.find(message => message.role === 'user' && message.source.kind === 'plugin' && message.source.plugin === 'dsh-evolve')
          const text = JSON.stringify(task).match(/answer-(h1|h2|r1|r2)/u)?.[0] ?? 'unexpected fixture input'
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 6 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        if (typeof options.system === 'string' && (options.system.startsWith('You prepare independent test material') || options.system.startsWith('Draft a small reusable DSH Skill'))) {
          const governanceRole = options.system.startsWith('You prepare independent test material')
          if (failFirstDraft) {
            failFirstDraft = false
            yield { type: 'finish', reason: { kind: 'error', failure: { code: 'FIXTURE', message: 'Controlled initial failure' } } }
            return
          }
          yield { type: 'text-delta', index: 0, text: JSON.stringify(governanceRole ? fixtureGovernance : fixtureDraft) }
          yield { type: 'usage', usage: { inputTokens: 111, outputTokens: 55 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        if (waitForCancellation) {
          await new Promise<never>((_resolve, reject) => {
            if (options.signal?.aborted) reject(options.signal.reason)
            else options.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
          })
        }
        yield { type: 'text-delta', index: 0, text: JSON.stringify({ kind: 'correction', dimension: 'presentation', quote: '表格太宽，飞书预览看不到来源' }) }
        yield { type: 'usage', usage: { inputTokens: 91, outputTokens: 24 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    const boot = async (): Promise<Context> => {
      const ctx = new cordis.Context()
      Object.defineProperty(ctx, 'workspaceRegistry', { configurable: true, value: { resolveByPath: async () => ({ id: WORKSPACE_ID }) } })
      await ctx.plugin(storage.default)
      await ctx.plugin(storageJson as { apply(ctx: Context, config: { root: string }): void }, { root: join(root, 'storage') })
      await ctx.plugin(storageDomain as { apply(ctx: Context, config: { backend: string }): Promise<void> }, { backend: 'json' })
      await ctx.plugin(nativeSession.default)
      await ctx.plugin(persistence.default, { root: join(root, 'sessions'), compression: 'none' })
      await ctx.plugin(nativeLlm.default)
      await ctx.plugin(jobs.default)
      await ctx.plugin((await import(entry('packages/core/agent'))).default)
      await ctx.plugin((await import(entry('packages/session/session-projection'))).default)
      await ctx.plugin((await import(entry('packages/core/system-prompt'))).default)
      await ctx.plugin((await import(entry('packages/core/tools'))).default)
      await ctx.plugin((await import(entry('packages/skill/skill'))).default)
      // Match the deployed Host: user-facing presets own their Skill reader;
      // programmatic trial Agents must supply it without a global registration.
      await ctx.plugin((await import(entry('packages/core/agent-loop'))).default, { agents: [] })
      ctx.llm.registerAdapter(['fixture'], new ClassifierAdapter())
      return ctx
    }
    const sessionId = nativeSession.SessionId('session-11111111-1111-4111-8111-111111111111')
    const policy = [{ workspaceId: WORKSPACE_ID, maxAttemptsPerUtcDay: 3, replaySessionIds: [sessionId] }]
    let first: Context | undefined
    let second: Context | undefined
    let monitor: ReturnType<typeof installConversationCorrectionMonitor> | undefined
    let ledger: Awaited<ReturnType<typeof openCorrectionLedger>> | undefined
    let writer: { close(): Promise<void> } | undefined
    let drafts: Awaited<ReturnType<typeof openConversationDraftStore>> | undefined
    let draftMonitor: ReturnType<typeof installConversationSkillDraftMonitor> | undefined
    let trials: Awaited<ReturnType<typeof openConversationDraftTrialStore>> | undefined
    let trialMonitor: ReturnType<typeof installConversationDraftTrialMonitor> | undefined
    let trialPolicy: ConversationDraftTrialPolicy[] = [{ workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: semantic ? 44 : 24, semanticEvaluation: semantic }]
    const postTrialCalls = (retry ? 16 : 15) + (semantic ? 20 : 0)
    let learningPolicy: ConversationLearningPolicy[] = [{ workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: 2 }]
    const appendTurn = (session: Session, turn: number, text: string, answer: string): void => {
      session.append('turn/start', { turn })
      session.append('step/start', { turn, step: 1 })
      if (turn === 1) session.append('request/header', { reason: 'initial', header: { config: { provider: 'fixture', model: 'fixture' } } })
      session.append('user/message', nativeLlm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })
      const accumulator = new nativeLlm.AssistantStreamAccumulator()
      accumulator.push({ time: 1, chunk: { type: 'text-delta', index: 0, text: answer } })
      accumulator.push({ time: 2, chunk: { type: 'finish', reason: { kind: 'stop' } } })
      session.append('assistant/message', { turn, step: 1, stream: [...accumulator.snapshot()],
        message: nativeLlm.createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: answer }] }) }, { surfaceOp: 'append' })
      session.append('step/end', { turn, step: 1 })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    try {
      first = await boot()
      ledger = await openCorrectionLedger(first.storageDomain, policy)
      // No history replay until the named Session actually exists.
      monitor = installConversationCorrectionMonitor(first, ledger, [{ ...policy[0]!, replaySessionIds: [] }],
        id => trials?.ownsSession(id) ?? false)
      const session = first.sessions.create(sessionId, { meta: { cwd: '/private/correction-fixture' } })
      writer = await first.sessionPersistence.create(session.header)
      appendTurn(session, 1, '整理材料并生成报告。', '已生成五列表格。')
      await first.sessions.flush(session)
      appendTurn(session, 2, '上一版表格太宽，飞书预览看不到来源。请改为逐条段落。', '已改成逐条段落，未声称验证预览。')
      const before = JSON.stringify(session.snapshotEvents())
      await vi.waitFor(() => expect(ledger!.summarize(WORKSPACE_ID).correctionCount).toBe(1))
      expect(calls).toHaveLength(1)
      expect(calls[0]?.tools).toBeUndefined()
      expect(JSON.stringify(session.snapshotEvents())).toBe(before)
      expect(ledger.records(WORKSPACE_ID)[0]?.source.turn).toBe(2)
      expect(ledger.records(WORKSPACE_ID)[0]?.source).not.toHaveProperty('goal')
      expect(first.jobs.list().every(job => job.ownerSession === undefined)).toBe(true)

      drafts = await openConversationDraftStore(first.storageDomain, learningPolicy)
      draftMonitor = installConversationSkillDraftMonitor(first, ledger, drafts, learningPolicy)
      let originalFailure: unknown
      if (retry) {
        await vi.waitFor(() => expect(drafts!.summarize(WORKSPACE_ID).uncertainCount).toBe(1))
        originalFailure = drafts.records(WORKSPACE_ID)[0]!
        const failedId = drafts.records(WORKSPACE_ID)[0]!.id
        await draftMonitor.dispose()
        await drafts.close()
        learningPolicy = [{ workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: 4,
          retryFailedDrafts: [{ draftId: failedId, expiresAt: Date.now() + 60_000 }] }]
        drafts = await openConversationDraftStore(first.storageDomain, learningPolicy)
        draftMonitor = installConversationSkillDraftMonitor(first, ledger, drafts, learningPolicy)
      }
      await vi.waitFor(() => expect(drafts!.summarize(WORKSPACE_ID).draftCount).toBe(1))
      expect(calls).toHaveLength(retry ? 4 : 3)
      expect(JSON.stringify(calls.at(-1)?.messages)).not.toContain('answer-h1')
      expect(drafts.records(WORKSPACE_ID).find(r => r.phase === 'draft')?.governance).toEqual(fixtureGovernance)
      if (retry) expect(drafts.records(WORKSPACE_ID)[0]).toEqual(originalFailure)
      expect(JSON.stringify(session.snapshotEvents())).toBe(before)
      expect(first.jobs.list().every(job => job.ownerSession === undefined)).toBe(true)
      await draftMonitor.dispose()
      draftMonitor = undefined
      trials = await openConversationDraftTrialStore(first.storageDomain, trialPolicy)
      const correctionJobsBeforeTrial = first.jobs.list().filter(job => job.kind === 'evoforge-correction').length
      let failedTrial: unknown
      if (trialRecovery) {
        const draft = drafts.records(WORKSPACE_ID).find(record => record.phase === 'draft')!
        const reserved = (await trials.reserve(draft, { provider: 'fixture', model: 'fixture' }))!
        failedTrial = await trials.interrupt(await trials.startLeg(reserved, 0), 'execution-failed')
        await trials.close()
        trialPolicy = [{ workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: 48,
          retryFailedTrials: [{ trialId: reserved.id, expiresAt: Date.now() + 60_000 }] }]
        trials = await openConversationDraftTrialStore(first.storageDomain, trialPolicy)
      }
      trialMonitor = installConversationDraftTrialMonitor(first, ledger, drafts, trials, trialPolicy)
      await vi.waitFor(() => expect(trials!.records(WORKSPACE_ID).at(-1)?.phase).toBe('completed'))
      const trial = trials.records(WORKSPACE_ID).at(-1)!
      if (trialRecovery) expect(trials.records(WORKSPACE_ID)[0]).toEqual(failedTrial)
      expect(trial.comparison).toMatchObject({ outcome: 'no-improvement', baselinePassed: 4, draftPassed: 4, comparablePairs: 4, loadedDraftLegs: 4 })
      expect(calls).toHaveLength(postTrialCalls)
      expect(first.jobs.list().filter(job => job.kind === 'evoforge-correction')).toHaveLength(correctionJobsBeforeTrial)
      expect(ledger.summarize(WORKSPACE_ID).warningCount).toBe(0)
      if (semantic) {
        expect(trial.reservedModelCalls).toBe(44)
        expect(trial.judge?.requests).toHaveLength(20)
        expect(trials.summarize(WORKSPACE_ID).items.at(-1)?.judge).toMatchObject({ calibrated: true, calibrationCompleted: 12, completedJudgments: 20 })
        const fixtureCopy = structuredClone(trial)
        for (const leg of fixtureCopy.legs) leg.result!.passed = false
        const sealedDraft = drafts.records(WORKSPACE_ID).find(record => record.phase === 'draft')!.draft!
        expect(compareConversationDraftTrial(fixtureCopy, sealedDraft)).toMatchObject({ baselinePassed: 4, draftPassed: 4, outcome: 'no-improvement' })
        fixtureCopy.judge!.requests[12]!.decision!.verdict = 'uncertain'
        expect(compareConversationDraftTrial(fixtureCopy, sealedDraft).outcome).toBe('inconclusive')
      }
      expect(JSON.stringify(session.snapshotEvents())).toBe(before)
      const nativeReader = new DurableFeedbackAttribution(first.sessionPersistence, { lifecycle: first })
      for (const leg of trial.legs) {
        const persisted = await nativeReader.readStoredSession(leg.sessionId, Number.MAX_SAFE_INTEGER)
        expect(persisted.events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'completed')).toBe(true)
        expect(first.agents.get(nativeSession.SessionId(leg.sessionId))).toBeUndefined()
      }
      await trialMonitor.dispose()
      trialMonitor = undefined
      await trials.close()
      trials = undefined
      await drafts.close()
      drafts = undefined

      waitForCancellation = true
      appendTurn(session, 3, '仍然表格太宽，飞书预览看不到来源。请保留事实重新排版。', '已重新排版。')
      await vi.waitFor(() => expect(calls).toHaveLength(postTrialCalls + 1))
      await monitor.dispose()
      monitor = undefined
      expect(ledger.summarize(WORKSPACE_ID)).toMatchObject({ pendingCount: 0, uncertainCount: 1, observerAvailable: false })
      await vi.waitFor(() => expect(first!.jobs.list().every(job => job.status !== 'running' && job.status !== 'stopping')).toBe(true))
      await ledger.close()
      ledger = undefined
      await writer.close()
      writer = undefined
      await first.fiber.dispose()
      first = undefined

      second = await boot()
      ledger = await openCorrectionLedger(second.storageDomain, policy)
      trials = await openConversationDraftTrialStore(second.storageDomain, trialPolicy)
      monitor = installConversationCorrectionMonitor(second, ledger,
        [{ ...policy[0]!, replaySessionIds: [sessionId, ...trial.legs.map(leg => leg.sessionId), 'missing-user-session'] }],
        id => trials!.ownsSession(id))
      await vi.waitFor(() => expect(second!.jobs.list()).toHaveLength(2))
      await vi.waitFor(() => expect(second!.jobs.list().map(job => job.status).sort()).toEqual(['completed', 'failed']))
      expect(second.jobs.list().find(job => job.status === 'failed')?.detail).toBe('inspection-unavailable')
      expect(ledger.summarize(WORKSPACE_ID).warningCount).toBe(1)
      expect(calls).toHaveLength(postTrialCalls + 1)
      expect(ledger.summarize(WORKSPACE_ID)).toMatchObject({ correctionCount: 1, uncertainCount: 1, attemptsToday: 2 })
      expect(second.sessions.get(sessionId)).toBeUndefined()
      drafts = await openConversationDraftStore(second.storageDomain, learningPolicy)
      draftMonitor = installConversationSkillDraftMonitor(second, ledger, drafts, learningPolicy)
      expect(drafts.summarize(WORKSPACE_ID)).toMatchObject({ draftCount: 1, reservedModelCallsToday: retry ? 4 : 2 })
      if (retry) expect(drafts.records(WORKSPACE_ID)[0]).toEqual(originalFailure)
      trialMonitor = installConversationDraftTrialMonitor(second, ledger, drafts, trials, trialPolicy)
      expect(trials.records(WORKSPACE_ID).at(-1)).toEqual(trial)
      if (trialRecovery) expect(trials.records(WORKSPACE_ID)[0]).toEqual(failedTrial)
      expect(trials.summarize(WORKSPACE_ID).reservedModelCallsToday).toBe(trialRecovery ? 48 : semantic ? 44 : 24)
      expect(calls).toHaveLength(postTrialCalls + 1)
    } finally {
      await trialMonitor?.dispose()
      await trials?.close()
      await draftMonitor?.dispose()
      await drafts?.close()
      await monitor?.dispose()
      await ledger?.close()
      await writer?.close()
      await first?.fiber.dispose()
      await second?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
