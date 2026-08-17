import type { EvolutionStore } from './generation-store.ts'
import type { ShadowSupervisor } from './shadow-supervisor.ts'

/** Durable host-plane control for the optional resident recovery loop. */
export class ResidentEvolutionControl {
  private readonly store: EvolutionStore
  private supervisor: ShadowSupervisor | undefined
  private actionTail: Promise<void> = Promise.resolve()

  constructor(store: EvolutionStore) {
    this.store = store
  }

  isPaused(workspaceId: string): boolean {
    return this.store.isRecoveryPaused(workspaceId)
  }

  pause(workspaceId: string): Promise<void> {
    return this.enqueue(async () => {
      // Persist first so a crash can never restart work the operator paused.
      await this.store.setRecoveryPaused(workspaceId, true)
      await this.supervisor?.pause(workspaceId)
    })
  }

  resume(workspaceId: string): Promise<void> {
    return this.enqueue(async () => {
      await this.store.setRecoveryPaused(workspaceId, false)
      this.supervisor?.resume(workspaceId)
    })
  }

  attach(supervisor: ShadowSupervisor): () => void {
    if (this.supervisor !== undefined && this.supervisor !== supervisor) {
      throw new Error('resident evolution supervisor is already attached')
    }
    this.supervisor = supervisor
    return () => {
      if (this.supervisor === supervisor) this.supervisor = undefined
    }
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const result = this.actionTail.then(action)
    this.actionTail = result.then(() => {}, () => {})
    return result
  }
}
