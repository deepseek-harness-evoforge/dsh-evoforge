import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  EvolutionActionReceipt,
  EvolutionOverview,
  EvolutionReviewDetail,
} from 'dsh-evolve/client'

/** Generated Remote namespace projected as the small surface the component consumes. */
export interface EvolutionRemoteClient {
  overview(workspaceId: string, sessionId?: string): Promise<RemoteResult<EvolutionOverview>>
  review(workspaceId: string, id: string): Promise<RemoteResult<EvolutionReviewDetail>>
  pause(workspaceId: string): Promise<RemoteResult<EvolutionActionReceipt>>
  resume(workspaceId: string): Promise<RemoteResult<EvolutionActionReceipt>>
  approveReview(workspaceId: string, id: string, note: string): Promise<RemoteResult<EvolutionActionReceipt>>
  rejectReview(workspaceId: string, id: string, note: string): Promise<RemoteResult<EvolutionActionReceipt>>
  approveExistingSkill(workspaceId: string, candidateId: string, note: string): Promise<RemoteResult<EvolutionActionReceipt>>
  rejectExistingSkill(workspaceId: string, candidateId: string, note: string): Promise<RemoteResult<EvolutionActionReceipt>>
  promoteExistingSkill(workspaceId: string, candidateId: string): Promise<RemoteResult<EvolutionActionReceipt>>
  promote(workspaceId: string, generationId: string): Promise<RemoteResult<EvolutionActionReceipt>>
  rollback(workspaceId: string, canaryId?: string): Promise<RemoteResult<EvolutionActionReceipt>>
  rollbackExistingSkill(workspaceId: string, canaryId: string): Promise<RemoteResult<EvolutionActionReceipt>>
}

/** Turn the Remote result union into the component's ordinary success/error flow. */
export async function remoteValue<T>(request: Promise<RemoteResult<T>>): Promise<T> {
  const result = await request
  if (result.ok) return result.value
  throw new Error(result.error.message)
}
