import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  EvolutionActionReceipt,
  EvolutionEvaluatorDraftDetail,
  EvolutionOverview,
  EvolutionReviewDetail,
} from 'dsh-evolve/client'

/** Generated Remote namespace projected as the small surface the component consumes. */
export interface EvolutionRemoteClient {
  overview(): Promise<RemoteResult<EvolutionOverview>>
  review(id: string): Promise<RemoteResult<EvolutionReviewDetail>>
  pause(): Promise<RemoteResult<EvolutionActionReceipt>>
  resume(): Promise<RemoteResult<EvolutionActionReceipt>>
  approveReview(id: string, note: string): Promise<RemoteResult<EvolutionActionReceipt>>
  rejectReview(id: string, note: string): Promise<RemoteResult<EvolutionActionReceipt>>
  promote(generationId: string): Promise<RemoteResult<EvolutionActionReceipt>>
  rollback(): Promise<RemoteResult<EvolutionActionReceipt>>
  startFeedbackShadow(signalId: string, targetId: string): Promise<RemoteResult<EvolutionActionReceipt>>
  evaluatorDraft(id: string): Promise<RemoteResult<EvolutionEvaluatorDraftDetail>>
  authorEvaluator(signalId: string, targetId: string): Promise<RemoteResult<EvolutionActionReceipt>>
  approveEvaluator(id: string, note: string): Promise<RemoteResult<EvolutionActionReceipt>>
  approveAndStartEvaluatorShadow(id: string, note: string): Promise<RemoteResult<EvolutionActionReceipt>>
  rejectEvaluator(id: string, note: string): Promise<RemoteResult<EvolutionActionReceipt>>
  startEvaluatorShadow(id: string): Promise<RemoteResult<EvolutionActionReceipt>>
}

/** Turn the Remote result union into the component's ordinary success/error flow. */
export async function remoteValue<T>(request: Promise<RemoteResult<T>>): Promise<T> {
  const result = await request
  if (result.ok) return result.value
  throw new Error(result.error.message)
}
