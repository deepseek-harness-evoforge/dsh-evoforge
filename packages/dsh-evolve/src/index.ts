import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { installGenerationBinder } from './generation-binder.ts'
import { GitSkillSource, type GitSkillSourceConfig } from './git-skill-source.ts'
import { openEvolutionStore, type EvolutionStore } from './generation-store.ts'
import { ShadowSupervisor } from './shadow-supervisor.ts'
import { createShadowJobRunner } from './shadow-job-runner.ts'
import { runShadow } from './shadow.ts'
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
  supervisor?: {
    runRoots: string[]
    scanIntervalMs?: number
  }
}

export const Config: Schema<Config> = z.object({
  cacheRoot: z.string(),
  sources: z.array(z.object({
    name: z.string().required(),
    repository: z.string().required(),
    path: z.string().required(),
  })).default([]),
  supervisor: z.object({
    runRoots: z.array(z.string()).default([]),
    scanIntervalMs: z.number().step(1).min(1_000).default(30_000),
  }),
})

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const source = new GitSkillSource(
    config.cacheRoot ?? join(homedir(), '.dsh', 'evoforge', 'git-skills'),
    config.sources ?? [],
  )
  const store = new VerifiedEvolutionStore(await openEvolutionStore(ctx.storageDomain), source)
  ctx.provide('evoforge.evolution', store)
  const disposeBinder = installGenerationBinder(ctx, store, source)
  if (config.supervisor !== undefined && config.supervisor.runRoots.length > 0) {
    // Jobs is optional for the base release kernel. A configured supervisor activates
    // only when the host composes the native process-local Jobs service.
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.jobs.attachController('dsh-evolve-shadow-supervisor')
      const supervisor = new ShadowSupervisor({
        runRoots: config.supervisor!.runRoots,
        scanIntervalMs: config.supervisor!.scanIntervalMs ?? 30_000,
        runner: createShadowJobRunner(jobCtx.jobs, runShadow),
        onError: (error, path) => {
          jobCtx.logger.warn(`dsh-evolve supervisor skipped ${path}: ${String(error)}`)
        },
      })
      jobCtx.effect(() => {
        supervisor.start()
        return () => supervisor.stop()
      }, 'dsh-evolve.shadowSupervisor')
    })
  }
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
export type { ShadowResumeInvocation, ShadowSupervisorOptions } from './shadow-supervisor.ts'
