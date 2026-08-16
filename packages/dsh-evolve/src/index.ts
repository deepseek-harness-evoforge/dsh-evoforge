import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { installGenerationBinder } from './generation-binder.ts'
import { GitSkillSource, type GitSkillSourceConfig } from './git-skill-source.ts'
import { openEvolutionStore, type EvolutionStore } from './generation-store.ts'
import { VerifiedEvolutionStore } from './verified-evolution-store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    'evoforge.evolution': EvolutionStore
  }
}

export const name = 'dsh-evolve'
export const inject = ['storageDomain']

export interface Config {
  cacheRoot?: string
  sources?: GitSkillSourceConfig[]
}

export const Config: Schema<Config> = z.object({
  cacheRoot: z.string(),
  sources: z.array(z.object({
    name: z.string().required(),
    repository: z.string().required(),
    path: z.string().required(),
  })).default([]),
})

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const source = new GitSkillSource(
    config.cacheRoot ?? join(homedir(), '.dsh', 'evoforge', 'git-skills'),
    config.sources ?? [],
  )
  const store = new VerifiedEvolutionStore(await openEvolutionStore(ctx.storageDomain), source)
  ctx.provide('evoforge.evolution', store)
  const disposeBinder = installGenerationBinder(ctx, store, source)
  ctx.effect(() => async () => {
    await disposeBinder()
    await store.close()
  }, 'dsh-evolve.runtimeClose')
}

export type {
  CapabilityGeneration,
  EvolutionStore,
  GenerationInput,
  SessionIdentity,
  SkillGenerationArtifact,
} from './generation-store.ts'
export type { GitSkillSourceConfig } from './git-skill-source.ts'
