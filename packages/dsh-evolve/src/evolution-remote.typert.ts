import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  EvolutionActionReceipt,
  EvolutionEvaluatorDraftDetail,
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
  overview(): Promise<EvolutionOverview> {
    throw new Error('static Typert contract')
  }

  @Remote
  review(id: string): Promise<EvolutionReviewDetail> {
    void id
    throw new Error('static Typert contract')
  }

  @Remote
  pause(): Promise<EvolutionActionReceipt> {
    throw new Error('static Typert contract')
  }

  @Remote
  resume(): Promise<EvolutionActionReceipt> {
    throw new Error('static Typert contract')
  }

  @Remote
  approveReview(id: string, note: string): Promise<EvolutionActionReceipt> {
    void id
    void note
    throw new Error('static Typert contract')
  }

  @Remote
  rejectReview(id: string, note: string): Promise<EvolutionActionReceipt> {
    void id
    void note
    throw new Error('static Typert contract')
  }

  @Remote
  promote(generationId: string): Promise<EvolutionActionReceipt> {
    void generationId
    throw new Error('static Typert contract')
  }

  @Remote
  rollback(): Promise<EvolutionActionReceipt> {
    throw new Error('static Typert contract')
  }

  @Remote
  startFeedbackShadow(signalId: string, targetId: string): Promise<EvolutionActionReceipt> {
    void signalId
    void targetId
    throw new Error('static Typert contract')
  }

  @Remote
  evaluatorDraft(id: string): Promise<EvolutionEvaluatorDraftDetail> {
    void id
    throw new Error('static Typert contract')
  }

  @Remote
  authorEvaluator(signalId: string, targetId: string): Promise<EvolutionActionReceipt> {
    void signalId
    void targetId
    throw new Error('static Typert contract')
  }

  @Remote
  approveEvaluator(id: string, note: string): Promise<EvolutionActionReceipt> {
    void id
    void note
    throw new Error('static Typert contract')
  }

  @Remote
  approveAndStartEvaluatorShadow(id: string, note: string): Promise<EvolutionActionReceipt> {
    void id
    void note
    throw new Error('static Typert contract')
  }

  @Remote
  rejectEvaluator(id: string, note: string): Promise<EvolutionActionReceipt> {
    void id
    void note
    throw new Error('static Typert contract')
  }

  @Remote
  startEvaluatorShadow(id: string): Promise<EvolutionActionReceipt> {
    void id
    throw new Error('static Typert contract')
  }
}
