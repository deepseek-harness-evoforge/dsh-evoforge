import type { Context } from '@deepseek-ai/cordis'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import { DurableFeedbackAttribution } from './durable-feedback-attribution.ts'
import { digest, type CorrectionLedger, type CorrectionRecord } from './conversation-correction-intake.ts'
import { authorConversationSkillDraft, nativeConversationDraftModel, type ConversationDraftStore, type ConversationLearningPolicy } from './conversation-skill-draft.ts'
import { draftOriginAnswerSeq, explicitFeedbackOrigin, isExplicitFeedbackOrigin, readMessageFeedbackInputs,
  resolveConversationDraftOrigin, type ConversationDraftOrigin } from './conversation-message-feedback.ts'

declare module '@deepseek-ai/dsh-jobs' { interface JobKindMap { conversationSkillDraft: 'evoforge-conversation-skill-draft' } }

/** Adjacent correction messages form one chain, not multiple independent examples. */
export function latestCorrectionChainEnds(records: readonly CorrectionRecord[]): CorrectionRecord[] {
  const corrections = records.filter(r => r.phase === 'classified' && r.interpretation?.kind === 'correction')
  const parents = new Set(corrections.map(r => `${r.source.sessionId}\0${r.source.previousUserSeq}`))
  return corrections.filter(r => !parents.has(`${r.source.sessionId}\0${r.source.userSeq}`))
    .sort((a, b) => b.reservedAt - a.reservedAt || b.source.turn - a.source.turn || a.id.localeCompare(b.id))
}

/** Native Jobs own two isolated auxiliary roles. No Agent, Skill or current Session contribution is registered. */
export function installConversationSkillDraftMonitor(ctx: Context, corrections: CorrectionLedger, store: ConversationDraftStore,
  policies: readonly ConversationLearningPolicy[], isEvaluationSession: (sessionId: string) => boolean = () => false): { dispose(): Promise<void> } {
  let closing = false, disposal: Promise<void> | undefined
  const active = new Map<string, AbortController>()
  const rescan = new Set<string>()
  const operations = new Set<Promise<JobOutcome>>()
  let tail: Promise<unknown> = Promise.resolve()
  const reader = new DurableFeedbackAttribution(ctx.sessionPersistence, { lifecycle: ctx })
  const model = nativeConversationDraftModel(ctx)
  const detachController = ctx.jobs.attachController('dsh-evolve-conversation-skill-drafts')
  store.setAvailable(true)

  const schedule = (workspaceId: string): void => {
    const policy = store.policy(workspaceId)
    if (closing || policy === undefined) return
    let feedbackSessions: string[]
    try { feedbackSessions = (policy.explicitFeedbackSessionIds ?? []).filter(sessionId => !isEvaluationSession(sessionId)) }
    catch { store.warn(workspaceId); return }
    if (active.has(workspaceId)) { rescan.add(workspaceId); return }
    const summary = store.summarize(workspaceId)
    if (!summary.enabled || !summary.observerAvailable || summary.reservedModelCallsToday + 2 > summary.maxModelCallsPerUtcDay) return
    const retryIds = new Set(store.policy(workspaceId)?.retryFailedDrafts?.map(grant => grant.draftId) ?? [])
    const retrySources = new Set(store.records(workspaceId).filter(r => retryIds.has(r.id)).map(r => r.correctionId))
    const recorded = corrections.records(workspaceId)
    const latest = new Set(latestCorrectionChainEnds(recorded).map(r => r.id))
    const sources: ConversationDraftOrigin[] = recorded.filter(r => (retrySources.has(r.id) || latest.has(r.id)) && store.canStart(r))
      .sort((a, b) => Number(retrySources.has(b.id)) - Number(retrySources.has(a.id)) || b.reservedAt - a.reservedAt)
    if (sources.length === 0 && feedbackSessions.length === 0) return
    const controller = new AbortController()
    active.set(workspaceId, controller)
    try {
      ctx.jobs.start({ kind: 'evoforge-conversation-skill-draft', label: '起草改进建议（不启用 Skill）', outputLimitBytes: 512,
        run: () => {
          const operation = tail.then(async (): Promise<JobOutcome> => {
            let authored = 0, incomplete = false
            for (const sessionId of feedbackSessions) {
              controller.signal.throwIfAborted()
              try {
                if (isEvaluationSession(sessionId)) continue
                const fresh = await readMessageFeedbackInputs(ctx, reader, workspaceId, sessionId)
                sources.push(...fresh.inputs.map(explicitFeedbackOrigin))
              } catch { store.warn(workspaceId); incomplete = true }
            }
            const timestamp = (source: ConversationDraftOrigin) => isExplicitFeedbackOrigin(source) ? source.source.feedbackUpdatedAt : source.reservedAt
            sources.sort((a, b) => Number(retrySources.has(b.id)) - Number(retrySources.has(a.id)) || timestamp(b) - timestamp(a))
            for (const source of sources) {
              controller.signal.throwIfAborted()
              if (isEvaluationSession(source.source.sessionId)) continue
              const current = store.summarize(workspaceId)
              if (current.reservedModelCallsToday + 2 > current.maxModelCallsPerUtcDay) break
              if (!store.canStart(source)) continue
              // Legacy drafts lack sourceAnswerSeq. Resolve it from their real correction record, not a new synthetic record.
              const duplicate = store.records(workspaceId).some(draft => draft.correctionId !== source.id
                && draft.sourceSessionId === source.source.sessionId
                && (draft.sourceAnswerSeq ?? recorded.find(record => record.id === draft.correctionId)?.source.previousAssistantSeq) === draftOriginAnswerSeq(source))
              if (duplicate) continue
              const resolved = await resolveConversationDraftOrigin(ctx, reader, corrections, source)
              if (resolved === undefined) { store.warn(workspaceId); incomplete = true; continue }
              const { input } = resolved
              const sourceStillMatches = async (): Promise<boolean> => {
                if (closing || controller.signal.aborted || isEvaluationSession(source.source.sessionId)) return false
                const fresh = await resolveConversationDraftOrigin(ctx, reader, corrections, source)
                return !closing && !controller.signal.aborted && fresh !== undefined && digest(fresh.input) === digest(input)
              }
              const outcome = await authorConversationSkillDraft(store, source, input, model, controller.signal, sourceStillMatches)
              if (outcome === 'draft') authored += 1
              if (outcome === 'uncertain' || outcome === 'abstained') incomplete = true
            }
            return { status: incomplete ? 'failed' : 'completed', detail: incomplete ? 'draft-incomplete' : 'draft-inspection-finished',
              output: `${authored} inactive draft(s). Test material is proposed, not an evaluation result. No Skill was enabled.` }
          }).catch((): JobOutcome => {
            store.warn(workspaceId)
            return { status: controller.signal.aborted ? 'killed' : 'failed', detail: 'draft-unavailable', output: 'Draft work did not complete. No Skill was enabled.' }
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
    if (job.kind === 'evoforge-correction') for (const policy of policies) schedule(policy.workspaceId)
  })
  const feedbackChanged = (sessionId: string) => {
    for (const policy of policies) if (policy.explicitFeedbackSessionIds?.includes(sessionId)) schedule(policy.workspaceId)
  }
  // Never await a same-Session feedback operation inside the native cold-write observer.
  const detachFeedbackLive = ctx.on('session/event', (session, event) => {
    if (event.type === 'feedback/message-put' || event.type === 'feedback/message-delete') feedbackChanged(String(session.header.id))
  })
  const detachFeedbackCold = ctx.on('feedback/committed', inspection => { feedbackChanged(String(inspection.meta.id)) })
  for (const policy of policies) schedule(policy.workspaceId)
  return { dispose() {
    if (disposal !== undefined) return disposal
    closing = true
    store.setAvailable(false)
    detachDone()
    detachFeedbackLive()
    detachFeedbackCold()
    for (const controller of active.values()) controller.abort()
    disposal = Promise.all([...operations]).then(() => { detachController() })
    return disposal
  } }
}
