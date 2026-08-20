import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  EvolutionActionReceipt,
  EvolutionOverview,
  EvolutionReviewDetail,
} from './control-types.ts'

/**
 * Static-only Remote contract consumed by the pinned DSH Typert generator.
 * Runtime registration lives in evolution-remote.ts so DSH can also load the
 * TypeScript source tree without needing decorator-syntax lowering.
 */
export class EvolutionRemoteTypertContract extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'evoforge.evolutionControl', { namespace: 'evoforgeEvolution' })
  }

  @Remote
  overview(workspaceId: string, sessionId?: string): Promise<EvolutionOverview> {
    void workspaceId
    void sessionId
    throw new Error('static Typert contract')
  }

  @Remote
  review(workspaceId: string, id: string): Promise<EvolutionReviewDetail> {
    void workspaceId
    void id
    throw new Error('static Typert contract')
  }

  @Remote
  pause(workspaceId: string): Promise<EvolutionActionReceipt> {
    void workspaceId
    throw new Error('static Typert contract')
  }

  @Remote
  resume(workspaceId: string): Promise<EvolutionActionReceipt> {
    void workspaceId
    throw new Error('static Typert contract')
  }

  @Remote
  approveReview(workspaceId: string, id: string, note: string): Promise<EvolutionActionReceipt> {
    void workspaceId
    void id
    void note
    throw new Error('static Typert contract')
  }

  @Remote
  rejectReview(workspaceId: string, id: string, note: string): Promise<EvolutionActionReceipt> {
    void workspaceId
    void id
    void note
    throw new Error('static Typert contract')
  }

  @Remote
  promote(workspaceId: string, generationId: string): Promise<EvolutionActionReceipt> {
    void workspaceId
    void generationId
    throw new Error('static Typert contract')
  }

  @Remote
  rollback(workspaceId: string, canaryId?: string): Promise<EvolutionActionReceipt> {
    void workspaceId
    void canaryId
    throw new Error('static Typert contract')
  }

}
