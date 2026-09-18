import type { Context } from '@deepseek-ai/cordis'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import { DurableFeedbackAttribution } from './durable-feedback-attribution.ts'
import { digest, projectCorrectionInput, type CorrectionLedger, type CorrectionRecord } from './conversation-correction-intake.ts'
import { authorConversationSkillDraft, nativeConversationDraftModel, type ConversationDraftStore, type ConversationLearningPolicy } from './conversation-skill-draft.ts'
import { workspaceIdForCwd } from './workspace-identity.ts'

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
  policies: readonly ConversationLearningPolicy[]): { dispose(): Promise<void> } {
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
    if (closing || corrections.policy(workspaceId) === undefined) return
    if (active.has(workspaceId)) { rescan.add(workspaceId); return }
    const summary = store.summarize(workspaceId)
    if (!summary.enabled || !summary.observerAvailable || summary.reservedModelCallsToday + 2 > summary.maxModelCallsPerUtcDay) return
    const retryIds = new Set(store.policy(workspaceId)?.retryFailedDrafts?.map(grant => grant.draftId) ?? [])
    const retrySources = new Set(store.records(workspaceId).filter(r => retryIds.has(r.id)).map(r => r.correctionId))
    const recorded = corrections.records(workspaceId)
    const latest = new Set(latestCorrectionChainEnds(recorded).map(r => r.id))
    const sources = recorded.filter(r => (retrySources.has(r.id) || latest.has(r.id)) && store.canStart(r))
      .sort((a, b) => Number(retrySources.has(b.id)) - Number(retrySources.has(a.id)) || b.reservedAt - a.reservedAt)
    if (sources.length === 0) return
    const controller = new AbortController()
    active.set(workspaceId, controller)
    try {
      ctx.jobs.start({ kind: 'evoforge-conversation-skill-draft', label: '起草改进建议（不启用 Skill）', outputLimitBytes: 512,
        run: () => {
          const operation = tail.then(async (): Promise<JobOutcome> => {
            let authored = 0, incomplete = false
            for (const source of sources) {
              controller.signal.throwIfAborted()
              const current = store.summarize(workspaceId)
              if (current.reservedModelCallsToday + 2 > current.maxModelCallsPerUtcDay) break
              // Only an exact durable source may be handed to either model role.
              const stored = await reader.readStoredSession(source.source.sessionId, source.source.turnEndSeq + 1)
              controller.signal.throwIfAborted()
              if (await workspaceIdForCwd(ctx, stored.meta.cwd) !== workspaceId) { store.warn(workspaceId); continue }
              const input = projectCorrectionInput(stored, workspaceId, source.source.sessionId, source.source.turnEndSeq)
              const liveSource = corrections.records(workspaceId).find(r => r.id === source.id)
              if (input === undefined || liveSource === undefined || digest(liveSource) !== digest(source)
                || digest(input.source) !== digest(source.source)) { store.warn(workspaceId); continue }
              const sourceStillMatches = async (): Promise<boolean> => {
                if (closing || controller.signal.aborted) return false
                const fresh = await reader.readStoredSession(source.source.sessionId, source.source.turnEndSeq + 1)
                const currentSource = corrections.records(workspaceId).find(r => r.id === source.id)
                const projected = projectCorrectionInput(fresh, workspaceId, source.source.sessionId, source.source.turnEndSeq)
                return !closing && !controller.signal.aborted && await workspaceIdForCwd(ctx, fresh.meta.cwd) === workspaceId
                  && currentSource !== undefined && digest(currentSource) === digest(source)
                  && projected !== undefined && digest(projected) === digest(input)
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
