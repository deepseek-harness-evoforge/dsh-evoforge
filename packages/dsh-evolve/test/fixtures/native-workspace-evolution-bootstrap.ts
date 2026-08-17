import type { Context } from '@deepseek-ai/cordis'
import * as EvolvePlugin from '../../src/index.ts'

export const name = 'native-workspace-evolution-bootstrap'
export const inject = ['storageDomain', 'workspaceRegistry']

interface Config {
  readonly cacheRoot: string
  readonly repository: string
  readonly skill: string
  readonly workspacePaths: readonly [string, string]
}

/** Register real native Workspaces before composing the Workspace-owned evolution plugin. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const registry = (ctx as unknown as {
    workspaceRegistry: { create(path: string): Promise<{ id: unknown; path: string }> }
  }).workspaceRegistry
  const [left, right] = await Promise.all([
    registry.create(config.workspacePaths[0]),
    registry.create(config.workspacePaths[1]),
  ])
  const evolutionFiber = ctx.root.plugin(EvolvePlugin, {
    cacheRoot: config.cacheRoot,
    sources: [{
      name: config.skill,
      repository: config.repository,
      path: `skills/${config.skill}`,
    }],
  })
  await evolutionFiber
  ctx.effect(() => () => evolutionFiber.dispose(), 'native-workspace-evolution.evolve')
  ctx.provide('evoforge.nativeWorkspaceEvolutionFixture' as never, Object.freeze({
    workspaceIds: [String(left.id), String(right.id)] as const,
  }) as never)
}
