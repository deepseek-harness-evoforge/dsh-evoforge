import type { Context } from '@deepseek-ai/cordis'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { DurableFeedbackAttribution } from './durable-feedback-attribution.ts'
import { runWithLifecycleDeadline } from './lifecycle-deadline.ts'
import { workspaceIdForCwd } from './workspace-identity.ts'
import {
  inspectConversationCorrection,
  nativeCorrectionClassifier,
  projectCorrectionInput,
  type ConversationCorrectionPolicy,
  type CorrectionLedger,
} from './conversation-correction-intake.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap { conversationCorrection: 'evoforge-correction' }
}

/**
 * Post-turn intake only. Semantic interpretation runs in a bounded native Job,
 * never ahead of user dispatch, inside the user's Agent loop, or as a candidate evaluator.
 */
export function installConversationCorrectionMonitor(
  ctx: Context,
  ledger: CorrectionLedger,
  policies: readonly ConversationCorrectionPolicy[],
  isEvaluationSession: (sessionId: string) => boolean,
): { dispose(): Promise<void> } {
  let closing = false
  const operations = new Set<Promise<JobOutcome>>()
  const controllers = new Set<AbortController>()
  const pending = new Set<string>()
  let tail: Promise<unknown> = Promise.resolve()
  const reader = new DurableFeedbackAttribution(ctx.sessionPersistence, { lifecycle: ctx })
  const classify = nativeCorrectionClassifier(ctx)
  const detachController = ctx.jobs.attachController('dsh-evolve-conversation-corrections')
  ledger.setAvailable(true)

  const schedule = (sessionId: string, endSeq?: number, authorizedWorkspaceId?: string): void => {
    const key = `${sessionId}:${endSeq ?? 'replay'}`
    if (closing || pending.has(key) || pending.size >= 20) return
    try {
      if (isEvaluationSession(sessionId)) return
    } catch {
      if (authorizedWorkspaceId !== undefined) ledger.warn(authorizedWorkspaceId)
      return
    }
    pending.add(key)
    const controller = new AbortController()
    controllers.add(controller)
    try {
      ctx.jobs.start({
        kind: 'evoforge-correction',
        // Unowned, raw-free auxiliary Job: no owner completion reporter can inject a new Agent turn.
        label: '检查聊天纠正线索（不修改 Skill）',
        outputLimitBytes: 512,
        run: () => {
          const operation = tail.then(async (): Promise<JobOutcome> => {
            controller.signal.throwIfAborted()
            if (isEvaluationSession(sessionId)) {
              return { status: 'completed', detail: 'evaluation-source-excluded', output: 'No inspection or Skill change.' }
            }
            const live = ctx.sessions.get(sessionId as SessionId)
            if (live !== undefined) {
              await runWithLifecycleDeadline(ctx, () => ctx.sessions.flush(live), {
                timeoutMs: 30_000, label: 'dsh-evolve.correction.liveFlush',
                timeoutMessage: 'correction source flush timed out', signal: controller.signal,
                onDeadline: () => controller.abort(),
              })
            }
            controller.signal.throwIfAborted()
            const stored = await reader.readStoredSession(sessionId, endSeq === undefined ? Number.MAX_SAFE_INTEGER : endSeq + 1)
            controller.signal.throwIfAborted()
            const workspaceId = await workspaceIdForCwd(ctx, stored.meta.cwd)
            if (ledger.policy(workspaceId) === undefined
              || (authorizedWorkspaceId !== undefined && authorizedWorkspaceId !== workspaceId)) {
              return { status: 'completed', detail: 'outside-authorized-workspace', output: 'No inspection or Skill change.' }
            }
            const ends = endSeq === undefined
              ? stored.events.filter(event => event.type === 'turn/end' && event.data.reason.kind === 'completed').slice(-2).map(event => event.seq)
              : [endSeq]
            let failed = false
            let inspected = 0
            for (const seq of ends) {
              controller.signal.throwIfAborted()
              const input = projectCorrectionInput(stored, workspaceId, sessionId, seq)
              if (input === undefined) continue
              const outcome = await inspectConversationCorrection(ledger, input, classify, controller.signal)
              if (outcome === 'classified') inspected += 1
              if (outcome === 'abstained' || outcome === 'uncertain') failed = true
            }
            return { status: failed ? 'failed' : 'completed', detail: failed ? 'inspection-incomplete' : 'inspection-finished',
              output: `${inspected} interaction(s) inspected. Interpretations are unverified. No Skill was changed.` }
          }).catch((): JobOutcome => {
            if (authorizedWorkspaceId !== undefined) ledger.warn(authorizedWorkspaceId)
            // Never publish provider errors, private source text, or paths through Jobs/log output.
            return { status: controller.signal.aborted ? 'killed' : 'failed', detail: 'inspection-unavailable',
              output: 'Inspection did not complete. No Skill was changed.' }
          }).finally(() => {
            pending.delete(key)
            controllers.delete(controller)
            operations.delete(operation)
          })
          tail = operation
          operations.add(operation)
          return { cancel: () => controller.abort(), done: operation }
        },
      })
    } catch {
      pending.delete(key)
      controllers.delete(controller)
      if (authorizedWorkspaceId !== undefined) ledger.warn(authorizedWorkspaceId)
    }
  }

  const detachEvent = ctx.on('session/event', (session, event) => {
    if (closing || event.type !== 'turn/end' || event.data.reason.kind !== 'completed'
      || ctx.sessions.get(session.id) !== session) return
    // Resolve authorization before creating work; no configured Workspace means no auxiliary model calls.
    void workspaceIdForCwd(ctx, session.header.cwd).then(workspaceId => {
      const state = ledger.summarize(workspaceId)
      if (!closing && state.enabled && state.observerAvailable && state.attemptsToday < state.maxAttemptsPerUtcDay) {
        schedule(String(session.id), event.seq, workspaceId)
      }
    }).catch(() => {})
  })
  for (const policy of policies) {
    for (const sessionId of policy.replaySessionIds ?? []) schedule(sessionId, undefined, policy.workspaceId)
  }

  let disposal: Promise<void> | undefined
  return {
    dispose() {
      if (disposal !== undefined) return disposal
      closing = true
      ledger.setAvailable(false)
      detachEvent()
      for (const controller of controllers) controller.abort()
      disposal = Promise.all([...operations]).then(() => { detachController() })
      return disposal
    },
  }
}
