import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  defineDomain,
  domainTable,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { afterEach, describe, expect, it } from 'vitest'
import {
  openCapabilityGapStore,
  type CapabilityGap,
} from '../src/capability-gap-store.ts'
import { openDeliveryOutcomeStore } from '../src/delivery-outcome-monitor.ts'
import { openFeedbackSignalStore } from '../src/feedback-signal-monitor.ts'
import {
  openInteractionEpisodeStore,
  type InteractionEpisodeInputV1,
} from '../src/interaction-episode-store.ts'
import {
  CompletedInteractionGapRecorder,
  openInteractionCapabilityGapStore,
} from '../src/interaction-capability-gap-store.ts'
import {
  openSkillCandidateStore,
  type ExperienceSkillCandidateInput,
} from '../src/skill-candidate-repository.ts'
import { ExperienceDrivenSkillOpportunityDiscovery } from '../src/skill-opportunity-discovery.ts'
import { completedOwnedGapTurnQualification } from './capability-gap-authoring-qualification-fixture.ts'
import { OTHER_WORKSPACE_ID, WORKSPACE_ID } from './workspace-fixture.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []
const legacyHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const legacySafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const legacyGapV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  id: legacyHashSchema,
  observedAt: legacySafeIntegerSchema,
  workspaceId: z.uuid(),
  sessionId: z.string().min(1).max(256),
  requestedSkill: z.string().min(1).max(128),
  catalogHash: legacyHashSchema,
  catalogSize: legacySafeIntegerSchema,
  generationId: legacyHashSchema.optional(),
  goal: z.strictObject({
    id: z.string().min(1).max(512),
    revision: legacySafeIntegerSchema,
    objective: z.string().min(1).max(8_192),
  }).optional(),
  abstention: z.strictObject({ reason: z.literal('missing-native-goal') }).optional(),
  status: z.literal('confirmed'),
  evidence: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('native-skill-miss'),
      catalog: z.literal('complete'),
      routing: z.literal('requested-skill-absent'),
      providers: z.literal('settled'),
    }),
    z.strictObject({
      kind: z.literal('model-declared-skill-gap'),
      catalog: z.literal('complete'),
      routing: z.literal('model-declared-no-applicable-skill'),
      providers: z.literal('settled'),
    }),
  ]),
})
const legacyGapV1DomainSpec = defineDomain({
  name: 'evoforge_capability_gaps',
  version: 1,
  tables: { gaps: domainTable<string, z.infer<typeof legacyGapV1Schema>>(legacyGapV1Schema) },
})

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('Capability Gap durable queue', () => {
  it('seals exact Interaction episodes by completed turn and recovers them without cross-Workspace reads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-interaction-episodes-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const firstCtx = await bootStorage(configPath)
    const firstStore = await openInteractionEpisodeStore(firstCtx.storageDomain)
    let firstId = ''
    let secondId = ''
    try {
      const first = await firstStore.seal(interactionEpisodeInput(1))
      const duplicate = await firstStore.seal(interactionEpisodeInput(1))
      const second = await firstStore.seal(interactionEpisodeInput(2))

      expect(first.created).toBe(true)
      expect(duplicate).toEqual({ created: false, episode: first.episode })
      expect(second.created).toBe(true)
      expect(second.episode.id).not.toBe(first.episode.id)
      expect(Object.isFrozen(first.episode)).toBe(true)
      expect(firstStore.get(WORKSPACE_ID, first.episode.id)).toEqual(first.episode)
      expect(firstStore.get(OTHER_WORKSPACE_ID, first.episode.id)).toBeUndefined()
      firstId = first.episode.id
      secondId = second.episode.id
    } finally {
      await firstStore.close()
      await firstCtx.fiber.dispose()
    }

    const resumedCtx = await bootStorage(configPath)
    const resumedStore = await openInteractionEpisodeStore(resumedCtx.storageDomain)
    try {
      expect(resumedStore.get(WORKSPACE_ID, firstId)).toMatchObject({
        schemaVersion: 1,
        kind: 'interaction-episode-v1',
        id: firstId,
        session: { id: 'shared-session' },
        source: { turn: 1, turnEndSeq: 8 },
      })
      expect(resumedStore.get(WORKSPACE_ID, secondId)).toMatchObject({
        id: secondId,
        session: { id: 'shared-session' },
        source: { turn: 2, turnEndSeq: 17 },
      })
    } finally {
      await resumedStore.close()
      await resumedCtx.fiber.dispose()
    }
  })

  it('serializes concurrent Episode seals, snapshots inputs, and rejects conflicting claims for one turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-interaction-episode-conflict-'))
    temporaryRoots.push(root)
    const ctx = await bootStorage(await writeStorageConfig(root))
    const store = await openInteractionEpisodeStore(ctx.storageDomain)
    const input = interactionEpisodeInput(1)
    try {
      const firstPending = store.seal(input)
      const duplicatePending = store.seal(input)
      input.trigger.requestedSkill = 'mutated-after-submit'
      const results = await Promise.all([firstPending, duplicatePending])

      expect(results.map(result => result.created).sort()).toEqual([false, true])
      expect(results[0]!.episode.trigger.requestedSkill).toBe('publish-dsh-plugin')
      expect(Object.isFrozen(results[0]!.episode.trigger)).toBe(true)

      const conflict = interactionEpisodeInput(1)
      conflict.replay.turnDigest = '8'.repeat(64)
      await expect(store.seal(conflict)).rejects.toThrow(/source conflicts/u)

      const shiftedSource = interactionEpisodeInput(1)
      shiftedSource.source = {
        ...shiftedSource.source,
        prefixThroughSeq: 19,
        enqueueSeq: 20,
        turnStartSeq: 21,
        claimSeq: 22,
        initiatingMessageSeq: 24,
        triggerCallSeq: 25,
        triggerResultSeq: 26,
        turnEndSeq: 28,
      }
      await expect(store.seal(shiftedSource)).rejects.toThrow(/source conflicts/u)
      expect(store.get(WORKSPACE_ID, results[0]!.episode.id)).toEqual(results[0]!.episode)

      await store.close()
      await expect(store.seal(interactionEpisodeInput(2))).rejects.toThrow(/closing/u)
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('fails closed when a durable Episode table key drifts from its content identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-interaction-episode-integrity-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const firstCtx = await bootStorage(configPath)
    const firstStore = await openInteractionEpisodeStore(firstCtx.storageDomain)
    try {
      await firstStore.seal(interactionEpisodeInput(1))
    } finally {
      await firstStore.close()
      await firstCtx.fiber.dispose()
    }

    const path = join(root, 'storage', 'evoforge_interaction_episodes.json')
    const document = JSON.parse(await readFile(path, 'utf8')) as {
      tables: { episodes: Record<string, unknown> }
    }
    const entry = Object.entries(document.tables.episodes)[0]
    if (entry === undefined) throw new Error('expected one durable Interaction episode')
    const [id, episode] = entry
    const wrongKey = `${id[0] === '0' ? '1' : '0'}${id.slice(1)}`
    document.tables.episodes = { [wrongKey]: episode }
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`)

    const resumedCtx = await bootStorage(configPath)
    try {
      await expect(openInteractionEpisodeStore(resumedCtx.storageDomain)).rejects.toThrow(
        /table key/u,
      )
    } finally {
      await resumedCtx.fiber.dispose()
    }
  })

  it('derives and recovers a reference-only Interaction Gap from a sealed Episode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-interaction-gap-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const firstCtx = await bootStorage(configPath)
    const firstEpisodes = await openInteractionEpisodeStore(firstCtx.storageDomain)
    const firstGaps = await openInteractionCapabilityGapStore(
      firstCtx.storageDomain,
      firstEpisodes,
    )
    const recorder = new CompletedInteractionGapRecorder(firstEpisodes, firstGaps)
    let gapId = ''
    try {
      const first = await recorder.recordCompleted(interactionEpisodeInput(1))
      const duplicate = await recorder.recordCompleted(interactionEpisodeInput(1))

      expect(first.episodeCreated).toBe(true)
      expect(first.gapCreated).toBe(true)
      expect(duplicate.episodeCreated).toBe(false)
      expect(duplicate.gapCreated).toBe(false)
      expect(first.episode.id).toBe(
        'a095daf96ddf0f8b45511190160714922a940d1ec393225753e7de6f3cc8a5ef',
      )
      expect(first.gap.id).toBe(
        'd088da15b7ec3c3903af417c8b5b6cbfc2a0a8d79b4051b3d6ae8461a03c8104',
      )
      expect(first.gap).toEqual({
        schemaVersion: 1,
        kind: 'interaction-capability-gap-v1',
        id: first.gap.id,
        experience: {
          kind: 'interaction-episode-v1',
          workspaceId: WORKSPACE_ID,
          episodeId: first.episode.id,
        },
      })
      expect(firstGaps.list(WORKSPACE_ID)).toEqual([{ gap: first.gap, episode: first.episode }])
      expect(firstGaps.get(OTHER_WORKSPACE_ID, first.gap.id)).toBeUndefined()

      const forgedEpisode = structuredClone(first.episode)
      forgedEpisode.trigger.catalogHash = '8'.repeat(64)
      await expect(firstGaps.derive(forgedEpisode)).rejects.toThrow(/sealed source/u)
      gapId = first.gap.id
    } finally {
      await firstGaps.close()
      await firstEpisodes.close()
      await firstCtx.fiber.dispose()
    }

    const resumedCtx = await bootStorage(configPath)
    const resumedEpisodes = await openInteractionEpisodeStore(resumedCtx.storageDomain)
    const resumedGaps = await openInteractionCapabilityGapStore(
      resumedCtx.storageDomain,
      resumedEpisodes,
    )
    try {
      expect(resumedGaps.get(WORKSPACE_ID, gapId)).toMatchObject({
        gap: {
          id: gapId,
          experience: { kind: 'interaction-episode-v1', workspaceId: WORKSPACE_ID },
        },
        episode: {
          kind: 'interaction-episode-v1',
          session: { id: 'shared-session' },
          trigger: { requestedSkill: 'publish-dsh-plugin' },
        },
      })
    } finally {
      await resumedGaps.close()
      await resumedEpisodes.close()
      await resumedCtx.fiber.dispose()
    }
  })

  it('repairs an orphan Episode when the derived Gap write is retried', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-interaction-gap-retry-'))
    temporaryRoots.push(root)
    const ctx = await bootStorage(await writeStorageConfig(root))
    const episodes = await openInteractionEpisodeStore(ctx.storageDomain)
    const gaps = await openInteractionCapabilityGapStore(ctx.storageDomain, episodes)
    let injectFailure = true
    const recorder = new CompletedInteractionGapRecorder(episodes, {
      derive: async (episode) => {
        if (injectFailure) {
          injectFailure = false
          throw new Error('injected Interaction Gap write failure')
        }
        return gaps.derive(episode)
      },
    })
    const input = interactionEpisodeInput(1)
    try {
      await expect(recorder.recordCompleted(input)).rejects.toThrow(/injected/u)
      expect(gaps.list(WORKSPACE_ID)).toEqual([])
      expect((await episodes.seal(input)).created).toBe(false)

      const repaired = await recorder.recordCompleted(input)
      expect(repaired.episodeCreated).toBe(false)
      expect(repaired.gapCreated).toBe(true)
      const duplicate = await recorder.recordCompleted(input)
      expect(duplicate.episodeCreated).toBe(false)
      expect(duplicate.gapCreated).toBe(false)
      expect(gaps.list(WORKSPACE_ID)).toEqual([{
        gap: repaired.gap,
        episode: repaired.episode,
      }])
    } finally {
      await gaps.close()
      await episodes.close()
      await ctx.fiber.dispose()
    }
  })

  it('fails closed on a durable Interaction Gap whose Episode was lost', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-interaction-gap-dangling-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const firstCtx = await bootStorage(configPath)
    const firstEpisodes = await openInteractionEpisodeStore(firstCtx.storageDomain)
    const firstGaps = await openInteractionCapabilityGapStore(
      firstCtx.storageDomain,
      firstEpisodes,
    )
    try {
      await new CompletedInteractionGapRecorder(firstEpisodes, firstGaps)
        .recordCompleted(interactionEpisodeInput(1))
    } finally {
      await firstGaps.close()
      await firstEpisodes.close()
      await firstCtx.fiber.dispose()
    }

    const episodePath = join(root, 'storage', 'evoforge_interaction_episodes.json')
    const originalEpisodeDocument = await readFile(episodePath, 'utf8')
    const document = JSON.parse(originalEpisodeDocument) as {
      tables: { episodes: Record<string, unknown> }
    }
    document.tables.episodes = {}
    await writeFile(episodePath, `${JSON.stringify(document, null, 2)}\n`)

    const danglingCtx = await bootStorage(configPath)
    const missingEpisodes = await openInteractionEpisodeStore(danglingCtx.storageDomain)
    try {
      await expect(openInteractionCapabilityGapStore(
        danglingCtx.storageDomain,
        missingEpisodes,
      )).rejects.toThrow(/references missing Episode/u)
    } finally {
      await missingEpisodes.close()
      await danglingCtx.fiber.dispose()
    }

    await writeFile(episodePath, originalEpisodeDocument)
    const repairedCtx = await bootStorage(configPath)
    const repairedEpisodes = await openInteractionEpisodeStore(repairedCtx.storageDomain)
    const repairedGaps = await openInteractionCapabilityGapStore(
      repairedCtx.storageDomain,
      repairedEpisodes,
    )
    try {
      expect(repairedGaps.list(WORKSPACE_ID)).toHaveLength(1)
    } finally {
      await repairedGaps.close()
      await repairedEpisodes.close()
      await repairedCtx.fiber.dispose()
    }
  })

  it('preserves the legacy Goal-qualified Gap V1 identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-legacy-gap-identity-'))
    temporaryRoots.push(root)
    const ctx = await bootStorage(await writeStorageConfig(root))
    const store = await openCapabilityGapStore(ctx.storageDomain)
    try {
      const input = gapInput(1, 'first-missing')
      const recorded = await store.record(input)
      expect(recorded.gap).toEqual({
        schemaVersion: 1,
        id: '4a4c8a4aea980fcd6f2788581a29fd56b6711b90763e16b43b3d5e8ed1f0db62',
        ...input,
        status: 'confirmed',
      })
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('durably qualifies one exact model-declared Gap only after a completed owned Tool turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-gap-authoring-qualification-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const first = await bootStorage(configPath)
    const store = await openCapabilityGapStore(first.storageDomain)
    let gapId = ''
    let qualification: ReturnType<typeof completedOwnedGapTurnQualification> | undefined
    try {
      const recorded = await store.record({
        ...authoritativeGapInput(1, 'first-missing'),
        generationId: undefined,
        abstention: undefined,
      })
      gapId = recorded.gap.id
      qualification = completedOwnedGapTurnQualification(recorded.gap, 'store-durability')
      expect(recorded.gap.authoringQualification).toBeUndefined()
      expect(recorded.gap).not.toHaveProperty('generationId')
      expect(recorded.gap).not.toHaveProperty('abstention')

      const qualified = await store.qualifyForAuthoring(gapId, qualification)
      expect(qualified).toEqual({
        qualified: true,
        gap: { ...recorded.gap, authoringQualification: qualification },
      })
      await expect(store.qualifyForAuthoring(gapId, qualification)).resolves.toEqual({
        qualified: false,
        gap: qualified.gap,
      })
      await expect(store.record({
        ...authoritativeGapInput(1, 'first-missing'),
        generationId: undefined,
        abstention: undefined,
      })).resolves.toEqual({ created: false, gap: qualified.gap })
      expect(qualified.gap.id).toBe(recorded.gap.id)
    } finally {
      await store.close()
      await first.fiber.dispose()
    }

    const resumed = await bootStorage(configPath)
    const recovered = await openCapabilityGapStore(resumed.storageDomain)
    try {
      expect(recovered.list(WORKSPACE_ID)).toEqual([expect.objectContaining({
        id: gapId,
        authoringQualification: qualification,
      })])
    } finally {
      await recovered.close()
      await resumed.fiber.dispose()
    }
  })

  it('rejects transferring a valid qualification from Gap A to Gap B', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-gap-authority-transfer-'))
    temporaryRoots.push(root)
    const ctx = await bootStorage(await writeStorageConfig(root))
    const store = await openCapabilityGapStore(ctx.storageDomain)
    try {
      const gapA = (await store.record(authoritativeGapInput(1, 'gap-a'))).gap
      const gapB = (await store.record(authoritativeGapInput(2, 'gap-b'))).gap
      const qualificationA = completedOwnedGapTurnQualification(gapA, 'gap-a')

      await expect(store.qualifyForAuthoring(gapB.id, qualificationA)).rejects.toThrow(
        /does not exactly bind/u,
      )
      const retained = store.list(WORKSPACE_ID)
      expect(retained.map(gap => gap.id).sort()).toEqual([gapA.id, gapB.id].sort())
      expect(retained.every(gap => gap.authoringQualification === undefined)).toBe(true)
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('accepts only an exact duplicate of one durable qualification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-gap-authority-conflict-'))
    temporaryRoots.push(root)
    const ctx = await bootStorage(await writeStorageConfig(root))
    const store = await openCapabilityGapStore(ctx.storageDomain)
    try {
      const gap = (await store.record(authoritativeGapInput(1, 'conflicting-proof'))).gap
      const first = completedOwnedGapTurnQualification(gap, 'first-proof')
      const conflicting = completedOwnedGapTurnQualification(gap, 'conflicting-proof')

      await expect(store.qualifyForAuthoring(gap.id, first)).resolves.toMatchObject({
        qualified: true,
      })
      await expect(store.qualifyForAuthoring(gap.id, first)).resolves.toMatchObject({
        qualified: false,
      })
      await expect(store.qualifyForAuthoring(gap.id, conflicting)).rejects.toThrow(
        /conflicts with its durable authoring qualification/u,
      )
      expect(store.list(WORKSPACE_ID)[0]?.authoringQualification).toEqual(first)
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('repairs a failed authority-first prune when duplicate record retries', async () => {
    const fixture = pruneFailureFacility()
    const store = await openCapabilityGapStore(fixture.facility, { maxRecords: 1 })
    const oldInput = authoritativeGapInput(1, 'old-qualified-gap')
    const oldGap = (await store.record(oldInput)).gap
    await store.qualifyForAuthoring(
      oldGap.id,
      completedOwnedGapTurnQualification(oldGap, 'old-qualified-gap'),
    )
    fixture.failNextQualificationDelete()

    const newerInput = authoritativeGapInput(2, 'newer-gap')
    await expect(store.record(newerInput)).rejects.toThrow(/injected qualification delete/u)
    expect(() => store.list(WORKSPACE_ID)).toThrow(/reconciliation is incomplete/u)

    await expect(store.record(oldInput)).rejects.toThrow(/expired during retention/u)
    const retained = store.list(WORKSPACE_ID)
    expect(retained).toHaveLength(1)
    const repaired = await store.record(newerInput)
    expect(repaired.created).toBe(false)
    expect(repaired.gap).toEqual(retained[0])
    expect(store.list(WORKSPACE_ID)).toEqual([repaired.gap])
    expect(fixture.gaps.has(oldGap.id)).toBe(false)
    expect(fixture.qualifications.has(oldGap.id)).toBe(false)
    await store.close()
  })

  it('repairs an over-cap qualified store before exposing it after reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-gap-reopen-prune-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const writerCtx = await bootStorage(configPath)
    const writer = await openCapabilityGapStore(writerCtx.storageDomain, { maxRecords: 2 })
    let oldId = ''
    let retainedId = ''
    try {
      const oldGap = (await writer.record(authoritativeGapInput(1, 'old-reopen-gap'))).gap
      oldId = oldGap.id
      await writer.qualifyForAuthoring(
        oldGap.id,
        completedOwnedGapTurnQualification(oldGap, 'old-reopen-gap'),
      )
      retainedId = (await writer.record(authoritativeGapInput(2, 'retained-reopen-gap'))).gap.id
    } finally {
      await writer.close()
      await writerCtx.fiber.dispose()
    }

    const resumedCtx = await bootStorage(configPath)
    const resumed = await openCapabilityGapStore(resumedCtx.storageDomain, { maxRecords: 1 })
    try {
      expect(resumed.list(WORKSPACE_ID).map(gap => gap.id)).toEqual([retainedId])
      const sidecar = JSON.parse(await readFile(
        join(root, 'storage', 'evoforge_capability_gap_authoring_qualifications.json'),
        'utf8',
      )) as { tables: { qualifications: Record<string, unknown> } }
      expect(sidecar.tables.qualifications).not.toHaveProperty(oldId)
    } finally {
      await resumed.close()
      await resumedCtx.fiber.dispose()
    }
  })

  it('keeps the Gap v1 medium readable by the strict old reader after a new qualification write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-gap-v1-downgrade-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const writerCtx = await bootStorage(configPath)
    const writer = await openCapabilityGapStore(writerCtx.storageDomain)
    let expectedGap: Awaited<ReturnType<typeof writer.record>>['gap']
    try {
      expectedGap = (await writer.record(authoritativeGapInput(1, 'downgrade-gap'))).gap
      const qualification = completedOwnedGapTurnQualification(expectedGap, 'downgrade-gap')
      expectedGap = (await writer.qualifyForAuthoring(expectedGap.id, qualification)).gap
    } finally {
      await writer.close()
      await writerCtx.fiber.dispose()
    }

    const gapDocument = JSON.parse(await readFile(
      join(root, 'storage', 'evoforge_capability_gaps.json'),
      'utf8',
    )) as { tables: { gaps: Record<string, unknown> } }
    expect(gapDocument.tables.gaps[expectedGap.id]).not.toHaveProperty('authoringQualification')

    const oldReaderCtx = await bootStorage(configPath)
    const oldReader = await oldReaderCtx.storageDomain.open(legacyGapV1DomainSpec)
    try {
      expect(oldReader.table('gaps').get(expectedGap.id)).toEqual(
        stripQualification(expectedGap),
      )
    } finally {
      await oldReader.close()
      await oldReaderCtx.fiber.dispose()
    }

    const resumedCtx = await bootStorage(configPath)
    const resumed = await openCapabilityGapStore(resumedCtx.storageDomain)
    try {
      expect(resumed.list(WORKSPACE_ID)).toContainEqual(expectedGap)
    } finally {
      await resumed.close()
      await resumedCtx.fiber.dispose()
    }
  })

  it('fails closed when durable Gap or qualification identity and binding are tampered', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-gap-binding-tamper-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const writerCtx = await bootStorage(configPath)
    const writer = await openCapabilityGapStore(writerCtx.storageDomain)
    let gapId = ''
    try {
      const gap = (await writer.record(authoritativeGapInput(1, 'tamper-gap'))).gap
      gapId = gap.id
      await writer.qualifyForAuthoring(
        gap.id,
        completedOwnedGapTurnQualification(gap, 'tamper-gap'),
      )
    } finally {
      await writer.close()
      await writerCtx.fiber.dispose()
    }

    const qualificationPath = join(
      root,
      'storage',
      'evoforge_capability_gap_authoring_qualifications.json',
    )
    const originalQualificationDocument = await readFile(qualificationPath, 'utf8')
    const qualificationDocument = JSON.parse(originalQualificationDocument) as {
      tables: { qualifications: Record<string, { binding: { requestedSkill: string } }> }
    }

    const qualification = qualificationDocument.tables.qualifications[gapId]!
    const wrongKey = `${gapId[0] === '0' ? '1' : '0'}${gapId.slice(1)}`
    qualificationDocument.tables.qualifications = { [wrongKey]: qualification }
    await writeFile(qualificationPath, `${JSON.stringify(qualificationDocument, null, 2)}\n`)

    const tamperedKeyCtx = await bootStorage(configPath)
    try {
      await expect(openCapabilityGapStore(tamperedKeyCtx.storageDomain)).rejects.toThrow(
        /table key/u,
      )
    } finally {
      await tamperedKeyCtx.fiber.dispose()
    }

    await writeFile(qualificationPath, originalQualificationDocument)
    qualificationDocument.tables.qualifications = { [gapId]: qualification }
    qualificationDocument.tables.qualifications[gapId]!.binding.requestedSkill = 'transferred-skill'
    await writeFile(qualificationPath, `${JSON.stringify(qualificationDocument, null, 2)}\n`)

    const tamperedQualificationCtx = await bootStorage(configPath)
    try {
      await expect(openCapabilityGapStore(tamperedQualificationCtx.storageDomain)).rejects.toThrow()
    } finally {
      await tamperedQualificationCtx.fiber.dispose()
    }

    await writeFile(qualificationPath, originalQualificationDocument)
    const gapPath = join(root, 'storage', 'evoforge_capability_gaps.json')
    const originalGapDocument = await readFile(gapPath, 'utf8')
    const gapDocument = JSON.parse(originalGapDocument) as {
      tables: { gaps: Record<string, {
        sessionId: string
        goal: { objective: string }
      }> }
    }
    gapDocument.tables.gaps[gapId]!.goal.objective = 'tampered but legacy-id-stable objective'
    await writeFile(gapPath, `${JSON.stringify(gapDocument, null, 2)}\n`)

    const tamperedBindingCtx = await bootStorage(configPath)
    try {
      await expect(openCapabilityGapStore(tamperedBindingCtx.storageDomain)).rejects.toThrow(
        /does not exactly bind/u,
      )
    } finally {
      await tamperedBindingCtx.fiber.dispose()
    }

    await writeFile(gapPath, originalGapDocument)
    const orphanedQualificationDocument = JSON.parse(originalGapDocument) as {
      tables: { gaps: Record<string, unknown> }
    }
    delete orphanedQualificationDocument.tables.gaps[gapId]
    await writeFile(gapPath, `${JSON.stringify(orphanedQualificationDocument, null, 2)}\n`)

    const orphanedQualificationCtx = await bootStorage(configPath)
    try {
      await expect(openCapabilityGapStore(orphanedQualificationCtx.storageDomain)).rejects.toThrow(
        /references missing Gap/u,
      )
    } finally {
      await orphanedQualificationCtx.fiber.dispose()
    }

    await writeFile(gapPath, originalGapDocument)
    const identityDocument = JSON.parse(originalGapDocument) as {
      tables: { gaps: Record<string, { sessionId: string }> }
    }
    identityDocument.tables.gaps[gapId]!.sessionId = 'tampered-session'
    await writeFile(gapPath, `${JSON.stringify(identityDocument, null, 2)}\n`)

    const tamperedGapCtx = await bootStorage(configPath)
    try {
      await expect(openCapabilityGapStore(tamperedGapCtx.storageDomain)).rejects.toThrow(
        /content-address audit/u,
      )
    } finally {
      await tamperedGapCtx.fiber.dispose()
    }
  })

  it('does not let the record seam inject completed-turn authoring authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-gap-authoring-injection-'))
    temporaryRoots.push(root)
    const ctx = await bootStorage(await writeStorageConfig(root))
    const store = await openCapabilityGapStore(ctx.storageDomain)
    try {
      const source = (await store.record(authoritativeGapInput(1, 'authority-source'))).gap
      const input = authoritativeGapInput(2, 'injected-authority')
      await expect(store.record({
        ...input,
        authoringQualification: completedOwnedGapTurnQualification(
          source,
          'injected-authority',
        ),
      } as never)).rejects.toThrow()
      expect(store.list(WORKSPACE_ID)).toEqual([source])
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('deduplicates content identity, evicts oldest records, and recovers after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-capability-gaps-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const first = await bootStorage(configPath)
    const store = await openCapabilityGapStore(first.storageDomain, { maxRecords: 2 })
    let retainedIds: string[] = []
    try {
      const firstResult = await store.record(gapInput(1, 'first-missing'))
      const duplicate = await store.record(gapInput(1, 'first-missing'))
      expect(duplicate).toEqual({ created: false, gap: firstResult.gap })
      expect(Object.isFrozen(firstResult.gap)).toBe(true)

      await store.record(gapInput(2, 'second-missing'))
      await store.record({
        ...gapInput(3, 'third-missing'),
        evidence: {
          kind: 'model-declared-skill-gap' as const,
          catalog: 'complete' as const,
          routing: 'model-declared-no-applicable-skill' as const,
          providers: 'settled' as const,
        },
      })
      const retained = store.list(WORKSPACE_ID)
      expect(retained.map(gap => gap.requestedSkill)).toEqual(['third-missing', 'second-missing'])
      expect(retained[0]?.evidence).toEqual({
        kind: 'model-declared-skill-gap',
        catalog: 'complete',
        routing: 'model-declared-no-applicable-skill',
        providers: 'settled',
      })
      expect(retained.every(gap => /^[a-f0-9]{64}$/.test(gap.id))).toBe(true)
      expect(retained.every(gap => gap.status === 'confirmed')).toBe(true)
      retainedIds = retained.map(gap => gap.id)
    } finally {
      await store.close()
      await first.fiber.dispose()
    }

    const resumed = await bootStorage(configPath)
    const recovered = await openCapabilityGapStore(resumed.storageDomain, { maxRecords: 2 })
    try {
      expect(recovered.list(WORKSPACE_ID).map(gap => gap.id)).toEqual(retainedIds)
    } finally {
      await recovered.close()
      await resumed.fiber.dispose()
    }
  })

  it('rejects a Capability Gap whose evidence kind and routing provenance disagree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-capability-gap-evidence-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const ctx = await bootStorage(configPath)
    const store = await openCapabilityGapStore(ctx.storageDomain)
    try {
      const input = gapInput(1, 'mismatched-gap')
      await expect(store.record({
        ...input,
        evidence: {
          ...input.evidence,
          routing: 'model-declared-no-applicable-skill',
        },
      } as never)).rejects.toThrow()
      expect(store.list(WORKSPACE_ID)).toEqual([])
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('snapshots Gap, Feedback, and Delivery evidence before queued persistence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-evidence-snapshot-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const ctx = await bootStorage(configPath)
    const gaps = await openCapabilityGapStore(ctx.storageDomain)
    const feedback = await openFeedbackSignalStore(ctx.storageDomain)
    const outcomes = await openDeliveryOutcomeStore(ctx.storageDomain)
    try {
      const gap = gapInput(10, 'snapshot-gap')
      const pendingGap = gaps.record(gap)
      gap.requestedSkill = 'mutated-gap'
      expect((await pendingGap).gap.requestedSkill).toBe('snapshot-gap')

      const session = {
        observedAt: 20,
        workspaceId: WORKSPACE_ID,
        sessionId: 'snapshot-feedback',
        items: [{
          id: 'a'.repeat(64),
          messageId: 'snapshot-message',
          feedbackVersion: '00000000-0000-4000-8000-000000000001',
          sourceUpdatedAt: 20,
          attribution: {
            kind: 'exact-skill-invocation-v1' as const,
            skillName: 'snapshot-gap',
            route: 'model-tool' as const,
            invocationSeq: 1,
            assistantSeq: 1,
            turn: 1,
            goal: { id: 'snapshot-goal', revision: 1 },
          },
        }],
      }
      const pendingFeedback = feedback.replaceSession(session)
      session.items[0]!.messageId = 'mutated-message'
      expect(feedback.list(WORKSPACE_ID)).toHaveLength(0)
      await pendingFeedback
      expect(feedback.get('a'.repeat(64), WORKSPACE_ID)?.messageId).toBe('snapshot-message')

      const outcome = {
        observedAt: 30,
        workspaceId: WORKSPACE_ID,
        sessionId: 'snapshot-outcome',
        callId: 'snapshot-call',
        goal: { id: 'snapshot-goal', revision: 1, phase: 'complete' as const },
        status: 'passed' as const,
        reason: 'verified',
      }
      const pendingOutcome = outcomes.record(outcome)
      outcome.goal.id = 'mutated-goal'
      expect((await pendingOutcome).outcome.goal.id).toBe('snapshot-goal')
    } finally {
      await Promise.all([gaps.close(), feedback.close(), outcomes.close()])
      await ctx.fiber.dispose()
    }
  })

  it('recovers exact internal correction and delivery context for one Skill Opportunity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-opportunity-evidence-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const first = await bootStorage(configPath)
    const gaps = await openCapabilityGapStore(first.storageDomain)
    const feedback = await openFeedbackSignalStore(first.storageDomain)
    const outcomes = await openDeliveryOutcomeStore(first.storageDomain)
    try {
      const firstGap = await gaps.record({
        ...authoritativeGapInput(100, 'release-dsh-plugin'),
        sessionId: 'session-a',
        goal: { id: 'goal-a', revision: 1, objective: 'Release the first native plugin.' },
      })
      await gaps.qualifyForAuthoring(
        firstGap.gap.id,
        completedOwnedGapTurnQualification(firstGap.gap, 'durable-gap-a'),
      )
      const secondGap = await gaps.record({
        ...authoritativeGapInput(200, 'release-dsh-plugin'),
        sessionId: 'session-b',
        goal: { id: 'goal-b', revision: 1, objective: 'Release another native plugin.' },
      })
      await gaps.qualifyForAuthoring(
        secondGap.gap.id,
        completedOwnedGapTurnQualification(secondGap.gap, 'durable-gap-b'),
      )
      await feedback.replaceSession({
        observedAt: 120,
        workspaceId: WORKSPACE_ID,
        sessionId: 'session-a',
        items: [{
          id: 'a'.repeat(64),
          messageId: 'feedback-message-a',
          feedbackVersion: '00000000-0000-4000-8000-000000000001',
          sourceUpdatedAt: 120,
          attribution: {
            kind: 'exact-skill-invocation-v1',
            skillName: 'release-dsh-plugin',
            route: 'model-tool',
            invocationSeq: 3,
            assistantSeq: 5,
            turn: 1,
            goal: { id: 'goal-a', revision: 1 },
          },
        }],
      })
      await outcomes.record({
        observedAt: 130,
        workspaceId: WORKSPACE_ID,
        sessionId: 'delivery-session-a',
        callId: 'delivery-call-a',
        goal: { id: 'goal-a', revision: 1, phase: 'active' },
        status: 'failed',
        reason: 'release verification failed',
      })
      expect(new ExperienceDrivenSkillOpportunityDiscovery(gaps, { feedback, outcomes })
        .discover(WORKSPACE_ID)[0]?.evidence).toMatchObject({
          correctionSignals: { count: 1, ids: ['a'.repeat(64)] },
          deliveryOutcomes: { total: 1, passed: 0, failed: 1, unknown: 0 },
          causalClaim: 'none',
        })
    } finally {
      await Promise.all([gaps.close(), feedback.close(), outcomes.close()])
      await first.fiber.dispose()
    }

    const resumed = await bootStorage(configPath)
    const resumedGaps = await openCapabilityGapStore(resumed.storageDomain)
    const resumedFeedback = await openFeedbackSignalStore(resumed.storageDomain)
    const resumedOutcomes = await openDeliveryOutcomeStore(resumed.storageDomain)
    try {
      const recovered = new ExperienceDrivenSkillOpportunityDiscovery(resumedGaps, {
        feedback: resumedFeedback,
        outcomes: resumedOutcomes,
      }).discover(WORKSPACE_ID)
      expect(recovered).toHaveLength(1)
      expect(recovered[0]?.evidence).toMatchObject({
        correctionSignals: { count: 1, ids: ['a'.repeat(64)] },
        deliveryOutcomes: { total: 1, failed: 1 },
        causalClaim: 'none',
      })
    } finally {
      await Promise.all([resumedGaps.close(), resumedFeedback.close(), resumedOutcomes.close()])
      await resumed.fiber.dispose()
    }
  })

  it('recovers only internally authored quarantined whole-Skill Candidates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-skill-candidate-store-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const first = await bootStorage(configPath)
    const store = await openSkillCandidateStore(first.storageDomain)
    let candidateIds: string[] = []
    try {
      const candidate = await store.recordCandidate(skillCandidateInput('1', 1))
      const duplicate = await store.recordCandidate(skillCandidateInput('1', 1))
      expect(duplicate).toEqual({ created: false, candidate: candidate.candidate })
      const second = await store.recordCandidate(skillCandidateInput('2', 2))
      candidateIds = [second.candidate.id, candidate.candidate.id]
      expect(store.listCandidates(WORKSPACE_ID, '1'.repeat(64))).toEqual([candidate.candidate])
      expect(JSON.stringify(store.listCandidates(WORKSPACE_ID))).not.toMatch(
        /agent-skills|local-git|research|trusted-source/iu,
      )
    } finally {
      await store.close()
      await first.fiber.dispose()
    }

    const resumed = await bootStorage(configPath)
    const recovered = await openSkillCandidateStore(resumed.storageDomain)
    try {
      expect(recovered.listCandidates(WORKSPACE_ID).map(candidate => candidate.id)).toEqual(candidateIds)
      expect(recovered.listCandidates(WORKSPACE_ID)[0]).toMatchObject({
        opportunity: { kind: 'internal-experience-v1' },
        authorship: { kind: 'bounded-model-authoring-v1' },
        version: { kind: 'experience-authored-bundle-v1' },
        artifact: { kind: 'canonical-text-bundle', format: 'tar.gz' },
      })
    } finally {
      await recovered.close()
      await resumed.fiber.dispose()
    }
  })

  it('snapshots Candidate inputs before queued persistence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-candidate-snapshot-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const ctx = await bootStorage(configPath)
    const store = await openSkillCandidateStore(ctx.storageDomain)
    try {
      const input = skillCandidateInput('a', 1)
      const pending = store.recordCandidate(input)
      input.skillName = 'mutated-after-submit'
      input.description = 'mutated after submit'
      const persisted = (await pending).candidate
      expect(persisted.skillName).toBe('release-proof-a')
      expect(persisted.description).toBe('Publish a verified release.')
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('retains every content-addressed Candidate until an explicit governance decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-skill-candidate-retention-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const ctx = await bootStorage(configPath)
    const store = await openSkillCandidateStore(ctx.storageDomain)
    try {
      const base = skillCandidateInput('1', 0)
      for (let index = 0; index < 1_001; index += 1) {
        await store.recordCandidate({
          ...base,
          createdAt: index,
          authorship: {
            ...base.authorship,
            inputDigest: index.toString(16).padStart(64, '0'),
          },
        })
      }
      expect(store.listCandidates(WORKSPACE_ID)).toHaveLength(1_001)
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  }, 30_000)
})

function gapInput(observedAt: number, requestedSkill: string) {
  return {
    observedAt,
    workspaceId: WORKSPACE_ID,
    sessionId: `session-${observedAt}`,
    requestedSkill,
    catalogHash: String(observedAt).repeat(64).slice(0, 64),
    catalogSize: observedAt,
    goal: {
      id: `goal-${observedAt}`,
      revision: observedAt,
      objective: `Complete task ${observedAt}.`,
    },
    evidence: {
      kind: 'native-skill-miss' as const,
      catalog: 'complete' as const,
      routing: 'requested-skill-absent' as const,
      providers: 'settled' as const,
    },
  }
}

function authoritativeGapInput(observedAt: number, requestedSkill: string) {
  return {
    ...gapInput(observedAt, requestedSkill),
    evidence: {
      kind: 'model-declared-skill-gap' as const,
      catalog: 'complete' as const,
      routing: 'model-declared-no-applicable-skill' as const,
      providers: 'settled' as const,
    },
  }
}

function stripQualification(gap: CapabilityGap) {
  const { authoringQualification: _qualification, ...legacy } = gap
  return legacy
}

function pruneFailureFacility(): {
  readonly facility: DomainFacility
  readonly gaps: Map<string, unknown>
  readonly qualifications: Map<string, unknown>
  failNextQualificationDelete(): void
} {
  const gaps = new Map<string, unknown>()
  const qualifications = new Map<string, unknown>()
  let failQualificationDelete = false
  const table = (
    values: Map<string, unknown>,
    beforeDelete?: () => void,
  ) => ({
    get size() { return values.size },
    get: (key: string) => values.get(key),
    entries: () => values.entries(),
    put: async (key: string, value: unknown) => { values.set(key, value) },
    delete: async (key: string) => {
      beforeDelete?.()
      values.delete(key)
    },
  })
  const facility = {
    open: async (spec: { readonly name: string }) => ({
      table: (name: string) => {
        if (spec.name === 'evoforge_capability_gaps' && name === 'gaps') {
          return table(gaps)
        }
        if (spec.name === 'evoforge_capability_gap_authoring_qualifications'
          && name === 'qualifications') {
          return table(qualifications, () => {
            if (failQualificationDelete) {
              failQualificationDelete = false
              throw new Error('injected qualification delete failure')
            }
          })
        }
        throw new Error(`unexpected fake Domain table ${spec.name}/${name}`)
      },
      close: async () => {},
    }),
  } as unknown as DomainFacility
  return {
    facility,
    gaps,
    qualifications,
    failNextQualificationDelete() { failQualificationDelete = true },
  }
}

function interactionEpisodeInput(turn: 1 | 2): InteractionEpisodeInputV1 {
  const offset = turn === 1 ? 0 : 9
  return {
    workspaceId: WORKSPACE_ID,
    session: {
      id: 'shared-session',
      formatVersion: 0,
      createdAt: 1_786_895_000_000,
      inheritedEventCount: 0,
      agentPreset: 'default',
    },
    source: {
      turn,
      prefixThroughSeq: offset === 0 ? null : offset - 1,
      enqueueSeq: offset,
      turnStartSeq: offset + 1,
      claimSeq: offset + 2,
      initiatingMessageSeq: offset + 4,
      triggerCallSeq: offset + 5,
      triggerResultSeq: offset + 6,
      turnEndSeq: offset + 8,
      completedAt: 1_786_896_000_000 + turn,
    },
    ingress: {
      messageId: `message-${turn}`,
      source: 'user',
      digest: String(turn).repeat(64),
    },
    trigger: {
      kind: 'model-declared-skill-gap',
      callId: `gap-call-${turn}`,
      requestedSkill: 'publish-dsh-plugin',
      catalogHash: '3'.repeat(64),
      catalogSize: 0,
      generationId: '4'.repeat(64),
    },
    replay: {
      availability: 'source-dependent',
      transcript: 'exact',
      environment: 'sealed',
      prefixDigest: String(turn + 4).repeat(64),
      turnDigest: String(turn + 6).repeat(64),
      workspaceSnapshotDigest: '9'.repeat(64),
      compositionDigest: 'a'.repeat(64),
      modelDigest: 'b'.repeat(64),
      permissionDigest: 'c'.repeat(64),
      sandboxDigest: 'd'.repeat(64),
      budgetDigest: 'e'.repeat(64),
      dshRevision: 'f'.repeat(40),
      externalEffects: 'none',
    },
  }
}

function skillCandidateInput(marker: string, createdAt: number): ExperienceSkillCandidateInput {
  return {
    createdAt,
    workspaceId: WORKSPACE_ID,
    skillName: `release-proof-${marker}`,
    description: 'Publish a verified release.',
    opportunity: {
      kind: 'internal-experience-v1' as const,
      id: marker.repeat(64),
      gapIds: ['a'.repeat(64), 'b'.repeat(64)],
      goalCount: 2,
    },
    authorship: {
      kind: 'bounded-model-authoring-v1' as const,
      policyId: 'workspace-experience-author',
      modelIdentityHash: 'c'.repeat(64),
      evaluationEvidenceId: 'b'.repeat(64),
      inputDigest: 'd'.repeat(64),
    },
    scope: 'workspace' as const,
    version: {
      kind: 'experience-authored-bundle-v1' as const,
      artifactDigest: 'e'.repeat(64),
      treeHash: 'f'.repeat(64),
    },
    contentHash: 'e'.repeat(64),
    package: {
      path: `release-proof-${marker}`,
      fileCount: 2,
      totalBytes: 512,
      hasScripts: false as const,
      hasReferences: true as const,
    },
    permissions: {
      declared: false,
      executableContent: false as const,
      externalEffects: 'unknown' as const,
    },
    license: { status: 'unknown' as const },
    safety: {
      status: 'quarantined' as const,
      checks: [
        { name: 'artifact-digest-integrity' as const, status: 'passed' as const },
        { name: 'regular-files-only' as const, status: 'passed' as const },
        { name: 'skill-identity' as const, status: 'passed' as const },
        { name: 'effect-review' as const, status: 'required' as const },
      ],
    },
    artifact: {
      kind: 'canonical-text-bundle' as const,
      format: 'tar.gz' as const,
      contentBase64: 'YQ==',
    },
    lifecycle: 'inactive' as const,
    verification: 'unevaluated' as const,
    execution: 'never' as const,
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
  return boot('dsh-evolve-capability-gap-test', configPath)
}
