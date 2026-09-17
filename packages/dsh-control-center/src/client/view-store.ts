import { defineStore } from '@deepseek-ai/dsh-client-store'

interface ControlCenterSelection {
  requested: string | null
}

/** A view preference only; DSH owns its per-Session instances and persistence. */
export function createControlCenterViewStore() {
  const handle = defineStore({
    init: (): ControlCenterSelection => ({ requested: null }),
    persist: 'evoforge.control-center.view',
    actions: {
      selectSurface: (draft, id: string) => { draft.requested = id },
    },
  })
  return {
    ...handle,
    create(scopeKey?: string) {
      const instance = handle.create(scopeKey)
      // Browser preferences are untrusted and may come from an incompatible older build.
      const value: unknown = instance.getSnapshot()
      if (value === null || typeof value !== 'object' || Array.isArray(value)
        || !('requested' in value) || (value.requested !== null && typeof value.requested !== 'string')) {
        instance.store.set({ requested: null })
      }
      return instance
    },
  }
}

export type ControlCenterViewStore = ReturnType<typeof createControlCenterViewStore>
