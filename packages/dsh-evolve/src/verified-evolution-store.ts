import type { GitSkillSource } from './git-skill-source.ts'
import type {
  CapabilityGeneration,
  EvolutionStore,
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
  private readonly source: GitSkillSource

  constructor(store: EvolutionStore, source: GitSkillSource) {
    this.store = store
    this.source = source
  }

  publishGeneration(input: GenerationInput) {
    return this.store.publishGeneration(input)
  }

  getGeneration(id: string): CapabilityGeneration | undefined {
    return this.store.getGeneration(id)
  }

  getActiveGeneration(): CapabilityGeneration | undefined {
    return this.store.getActiveGeneration()
  }

  async promoteGeneration(id: string) {
    const generation = this.store.getGeneration(id)
    if (generation === undefined) throw new Error(`Generation '${id}' does not exist`)
    await this.source.providerFor(generation)
    return this.store.promoteGeneration(id)
  }

  async rollbackGeneration() {
    const active = this.store.getActiveGeneration()
    if (active === undefined) throw new Error('no active Generation to roll back')
    if (active.parentId === undefined) return this.store.rollbackGeneration()
    const parent = this.store.getGeneration(active.parentId)
    if (parent === undefined) throw new Error(`parent Generation '${active.parentId}' is missing`)
    await this.source.providerFor(parent)
    return this.store.rollbackGeneration()
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

  isRecoveryPaused(): boolean {
    return this.store.isRecoveryPaused()
  }

  setRecoveryPaused(paused: boolean) {
    return this.store.setRecoveryPaused(paused)
  }

  close(): Promise<void> {
    return this.store.close()
  }
}
