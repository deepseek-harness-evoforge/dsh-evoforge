import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openSkillUseStore, type SkillUseInput } from '../src/skill-use-monitor.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []
const generationA = 'a'.repeat(64)
const generationB = 'b'.repeat(64)
const contentA = '1'.repeat(64)
const contentB = '2'.repeat(64)

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('exact Skill use store', () => {
  it('persists exact uses and counts cross-Goal reuse only within one content and Generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-skill-use-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)

    const firstCtx = await bootStorage(configPath)
    const first = await openSkillUseStore(firstCtx.storageDomain)
    try {
      const initial = use('session-a', 1, 10, 'goal-1', generationA, contentA, 'model-tool')
      expect((await first.record(initial)).created).toBe(true)
      expect((await first.record(initial)).created).toBe(false)
      await first.record(use('session-a', 2, 11, 'goal-1', generationA, contentA, 'model-tool'))
      await first.record(use('session-b', 1, 12, 'goal-2', generationA, contentA, 'user-explicit'))
      await first.record(use('session-c', 1, 13, 'goal-3', generationA, contentB, 'model-tool'))
      await first.record(use('session-d', 1, 14, 'goal-4', generationB, contentA, 'model-tool'))

      expect(first.summarize(WORKSPACE_ID, generationA, { baselineGenerationId: generationB }))
        .toEqual({
          all: { useCount: 5, goalCount: 4, skillVersionCount: 3, crossGoalSkillVersionCount: 1 },
          selected: { useCount: 4, goalCount: 3, skillVersionCount: 2, crossGoalSkillVersionCount: 1 },
          baseline: { useCount: 1, goalCount: 1, skillVersionCount: 1, crossGoalSkillVersionCount: 0 },
          items: [{
            skillName: 'release-dsh-plugin',
            invocationContentHash: contentA,
            generationId: generationA,
            useCount: 3,
            goalCount: 2,
            routes: { userExplicit: 1, modelTool: 2 },
            firstObservedAt: 10,
            lastObservedAt: 12,
            status: 'cross-goal-observed',
            causalClaim: 'none',
            releaseAuthority: 'none',
          }, {
            skillName: 'release-dsh-plugin',
            invocationContentHash: contentA,
            generationId: generationB,
            useCount: 1,
            goalCount: 1,
            routes: { userExplicit: 0, modelTool: 1 },
            firstObservedAt: 14,
            lastObservedAt: 14,
            status: 'observed',
            causalClaim: 'none',
            releaseAuthority: 'none',
          }, {
            skillName: 'release-dsh-plugin',
            invocationContentHash: contentB,
            generationId: generationA,
            useCount: 1,
            goalCount: 1,
            routes: { userExplicit: 0, modelTool: 1 },
            firstObservedAt: 13,
            lastObservedAt: 13,
            status: 'observed',
            causalClaim: 'none',
            releaseAuthority: 'none',
          }],
        })

      await expect(first.record({ ...initial, invocationContentHash: contentB }))
        .rejects.toThrow('source identity changed')
    } finally {
      await first.close()
      await firstCtx.fiber.dispose()
    }

    const resumedCtx = await bootStorage(configPath)
    const resumed = await openSkillUseStore(resumedCtx.storageDomain)
    try {
      expect(resumed.list(WORKSPACE_ID)).toHaveLength(5)
      expect(resumed.summarize(WORKSPACE_ID, generationA).selected)
        .toEqual({ useCount: 4, goalCount: 3, skillVersionCount: 2, crossGoalSkillVersionCount: 1 })
    } finally {
      await resumed.close()
      await resumedCtx.fiber.dispose()
    }
  })
})

function use(
  sessionId: string,
  invocationSeq: number,
  observedAt: number,
  goalId: string,
  generationId: string,
  invocationContentHash: string,
  route: SkillUseInput['route'],
): SkillUseInput {
  return {
    observedAt,
    workspaceId: WORKSPACE_ID,
    sessionId,
    generationId,
    skillName: 'release-dsh-plugin',
    route,
    invocationSeq,
    invocationContentHash,
    goal: { id: goalId, revision: 1 },
  }
}

async function writeStorageConfig(root: string): Promise<string> {
  const packageScope = join(root, 'node_modules', '@deepseek-ai')
  await mkdir(packageScope, { recursive: true })
  for (const [name, source] of [
    ['dsh-storage', join(dshSourceDir, 'packages', 'storage', 'storage')],
    ['dsh-storage-json', join(dshSourceDir, 'packages', 'storage', 'storage-json')],
    ['dsh-storage-domain', join(dshSourceDir, 'packages', 'storage', 'storage-domain')],
  ] as const) {
    await symlink(source, join(packageScope, name), 'dir')
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'storage', name: '@deepseek-ai/dsh-storage' },
    {
      id: 'storage-json',
      name: '@deepseek-ai/dsh-storage-json',
      config: { root: join(root, 'storage') },
    },
    {
      id: 'storage-domain',
      name: '@deepseek-ai/dsh-storage-domain',
      config: { backend: 'json' },
    },
  ], null, 2))
  return configPath
}

async function bootStorage(configPath: string) {
  const { boot } = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href
  )
  return boot('dsh-evolve-skill-use-test', configPath)
}
