import type { Context } from '@deepseek-ai/cordis'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DurableFeedbackAttribution } from './durable-feedback-attribution.ts'
import { digest, type CorrectionLedger } from './conversation-correction-intake.ts'
import { draftInputDigest, type ConversationDraftRecord, type ConversationDraftStore } from './conversation-skill-draft.ts'
import { runConversationDraftTrialLeg } from './conversation-draft-trial-native.ts'
import { compareConversationDraftTrial, projectConversationDraftTrialResult } from './conversation-draft-trial-result.ts'
import type { ConversationDraftTrialPolicy, ConversationDraftTrialRecord, ConversationDraftTrialStore } from './conversation-draft-trial-store.ts'
import { workspaceIdForCwd } from './workspace-identity.ts'
import { DraftJudgeError, nativeConversationDraftJudge, parseDraftJudgment, type ConversationDraftJudge } from './conversation-draft-judge.ts'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { conversationSourceAvailable, type ConversationSourceCheck } from './conversation-source-check.ts'
import { explicitFeedbackId, resolveConversationDraftOrigin, type ConversationDraftOrigin } from './conversation-message-feedback.ts'

declare module '@deepseek-ai/dsh-jobs' { interface JobKindMap { conversationDraftTrial: 'evoforge-conversation-draft-trial' } }

/** Consume exactly one previously reserved plan; never author, select new tests or promote. */
export async function executeConversationDraftTrial(ctx: Context, store: ConversationDraftTrialStore,
  initial: ConversationDraftTrialRecord, source: ConversationDraftRecord, cwd: string, signal: AbortSignal,
  sourceStillMatches: ConversationSourceCheck, judge: ConversationDraftJudge = nativeConversationDraftJudge(ctx)): Promise<ConversationDraftTrialRecord> {
  let record = initial
  if (record.phase !== 'reserved') return record
  const sourceMatches = () => conversationSourceAvailable(sourceStillMatches, signal)
  const judgeAnswer = async (task: string, answer: string): Promise<'pass' | 'fail' | 'uncertain' | undefined> => {
    signal.throwIfAborted()
    const workspaceMatches = await workspaceIdForCwd(ctx, cwd) === record.workspaceId
    signal.throwIfAborted()
    if (!await sourceMatches() || !workspaceMatches) { record = await store.interrupt(record, signal.aborted ? 'cancelled' : 'source-conflict'); return undefined }
    const route = { provider: record.provider, model: record.model }
    record = await store.startJudge(record, digest({ task, answer, route, promptHash: record.judge!.promptHash }))
    if (!await sourceMatches()) { record = await store.failJudge(record, undefined, signal.aborted ? 'cancelled' : 'source-conflict'); return undefined }
    let usage: TokenUsage | undefined
    try {
      const result = await judge({ task, answer, route }, signal)
      usage = result.usage
      signal.throwIfAborted()
      if (!await sourceMatches()) { record = await store.failJudge(record, usage, signal.aborted ? 'cancelled' : 'source-conflict'); return undefined }
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
        if (!await sourceMatches() || await workspaceIdForCwd(ctx, cwd) !== record.workspaceId) return await store.interrupt(record, signal.aborted ? 'cancelled' : 'source-conflict')
        for (const [answer, expected] of [[test.referenceAnswer, 'pass'], [test.alternateAnswer!, 'pass'], [test.negativeAnswer, 'fail']] as const) {
          const verdict = await judgeAnswer(test.input, answer)
          if (verdict === undefined) return record
          if (verdict !== expected) return await store.rejectJudgeCalibration(record)
        }
      }
    }
    for (let index = 0; index < record.legs.length; index++) {
      signal.throwIfAborted()
      if (!await sourceMatches() || await workspaceIdForCwd(ctx, cwd) !== record.workspaceId) {
        return await store.interrupt(record, signal.aborted ? 'cancelled' : 'source-conflict')
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
          if (!await sourceMatches()) throw new Error('conversation trial source changed')
          record = await store.markDispatch(record, index, call)
          if (!await sourceMatches()) throw new Error('conversation trial source changed')
        },
      })
      record = await store.finishLeg(record, index, projectConversationDraftTrialResult(result, test,
        leg.variant === 'draft' ? source.draft : undefined))
      if (!await sourceMatches()) return await store.interrupt(record, signal.aborted ? 'cancelled' : 'source-conflict')
      if (record.judge !== undefined) {
        const settled = record.legs[index]!.result!
        if (settled.status !== 'completed') return await store.interrupt(record, 'execution-failed')
        if (await judgeAnswer(test.input, settled.answer) === undefined) return record
      }
    }
    signal.throwIfAborted()
    if (!await sourceMatches() || await workspaceIdForCwd(ctx, cwd) !== record.workspaceId) return await store.interrupt(record, signal.aborted ? 'cancelled' : 'source-conflict')
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
              const feedback = source.messageFeedbackSource
              if (feedback !== undefined && drafts.policy(workspaceId)?.explicitFeedbackSessionIds?.includes(feedback.sessionId) !== true) {
                store.warn(workspaceId); incomplete = true; continue
              }
              const origin: ConversationDraftOrigin | undefined = feedback === undefined
                ? corrections.records(workspaceId).find(record => record.id === source.correctionId)
                : { kind: 'message-feedback', id: explicitFeedbackId(feedback), source: feedback }
              if (origin === undefined || origin.id !== source.correctionId || digest(origin.source) !== source.sourceDigest) {
                store.warn(workspaceId); incomplete = true; continue
              }
              const resolved = await resolveConversationDraftOrigin(ctx, reader, corrections, origin)
              controller.signal.throwIfAborted()
              if (resolved === undefined || resolved.cwd === undefined || draftInputDigest(resolved.input) !== source.inputDigest) {
                store.warn(workspaceId); incomplete = true; continue
              }
              const { input, cwd } = resolved
              const sourceStillMatches = async (): Promise<boolean> => {
                if (closing || controller.signal.aborted) return false
                const fresh = await resolveConversationDraftOrigin(ctx, reader, corrections, origin)
                const currentDraft = drafts.records(workspaceId).find(record => record.id === source.id)
                return !closing && !controller.signal.aborted && currentDraft !== undefined && digest(currentDraft) === digest(source)
                  && fresh !== undefined && fresh.cwd === cwd && digest(fresh.input) === digest(input)
              }
              if (!await sourceStillMatches()) { store.warn(workspaceId); incomplete = true; continue }
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
