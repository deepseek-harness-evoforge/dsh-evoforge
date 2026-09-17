import type { Context } from '@deepseek-ai/cordis'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DurableFeedbackAttribution } from './durable-feedback-attribution.ts'
import { digest, projectCorrectionInput, type CorrectionLedger } from './conversation-correction-intake.ts'
import { draftInputDigest, type ConversationDraftRecord, type ConversationDraftStore } from './conversation-skill-draft.ts'
import { runConversationDraftTrialLeg } from './conversation-draft-trial-native.ts'
import { compareConversationDraftTrial, projectConversationDraftTrialResult } from './conversation-draft-trial-result.ts'
import type { ConversationDraftTrialPolicy, ConversationDraftTrialRecord, ConversationDraftTrialStore } from './conversation-draft-trial-store.ts'
import { workspaceIdForCwd } from './workspace-identity.ts'
import { DraftJudgeError, nativeConversationDraftJudge, parseDraftJudgment, type ConversationDraftJudge } from './conversation-draft-judge.ts'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-jobs' { interface JobKindMap { conversationDraftTrial: 'evoforge-conversation-draft-trial' } }

/** Consume exactly one previously reserved plan; never author, select new tests or promote. */
export async function executeConversationDraftTrial(ctx: Context, store: ConversationDraftTrialStore,
  initial: ConversationDraftTrialRecord, source: ConversationDraftRecord, cwd: string, signal: AbortSignal,
  sourceStillMatches: () => boolean, judge: ConversationDraftJudge = nativeConversationDraftJudge(ctx)): Promise<ConversationDraftTrialRecord> {
  let record = initial
  if (record.phase !== 'reserved') return record
  const judgeAnswer = async (task: string, answer: string): Promise<'pass' | 'fail' | 'uncertain' | undefined> => {
    signal.throwIfAborted()
    const workspaceMatches = await workspaceIdForCwd(ctx, cwd) === record.workspaceId
    signal.throwIfAborted()
    if (!sourceStillMatches() || !workspaceMatches) { record = await store.interrupt(record, 'source-conflict'); return undefined }
    const route = { provider: record.provider, model: record.model }
    record = await store.startJudge(record, digest({ task, answer, route, promptHash: record.judge!.promptHash }))
    let usage: TokenUsage | undefined
    try {
      const result = await judge({ task, answer, route }, signal)
      usage = result.usage
      signal.throwIfAborted()
      if (!sourceStillMatches()) { record = await store.failJudge(record, usage, 'source-conflict'); return undefined }
      const decision = parseDraftJudgment(result.decision, task, answer)
      record = await store.finishJudge(record, decision, usage)
      return decision.verdict
    } catch (error) {
      record = await store.failJudge(record, error instanceof DraftJudgeError ? error.usage : usage, signal.aborted ? 'cancelled' : 'judge-unavailable')
      return undefined
    }
  }
  try {
    if (source.draft === undefined || source.governance === undefined || digest(source) !== record.draftSnapshotDigest) {
      return await store.interrupt(record, 'source-conflict')
    }
    if (record.judge !== undefined) {
      for (const test of source.governance.cases) {
        if (!sourceStillMatches() || await workspaceIdForCwd(ctx, cwd) !== record.workspaceId) return await store.interrupt(record, 'source-conflict')
        for (const [answer, expected] of [[test.referenceAnswer, 'pass'], [test.alternateAnswer!, 'pass'], [test.negativeAnswer, 'fail']] as const) {
          const verdict = await judgeAnswer(test.input, answer)
          if (verdict === undefined) return record
          if (verdict !== expected) return await store.rejectJudgeCalibration(record)
        }
      }
    }
    for (let index = 0; index < record.legs.length; index++) {
      signal.throwIfAborted()
      if (!sourceStillMatches() || await workspaceIdForCwd(ctx, cwd) !== record.workspaceId) {
        return await store.interrupt(record, 'source-conflict')
      }
      const leg = record.legs[index]!
      const test = source.governance.cases.find(test => test.id === leg.caseId)
      if (test === undefined || digest(test.input) !== leg.inputDigest) return await store.interrupt(record, 'source-conflict')
      record = await store.startLeg(record, index)
      const result = await runConversationDraftTrialLeg(ctx, {
        sessionId: SessionId(leg.sessionId), cwd, input: test.input, provider: record.provider, model: record.model,
        ...(leg.variant === 'draft' ? { draft: source.draft } : {}), signal,
        async beforeDispatch(call) {
          signal.throwIfAborted()
          if (!sourceStillMatches()) throw new Error('conversation trial source changed')
          record = await store.markDispatch(record, index, call)
        },
      })
      record = await store.finishLeg(record, index, projectConversationDraftTrialResult(result, test,
        leg.variant === 'draft' ? source.draft : undefined))
      if (record.judge !== undefined) {
        const settled = record.legs[index]!.result!
        if (settled.status !== 'completed') return await store.interrupt(record, 'execution-failed')
        if (await judgeAnswer(test.input, settled.answer) === undefined) return record
      }
    }
    signal.throwIfAborted()
    return await store.finish(record, compareConversationDraftTrial(record, source.draft))
  } catch {
    if (!['reserved', 'running'].includes(record.phase)) return record
    return await store.interrupt(record, signal.aborted ? 'cancelled' : 'execution-failed')
  }
}

/** Native Jobs own bounded tests. Completion reports contain no cases, answers or Skill body. */
export function installConversationDraftTrialMonitor(ctx: Context, corrections: CorrectionLedger, drafts: ConversationDraftStore,
  store: ConversationDraftTrialStore, policies: readonly ConversationDraftTrialPolicy[]): { dispose(): Promise<void> } {
  let closing = false, disposal: Promise<void> | undefined
  const active = new Map<string, AbortController>()
  const rescan = new Set<string>()
  const operations = new Set<Promise<JobOutcome>>()
  let tail: Promise<unknown> = Promise.resolve()
  const reader = new DurableFeedbackAttribution(ctx.sessionPersistence, { lifecycle: ctx })
  const detachController = ctx.jobs.attachController('dsh-evolve-conversation-draft-trials')
  store.setAvailable(true)
  const schedule = (workspaceId: string): void => {
    if (closing) return
    if (active.has(workspaceId)) { rescan.add(workspaceId); return }
    const summary = store.summarize(workspaceId)
    if (!summary.enabled || !summary.observerAvailable) return
    const sources = drafts.records(workspaceId).filter(record => record.phase === 'draft' && store.canReserve(record))
      .sort((a, b) => a.reservedAt - b.reservedAt || a.id.localeCompare(b.id))
    if (sources.length === 0) return
    const controller = new AbortController()
    active.set(workspaceId, controller)
    try {
      ctx.jobs.start({ kind: 'evoforge-conversation-draft-trial', label: '对照检查草稿（不启用 Skill）', outputLimitBytes: 512,
        run: () => {
          const operation = tail.then(async (): Promise<JobOutcome> => {
            let completed = 0, incomplete = false
            for (const source of sources) {
              controller.signal.throwIfAborted()
              const correction = corrections.records(workspaceId).find(record => record.id === source.correctionId)
              if (correction === undefined || correction.phase !== 'classified' || correction.interpretation?.kind !== 'correction'
                || digest(correction.source) !== source.sourceDigest) { store.warn(workspaceId); incomplete = true; continue }
              const stored = await reader.readStoredSession(source.sourceSessionId, correction.source.turnEndSeq + 1)
              controller.signal.throwIfAborted()
              const cwd = stored.meta.cwd
              if (cwd === undefined || await workspaceIdForCwd(ctx, cwd) !== workspaceId) { store.warn(workspaceId); incomplete = true; continue }
              const input = projectCorrectionInput(stored, workspaceId, source.sourceSessionId, correction.source.turnEndSeq)
              if (input === undefined || digest(input.source) !== source.sourceDigest || draftInputDigest(input) !== source.inputDigest) {
                store.warn(workspaceId); incomplete = true; continue
              }
              const sourceStillMatches = (): boolean => {
                const currentDraft = drafts.records(workspaceId).find(record => record.id === source.id)
                const currentCorrection = corrections.records(workspaceId).find(record => record.id === correction.id)
                return !closing && !controller.signal.aborted && currentDraft !== undefined && currentCorrection !== undefined
                  && digest(currentDraft) === digest(source) && digest(currentCorrection) === digest(correction)
              }
              if (!sourceStillMatches()) { store.warn(workspaceId); incomplete = true; continue }
              const reserved = await store.reserve(source, input.route)
              if (reserved === undefined) continue
              const result = await executeConversationDraftTrial(ctx, store, reserved, source, cwd, controller.signal, sourceStillMatches)
              if (result.phase === 'completed' && result.comparison?.outcome !== 'inconclusive') completed++
              else incomplete = true
            }
            return { status: incomplete ? 'failed' : 'completed', detail: incomplete ? 'trial-incomplete' : 'trial-finished',
              output: `${completed} comparison(s) finished. These proposed checks do not authorize Skill activation.` }
          }).catch((): JobOutcome => {
            store.warn(workspaceId)
            return { status: controller.signal.aborted ? 'killed' : 'failed', detail: 'trial-unavailable', output: 'Comparison did not complete. No Skill was enabled.' }
          }).finally(() => {
            active.delete(workspaceId)
            operations.delete(operation)
            if (rescan.delete(workspaceId)) schedule(workspaceId)
          })
          tail = operation
          operations.add(operation)
          return { cancel: () => controller.abort(), done: operation }
        },
      })
    } catch { active.delete(workspaceId); store.warn(workspaceId) }
  }
  const detachDone = ctx.jobs.onJobDone(job => {
    if (job.kind === 'evoforge-conversation-skill-draft') for (const policy of policies) schedule(policy.workspaceId)
  })
  for (const policy of policies) schedule(policy.workspaceId)
  return { dispose() {
    if (disposal !== undefined) return disposal
    closing = true
    store.setAvailable(false)
    detachDone()
    for (const controller of active.values()) controller.abort()
    disposal = Promise.all([...operations]).then(() => { detachController() })
    return disposal
  } }
}
