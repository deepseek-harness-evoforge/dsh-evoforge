import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  EvolutionActionReceipt,
  EvolutionOverview,
  EvolutionReviewDetail,
} from './control-types.ts'
import type { EvolutionControlPlane } from './evolution-control-plane.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Structured host control surface consumed by optional EvoForge adapters. */
    'evoforge.evolutionControl': EvolutionRemoteService
  }
}

/** Generated-Remote transport adapter; all policy and state remain in EvolutionControlPlane. */
export class EvolutionRemoteService extends TypertRemoteService {
  private readonly control: EvolutionControlPlane

  constructor(ctx: Context, control: EvolutionControlPlane) {
    super(ctx, 'evoforge.evolutionControl', { namespace: 'evoforgeEvolution' })
    this.control = control
    for (const initialize of remoteInitializers) initialize.call(this)
  }

  overview(workspaceId: string, sessionId?: string): Promise<EvolutionOverview> {
    return this.control.overview(workspaceId, sessionId)
  }

  review(workspaceId: string, id: string): Promise<EvolutionReviewDetail> {
    return this.control.review(workspaceId, id)
  }

  pause(workspaceId: string): Promise<EvolutionActionReceipt> {
    return this.control.pause(workspaceId)
  }

  resume(workspaceId: string): Promise<EvolutionActionReceipt> {
    return this.control.resume(workspaceId)
  }

  approveReview(workspaceId: string, id: string, note: string): Promise<EvolutionActionReceipt> {
    return this.control.approveReview(workspaceId, id, note)
  }

  rejectReview(workspaceId: string, id: string, note: string): Promise<EvolutionActionReceipt> {
    return this.control.rejectReview(workspaceId, id, note)
  }

  promote(workspaceId: string, generationId: string): Promise<EvolutionActionReceipt> {
    return this.control.promote(workspaceId, generationId)
  }

  rollback(workspaceId: string): Promise<EvolutionActionReceipt> {
    return this.control.rollback(workspaceId)
  }

}

export const EVOLUTION_REMOTE_METHODS = [
  'overview',
  'review',
  'pause',
  'resume',
  'approveReview',
  'rejectReview',
  'promote',
  'rollback',
] as const satisfies readonly (keyof EvolutionRemoteService)[]

type RemoteInitializer = (this: EvolutionRemoteService) => void
type AnyRemoteMethod = (this: EvolutionRemoteService, ...args: unknown[]) => unknown
const remoteInitializers: RemoteInitializer[] = []

// DSH's source loader intentionally does not lower decorator syntax. Apply the
// standard decorator protocol explicitly while keeping the exact authored
// declarations in evolution-remote.typert.ts for the pinned static generator.
for (const methodName of EVOLUTION_REMOTE_METHODS) {
  const method = EvolutionRemoteService.prototype[methodName] as AnyRemoteMethod
  const context = {
    kind: 'method',
    name: methodName,
    static: false,
    private: false,
    addInitializer(initializer: RemoteInitializer) {
      remoteInitializers.push(initializer)
    },
  } as unknown as ClassMethodDecoratorContext<EvolutionRemoteService, AnyRemoteMethod>
  Remote(methodName)(method, context)
}
