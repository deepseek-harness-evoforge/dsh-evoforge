import type { GenerationBundleRepository } from './generation-bundle-repository.ts'
import type {
  CapabilityGeneration,
  EvolutionStore,
  GenerationSelectionEvidence,
  GenerationInput,
  SessionIdentity,
} from './generation-store.ts'

/**
 * Runtime release boundary: inactive manifests may be recorded first, but an
 * active pointer can move only after every referenced Git tree is exact and
 * materializable. The lower Storage Domain stays concerned only with atomic
 * persistence and is exercised independently by crash tests.
 */
export class VerifiedEvolutionStore implements EvolutionStore {
  private readonly store: EvolutionStore
  private readonly source: Pick<GenerationBundleRepository, 'providerFor'>

  constructor(store: EvolutionStore, source: Pick<GenerationBundleRepository, 'providerFor'>) {
    this.store = store
    this.source = source
  }

  publishGeneration(input: GenerationInput) {
    return this.store.publishGeneration(input)
  }

  getGeneration(id: string): CapabilityGeneration | undefined {
    return this.store.getGeneration(id)
  }

  getActiveGeneration(workspaceId: string): CapabilityGeneration | undefined {
    return this.store.getActiveGeneration(workspaceId)
  }

  async promoteGeneration(workspaceId: string, id: string, evidence?: GenerationSelectionEvidence) {
    const generation = this.store.getGeneration(id)
    if (generation === undefined) throw new Error(`Generation '${id}' does not exist`)
    if (generation.workspaceId !== workspaceId) {
      throw new Error(`Generation '${id}' belongs to Workspace '${generation.workspaceId}', not '${workspaceId}'`)
    }
    await this.source.providerFor(generation)
    return this.store.promoteGeneration(workspaceId, id, evidence)
  }

  async rollbackGeneration(
    workspaceId: string,
    expectedActiveId: string,
    evidence?: GenerationSelectionEvidence,
  ) {
    const active = this.store.getActiveGeneration(workspaceId)
    if (active === undefined) throw new Error(`Workspace '${workspaceId}' has no active Generation to roll back`)
    if (active.id !== expectedActiveId) {
      throw new Error(`active Generation changed from expected '${expectedActiveId}' to '${active.id}'`)
    }
    if (active.parentId === undefined) {
      return this.store.rollbackGeneration(workspaceId, expectedActiveId, evidence)
    }
    const parent = this.store.getGeneration(active.parentId)
    if (parent === undefined) throw new Error(`parent Generation '${active.parentId}' is missing`)
    if (parent.workspaceId !== workspaceId) {
      throw new Error(`parent Generation '${parent.id}' belongs to Workspace '${parent.workspaceId}'`)
    }
    await this.source.providerFor(parent)
    return this.store.rollbackGeneration(workspaceId, expectedActiveId, evidence)
  }

  listGenerationSelectionEvents(workspaceId: string) {
    return this.store.listGenerationSelectionEvents(workspaceId)
  }

  pinSession(identity: SessionIdentity, options?: { parentSessionId?: string }) {
    return this.store.pinSession(identity, options)
  }

  fallbackSessionToNative(identity: SessionIdentity): Promise<void> {
    return this.store.fallbackSessionToNative(identity)
  }

  getSessionGeneration(identity: SessionIdentity): CapabilityGeneration | undefined {
    return this.store.getSessionGeneration(identity)
  }

  isRecoveryPaused(workspaceId: string): boolean {
    return this.store.isRecoveryPaused(workspaceId)
  }

  setRecoveryPaused(workspaceId: string, paused: boolean) {
    return this.store.setRecoveryPaused(workspaceId, paused)
  }

  close(): Promise<void> {
    return this.store.close()
  }
}
