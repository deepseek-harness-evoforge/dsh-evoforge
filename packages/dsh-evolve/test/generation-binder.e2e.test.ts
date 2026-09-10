import { realpathSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import * as EvolvePlugin from '../src/index.js'
import { openCapabilityGapStore } from '../src/capability-gap-store.ts'
import type { EvolutionStore } from '../src/generation-store.js'
import {
  compileInteractionGenerationEvidencePolicies,
  openInteractionGenerationEvidenceVault,
  type InteractionGenerationEvidenceSubjectV1,
} from '../src/interaction-generation-evidence.ts'
import {
  compileInteractionRoutingEvidencePolicies,
  openInteractionRoutingEvidenceVault,
} from '../src/interaction-routing-evidence.ts'
import { proveInteractionEpisodeTranscript } from '../src/interaction-episode-projector.ts'
import {
  projectInteractionEpisodeTriggerRequestControlV1,
  type InteractionEpisodeTriggerRequestControlFactV1,
} from '../src/interaction-trigger-request-control.ts'
import {
  assembleSealedSkillBundleArchive,
  assembleSkillBundleArchive,
} from '../src/skill-bundle-archive.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = realpathSync(process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness'))
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (path) => {
    await makeWritable(path)
    await rm(path, { force: true, recursive: true })
  }))
})

describe.skipIf(process.platform !== 'darwin')('Session Generation binder', () => {
  it('turns a natural-language native Goal into a durable model-declared Capability Gap through the real Agent Loop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-model-gap-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const ctx = await bootStorage(configPath)
    const adapter = await installAgentRuntime(ctx, undefined, {
      firstCapabilityGap: 'publish-dsh-plugin',
    })
    await ctx.plugin(EvolvePlugin, {
      cacheRoot: join(root, 'cache'),
      interactionEvidencePolicies: [{
        workspaceId: WORKSPACE_ID,
        retention: { generationMaxRecords: 1 },
      }],
      interactionRoutingEvidencePolicies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 1 },
      }],
    })
    const packages = (path: string) => pathToFileURL(
      join(dshSourceDir, 'packages', path, 'lib', 'index.js'),
    ).href
    const [llm, session] = await Promise.all([
      import(packages('llm/llm')),
      import(packages('core/session')),
    ])
    const handle = await ctx.agents.create({
      sessionId: session.SessionId('model-gap-session'),
      agentOptions: { provider: 'fixed', model: 'fixed' },
      meta: { cwd: root },
    })
    const goals = ctx.get('goals') as {
      create(agent: object, request: { objective: string }): { objective: string }
    } | undefined
    const control = ctx.get('evoforge.evolutionControl') as {
      overview(workspaceId: string, sessionId?: string): Promise<{
        capabilityGaps?: {
          confirmedCount: number
          items: Array<Record<string, unknown>>
        }
      }>
    } | undefined
    if (goals === undefined || control === undefined) {
      throw new Error('Goal or evolution control service did not load')
    }
    const objective = 'Publish this repository as a verified native DSH plugin without asking me to choose a workflow.'
    goals.create(handle.agent, { objective })

    handle.agent.followup(llm.createUserMessage({
      content: [{ type: 'text', text: objective }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()

    const overview = await control.overview(WORKSPACE_ID, 'model-gap-session')
    expect(overview).toMatchObject({ capabilityMap: { status: 'complete' } })
    expect(overview.capabilityGaps).toMatchObject({
      confirmedCount: 1,
      items: [{
        requestedSkill: 'publish-dsh-plugin',
        catalogSize: 0,
        status: 'confirmed',
        goal: { revision: 1, objective },
        evidence: {
          kind: 'model-declared-skill-gap',
          catalog: 'complete',
          routing: 'model-declared-no-applicable-skill',
          providers: 'settled',
        },
      }],
    })
    expect(adapter.requests).toHaveLength(2)
    const followupRequest = JSON.stringify(adapter.requests[1])
    expect(followupRequest)
      .toContain('authoring eligibility is checked only after an exact completed turn, and discovery may not run')
    expect(followupRequest).not.toContain('discovery continues asynchronously')

    const { subject, requestControl } = generationEvidenceQuery(
      handle.agent.session,
      'model-declared-capability-gap',
    )

    await ctx.fiber.dispose()

    const evidenceCtx = await bootStorage(configPath)
    const qualifiedGaps = await openCapabilityGapStore(evidenceCtx.storageDomain)
    const evidence = await openInteractionGenerationEvidenceVault(evidenceCtx.storageDomain, {
      authority: compileInteractionGenerationEvidencePolicies([{
        workspaceId: WORKSPACE_ID,
        retention: { generationMaxRecords: 1 },
      }]),
    })
    const routingEvidence = await openInteractionRoutingEvidenceVault(
      evidenceCtx.storageDomain,
      {
        authority: compileInteractionRoutingEvidencePolicies([{
          workspaceId: WORKSPACE_ID,
          retention: { routingMaxRecords: 1 },
        }]),
      },
    )
    try {
      expect(qualifiedGaps.list(WORKSPACE_ID)).toEqual([
        expect.objectContaining({
          requestedSkill: 'publish-dsh-plugin',
          authoringQualification: expect.objectContaining({
            kind: 'completed-owned-gap-turn-v2',
            sourceDialect: 'deepseek-harness@0.1.2-alpha.5',
          }),
        }),
      ])
      await expect(evidence.resolveGenerationEvidence(subject, {
        triggerRequestControl: requestControl,
      })).resolves.toMatchObject({
        status: 'matched',
        fact: {
          workspaceId: WORKSPACE_ID,
          generation: {
            kind: 'native',
            pin: 'settled',
            effectiveMount: { kind: 'native' },
          },
        },
      })
      await expect(routingEvidence.resolveRoutingEvidence(subject, {
        triggerRequestControl: requestControl,
      })).resolves.toMatchObject({
        status: 'matched',
        fact: {
          workspaceId: WORKSPACE_ID,
          routing: {
            rawTrigger: 'successful-gap-report',
            conclusion: 'model-declared-no-applicable-skill',
          },
        },
      })
    } finally {
      await Promise.all([qualifiedGaps.close(), evidence.close(), routingEvidence.close()])
      await evidenceCtx.fiber.dispose()
    }
  })

  it('keeps Routing evidence unavailable after a Generation-only real Agent Loop gap turn', async () => {
    const { configPath, subject, requestControl } = await runPublicPluginGapTurn({
      temporaryRootPrefix: 'dsh-evolve-generation-only-evidence-',
      sessionId: 'generation-only-evidence',
      requestedSkill: 'generation-only-release-audit',
      pluginConfig: {
        interactionEvidencePolicies: [{
          workspaceId: WORKSPACE_ID,
          retention: { generationMaxRecords: 1 },
        }],
      },
    })

    const evidenceCtx = await bootStorage(configPath)
    const generationEvidence = await openInteractionGenerationEvidenceVault(
      evidenceCtx.storageDomain,
      {
        authority: compileInteractionGenerationEvidencePolicies([{
          workspaceId: WORKSPACE_ID,
          retention: { generationMaxRecords: 1 },
        }]),
      },
    )
    const routingEvidence = await openInteractionRoutingEvidenceVault(
      evidenceCtx.storageDomain,
      {
        authority: compileInteractionRoutingEvidencePolicies([{
          workspaceId: WORKSPACE_ID,
          retention: { routingMaxRecords: 1 },
        }]),
      },
    )
    try {
      await expect(generationEvidence.resolveGenerationEvidence(subject, {
        triggerRequestControl: requestControl,
      })).resolves.toMatchObject({ status: 'matched' })
      await expect(routingEvidence.resolveRoutingEvidence(subject, {
        triggerRequestControl: requestControl,
      })).resolves.toEqual({
        status: 'abstained',
        reason: 'evidence-unavailable',
      })
    } finally {
      await Promise.all([generationEvidence.close(), routingEvidence.close()])
      await evidenceCtx.fiber.dispose()
    }
  })

  it('keeps Generation evidence unavailable after a Routing-only real Agent Loop gap turn', async () => {
    const { configPath, subject, requestControl } = await runPublicPluginGapTurn({
      temporaryRootPrefix: 'dsh-evolve-routing-only-evidence-',
      sessionId: 'routing-only-evidence',
      requestedSkill: 'routing-only-release-audit',
      pluginConfig: {
        interactionRoutingEvidencePolicies: [{
          workspaceId: WORKSPACE_ID,
          retention: { routingMaxRecords: 1 },
        }],
      },
    })

    const evidenceCtx = await bootStorage(configPath)
    const generationEvidence = await openInteractionGenerationEvidenceVault(
      evidenceCtx.storageDomain,
      {
        authority: compileInteractionGenerationEvidencePolicies([{
          workspaceId: WORKSPACE_ID,
          retention: { generationMaxRecords: 1 },
        }]),
      },
    )
    const routingEvidence = await openInteractionRoutingEvidenceVault(
      evidenceCtx.storageDomain,
      {
        authority: compileInteractionRoutingEvidencePolicies([{
          workspaceId: WORKSPACE_ID,
          retention: { routingMaxRecords: 1 },
        }]),
      },
    )
    try {
      await expect(routingEvidence.resolveRoutingEvidence(subject, {
        triggerRequestControl: requestControl,
      })).resolves.toMatchObject({ status: 'matched' })
      await expect(generationEvidence.resolveGenerationEvidence(subject, {
        triggerRequestControl: requestControl,
      })).resolves.toEqual({
        status: 'abstained',
        reason: 'evidence-unavailable',
      })
    } finally {
      await Promise.all([generationEvidence.close(), routingEvidence.close()])
      await evidenceCtx.fiber.dispose()
    }
  })

  it('retains a mounted evolved Generation receipt across immediate real Agent Loop shutdown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-evolved-generation-evidence-'))
    temporaryRoots.push(root)
    const cacheRoot = join(root, 'cache')
    const configPath = await writeStorageConfig(root)
    const ctx = await bootStorage(configPath)
    const adapter = await installAgentRuntime(ctx, undefined, {
      firstCapabilityGap: 'publish-evolved-dsh-plugin',
    })
    await ctx.plugin(EvolvePlugin, {
      cacheRoot,
      interactionEvidencePolicies: [{
        workspaceId: WORKSPACE_ID,
        retention: { generationMaxRecords: 1 },
      }],
    })
    const store = ctx.get('evoforge.evolution') as EvolutionStore | undefined
    if (store === undefined) throw new Error('evolution store did not load')

    const bundle = await assembleSkillBundleArchive([{
      path: 'SKILL.md',
      content: [
        '---',
        'name: evolved-generation-proof',
        'description: Prove the evolved Generation mount in one real Agent turn.',
        '---',
        '',
        '# Evolved Generation Proof',
        '',
        'This content must come from the pinned content-addressed Generation.',
        'Verify it with the [mount proof](references/proof.md).',
        '',
      ].join('\n'),
    }, {
      path: 'references/proof.md',
      content: '# Proof\n\nRequire the exact mounted Generation id.\n',
    }])
    const generation = (await store.publishGeneration({
      workspaceId: WORKSPACE_ID,
      createdAt: 1_823_456_789_000,
      artifacts: [{
        kind: 'skill-bundle',
        name: 'evolved-generation-proof',
        artifactDigest: bundle.artifactDigest,
        treeHash: bundle.treeHash,
        contentBase64: bundle.content.toString('base64'),
        lineage: {
          kind: 'internal-skill-candidate-lineage-v3',
          candidateId: '1'.repeat(64),
          workspaceId: WORKSPACE_ID,
          skillName: 'evolved-generation-proof',
          opportunityId: '2'.repeat(64),
          evaluationEvidenceId: '3'.repeat(64),
          policyId: 'evolved-generation-proof-author',
          versionKind: 'experience-authored-bundle-v1',
          contentHash: bundle.artifactDigest,
          candidateTreeHash: bundle.treeHash,
          admissionId: '4'.repeat(64),
          evaluationEnvelopeId: '5'.repeat(64),
          releaseAuthority: 'none',
        },
      }],
      evaluatorVersion: 'generation-binding-proof-v1',
      policyVersion: 'human-review-v1',
      compositionFingerprint: '6'.repeat(64),
    })).generation
    await store.promoteGeneration(WORKSPACE_ID, generation.id)

    const packages = (path: string) => pathToFileURL(
      join(dshSourceDir, 'packages', path, 'lib', 'index.js'),
    ).href
    const [llm, session] = await Promise.all([
      import(packages('llm/llm')),
      import(packages('core/session')),
    ])
    const handle = await ctx.agents.create({
      sessionId: session.SessionId('evolved-generation-evidence'),
      agentOptions: { provider: 'fixed', model: 'fixed' },
      meta: { cwd: root },
    })
    const goals = ctx.get('goals') as {
      create(agent: object, request: { objective: string }): { objective: string }
    } | undefined
    const skills = ctx.get('skills') as {
      get(name: string, options: { cwd?: string; scope?: object }): Promise<{
        provider: string
        content: string
      } | undefined>
    } | undefined
    if (goals === undefined || skills === undefined) {
      throw new Error('Goal or Skill service did not load')
    }
    const objective = 'Publish the evolved plugin through the exact Generation pinned to this Session.'
    goals.create(handle.agent, { objective })
    handle.agent.followup(llm.createUserMessage({
      content: [{ type: 'text', text: objective }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    expect(store.getSessionGeneration(identityOf(handle.agent))?.id).toBe(generation.id)
    await expect(skills.get('evolved-generation-proof', {
      cwd: root,
      scope: handle.agent,
    })).resolves.toMatchObject({
      provider: 'evoforge-generation',
      content: expect.stringContaining('content-addressed Generation'),
    })
    const { subject, requestControl } = generationEvidenceQuery(
      handle.agent.session,
      'model-declared-capability-gap',
    )

    // Do not explicitly drain the evidence sink: root teardown must preserve
    // every receipt that the synchronous turn/end observer already accepted.
    await ctx.fiber.dispose()

    const evidenceCtx = await bootStorage(configPath)
    const evidence = await openInteractionGenerationEvidenceVault(evidenceCtx.storageDomain, {
      authority: compileInteractionGenerationEvidencePolicies([{
        workspaceId: WORKSPACE_ID,
        retention: { generationMaxRecords: 1 },
      }]),
    })
    try {
      await expect(evidence.resolveGenerationEvidence(subject, {
        triggerRequestControl: requestControl,
      })).resolves.toMatchObject({
        status: 'matched',
        fact: {
          workspaceId: WORKSPACE_ID,
          generation: {
            kind: 'evolved',
            pin: 'settled',
            generationId: generation.id,
            effectiveMount: {
              kind: 'evolved',
              generationId: generation.id,
            },
          },
        },
      })
    } finally {
      await evidence.close()
      await evidenceCtx.fiber.dispose()
    }
  })

  it('pins an internally authored content-addressed Skill only into future Sessions and rolls back exactly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-bundle-generation-binder-'))
    temporaryRoots.push(root)
    const cacheRoot = join(root, 'cache')
    const sessionsRoot = join(root, 'sessions')
    const configPath = await writeStorageConfig(root)
    const bundle = await assembleSkillBundleArchive([{
      path: 'SKILL.md',
      content: [
        '---',
        'name: internal-release-proof',
        'description: Require durable DSH release proof.',
        '---',
        '',
        '# Internal Release Proof',
        '',
        'Use the [verification contract](references/verification.md).',
        '',
      ].join('\n'),
    }, {
      path: 'references/verification.md',
      content: '# Verification\n\nRequire a clean-profile real DSH execution.\n',
    }])
    const ctx = await bootStorage(configPath)
    await installAgentRuntime(ctx, sessionsRoot)
    await ctx.plugin(EvolvePlugin, { cacheRoot })
    const store = ctx.get('evoforge.evolution') as EvolutionStore | undefined
    const skills = ctx.get('skills') as {
      get(name: string, options: { cwd?: string; scope?: object }): Promise<{
        content: string
        resourceBase?: { kind: string; path?: string }
      } | undefined>
    } | undefined
    if (store === undefined || skills === undefined) throw new Error('required service did not load')

    const nativeAgent = await createAndRunAgent(ctx, 'before-bundle-promotion', root)
    const generation = (await store.publishGeneration({
      workspaceId: WORKSPACE_ID,
      createdAt: 1_723_456_789_000,
      artifacts: [{
        kind: 'skill-bundle',
        name: 'internal-release-proof',
        artifactDigest: bundle.artifactDigest,
        treeHash: bundle.treeHash,
        contentBase64: bundle.content.toString('base64'),
        lineage: {
          kind: 'internal-skill-candidate-lineage-v3',
          candidateId: '1'.repeat(64),
          workspaceId: WORKSPACE_ID,
          skillName: 'internal-release-proof',
          opportunityId: '2'.repeat(64),
          evaluationEvidenceId: '6'.repeat(64),
          policyId: 'release-proof-author',
          versionKind: 'experience-authored-bundle-v1',
          contentHash: bundle.artifactDigest,
          candidateTreeHash: bundle.treeHash,
          admissionId: '3'.repeat(64),
          evaluationEnvelopeId: '4'.repeat(64),
          releaseAuthority: 'none',
        },
      }],
      evaluatorVersion: 'capability-absent-v1',
      policyVersion: 'human-review-v1',
      compositionFingerprint: '5'.repeat(64),
    })).generation
    await store.promoteGeneration(WORKSPACE_ID, generation.id)
    const evolvedAgent = await createAndRunAgent(ctx, 'after-bundle-promotion', root)
    await runAgentTurn(nativeAgent, 'continue after promotion')
    const nativeSkill = await skills.get('internal-release-proof', { cwd: root, scope: nativeAgent })
    const evolvedSkill = await skills.get('internal-release-proof', { cwd: root, scope: evolvedAgent })

    await store.rollbackGeneration(WORKSPACE_ID, generation.id)
    const rollbackAgent = await createAndRunAgent(ctx, 'after-bundle-rollback', root)
    const rollbackSkill = await skills.get('internal-release-proof', { cwd: root, scope: rollbackAgent })
    const pinnedAfterRollback = await skills.get(
      'internal-release-proof',
      { cwd: root, scope: evolvedAgent },
    )

    expect(store.getSessionGeneration(identityOf(nativeAgent))).toBeUndefined()
    expect(store.getSessionGeneration(identityOf(evolvedAgent))?.id).toBe(generation.id)
    expect(store.getSessionGeneration(identityOf(rollbackAgent))).toBeUndefined()
    expect(nativeSkill).toBeUndefined()
    expect(evolvedSkill?.content).toContain('verification contract')
    expect(rollbackSkill).toBeUndefined()
    expect(pinnedAfterRollback?.content).toBe(evolvedSkill?.content)
    expect(await readFile(
      join(evolvedSkill?.resourceBase?.path ?? '', 'references', 'verification.md'),
      'utf8',
    )).toContain('clean-profile real DSH execution')

    await ctx.sessions.flush(evolvedAgent.session)
    await ctx.fiber.dispose()

    const resumedCtx = await bootStorage(configPath)
    await installAgentRuntime(resumedCtx, sessionsRoot)
    await resumedCtx.plugin(EvolvePlugin, { cacheRoot })
    const resumedAgent = await resumeAndRunAgent(resumedCtx, 'after-bundle-promotion')
    const resumedStore = resumedCtx.get('evoforge.evolution') as EvolutionStore | undefined
    const resumedSkills = resumedCtx.get('skills') as typeof skills
    expect(resumedStore?.getSessionGeneration(identityOf(resumedAgent))?.id).toBe(generation.id)
    expect((await resumedSkills?.get(
      'internal-release-proof',
      { cwd: root, scope: resumedAgent },
    ))?.content).toBe(evolvedSkill?.content)
    await resumedCtx.fiber.dispose()
  })

  it('replaces an installed same-name Skill only for future Sessions and restores native selection exactly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-existing-generation-binder-'))
    temporaryRoots.push(root)
    const ctx = await bootStorage(await writeStorageConfig(root))
    await installAgentRuntime(ctx)
    const nativeSkills = ctx.get('skills') as {
      register(skill: {
        name: string
        description: string
        source: string
        content: string
      }): () => void
      get(name: string, options: { cwd?: string; scope?: object }): Promise<{
        content: string
        provider: string
        resourceBase?: { kind: string; path?: string }
      } | undefined>
    } | undefined
    if (nativeSkills === undefined) throw new Error('DSH Skill Registry did not load')
    nativeSkills.register({
      name: 'shared-release-proof',
      description: 'Native installed release behavior.',
      source: 'fixture-native',
      content: 'NATIVE INSTALLED BEHAVIOR',
    })
    await ctx.plugin(EvolvePlugin, { cacheRoot: join(root, 'cache') })
    const store = ctx.get('evoforge.evolution') as EvolutionStore | undefined
    if (store === undefined) throw new Error('evolution store did not load')
    const before = await createAndRunAgent(ctx, 'existing-before-promotion', root)
    const beforeDefinition = await nativeSkills.get(
      'shared-release-proof',
      { cwd: root, scope: before },
    )
    const bundle = await assembleSealedSkillBundleArchive([{
      path: 'SKILL.md',
      mode: '100644',
      content: Buffer.from([
        '---',
        'name: shared-release-proof',
        'description: Corrected installed release behavior.',
        '---',
        '',
        '# Shared Release Proof',
        '',
        'CANDIDATE CORRECTED BEHAVIOR',
        '',
      ].join('\n')),
    }, {
      path: 'assets/preserved.bin',
      mode: '100644',
      content: Buffer.from([0, 1, 2, 255]),
    }])
    const generation = (await store.publishGeneration({
      workspaceId: WORKSPACE_ID,
      createdAt: 1_777_000_000_000,
      artifacts: [{
        kind: 'skill-bundle',
        name: 'shared-release-proof',
        artifactDigest: bundle.artifactDigest,
        treeHash: bundle.treeHash,
        contentBase64: bundle.content.toString('base64'),
        lineage: {
          kind: 'existing-skill-candidate-lineage-v1',
          candidateId: '1'.repeat(64),
          workspaceId: WORKSPACE_ID,
          skillName: 'shared-release-proof',
          opportunityId: '2'.repeat(64),
          qualificationId: '3'.repeat(64),
          baselineId: '4'.repeat(64),
          baselineArtifactDigest: '5'.repeat(64),
          baselineTreeHash: '6'.repeat(64),
          evaluationEvidenceId: '7'.repeat(64),
          policyId: 'existing-release-proof',
          versionKind: 'existing-skill-improvement-bundle-v1',
          contentHash: bundle.artifactDigest,
          candidateTreeHash: bundle.treeHash,
          admissionId: '8'.repeat(64),
          evaluationEnvelopeId: '9'.repeat(64),
          holdoutEvaluationId: 'a'.repeat(64),
          holdoutCasePackHash: 'b'.repeat(64),
          retentionEvaluationId: 'c'.repeat(64),
          retentionCasePackHash: 'd'.repeat(64),
          releaseAuthority: 'none',
        },
      }],
      evaluatorVersion: 'existing-skill-paired-v1',
      policyVersion: 'human-review-existing-skill-v1',
      compositionFingerprint: 'e'.repeat(64),
    })).generation

    await store.promoteGeneration(WORKSPACE_ID, generation.id)
    const evolved = await createAndRunAgent(ctx, 'existing-after-promotion', root)
    await runAgentTurn(before, 'continue with the pinned native Skill')
    const beforeAfterPromotion = await nativeSkills.get(
      'shared-release-proof',
      { cwd: root, scope: before },
    )
    const evolvedDefinition = await nativeSkills.get(
      'shared-release-proof',
      { cwd: root, scope: evolved },
    )

    await store.rollbackGeneration(WORKSPACE_ID, generation.id)
    const afterRollback = await createAndRunAgent(ctx, 'existing-after-rollback', root)
    const rollbackDefinition = await nativeSkills.get(
      'shared-release-proof',
      { cwd: root, scope: afterRollback },
    )
    const evolvedAfterRollback = await nativeSkills.get(
      'shared-release-proof',
      { cwd: root, scope: evolved },
    )

    expect(beforeDefinition?.content).toBe('NATIVE INSTALLED BEHAVIOR')
    expect(beforeAfterPromotion?.content).toBe('NATIVE INSTALLED BEHAVIOR')
    expect(evolvedDefinition?.provider).toBe('evoforge-generation')
    expect(evolvedDefinition?.content).toContain('CANDIDATE CORRECTED BEHAVIOR')
    expect(await readFile(
      join(evolvedDefinition?.resourceBase?.path ?? '', 'assets', 'preserved.bin'),
    )).toEqual(Buffer.from([0, 1, 2, 255]))
    expect(rollbackDefinition?.content).toBe('NATIVE INSTALLED BEHAVIOR')
    expect(evolvedAfterRollback?.content).toBe(evolvedDefinition?.content)
    expect(store.getSessionGeneration(identityOf(before))).toBeUndefined()
    expect(store.getSessionGeneration(identityOf(evolved))?.id).toBe(generation.id)
    expect(store.getSessionGeneration(identityOf(afterRollback))).toBeUndefined()

    await ctx.fiber.dispose()
  })
})

async function runPublicPluginGapTurn(input: {
  readonly temporaryRootPrefix: string
  readonly sessionId: string
  readonly requestedSkill: string
  readonly pluginConfig: Pick<
    EvolvePlugin.Config,
    'interactionEvidencePolicies' | 'interactionRoutingEvidencePolicies'
  >
}): Promise<{
  readonly configPath: string
  readonly subject: InteractionGenerationEvidenceSubjectV1
  readonly requestControl: InteractionEpisodeTriggerRequestControlFactV1
}> {
  const root = await mkdtemp(join(tmpdir(), input.temporaryRootPrefix))
  temporaryRoots.push(root)
  const configPath = await writeStorageConfig(root)
  const ctx = await bootStorage(configPath)
  try {
    const adapter = await installAgentRuntime(ctx, undefined, {
      firstCapabilityGap: input.requestedSkill,
    })
    await ctx.plugin(EvolvePlugin, {
      cacheRoot: join(root, 'cache'),
      ...input.pluginConfig,
    })
    const session = await import(
      pathToFileURL(join(dshSourceDir, 'packages', 'core', 'session', 'lib', 'index.js')).href
    )
    const handle = await ctx.agents.create({
      sessionId: session.SessionId(input.sessionId),
      agentOptions: { provider: 'fixed', model: 'fixed' },
      meta: { cwd: root },
    })
    const goals = ctx.get('goals') as {
      create(agent: object, request: { objective: string }): { objective: string }
    } | undefined
    if (goals === undefined) throw new Error('Goal service did not load')
    const objective = `Exercise ${input.requestedSkill} through one real Agent Loop turn.`
    goals.create(handle.agent, { objective })
    await runAgentTurn(handle.agent, objective)
    expect(adapter.requests).toHaveLength(2)
    const query = generationEvidenceQuery(
      handle.agent.session,
      'model-declared-capability-gap',
    )
    return { configPath, ...query }
  } finally {
    await ctx.fiber.dispose()
  }
}

async function installAgentRuntime(
  ctx: Awaited<ReturnType<typeof bootStorage>>,
  persistenceRoot?: string,
  options: { readonly firstCapabilityGap?: string } = {},
) {
  const packages = (path: string) => pathToFileURL(
    join(dshSourceDir, 'packages', path, 'lib', 'index.js'),
  ).href
  const [llm, session, systemPrompt, tools, skill, toolSkill, agent, projection, goal, agentLoop, persistence] =
    await Promise.all([
      import(packages('llm/llm')),
      import(packages('core/session')),
      import(packages('core/system-prompt')),
      import(packages('core/tools')),
      import(packages('skill/skill')),
      import(packages('skill/tool-skill')),
      import(packages('core/agent')),
      import(packages('session/session-projection')),
      import(packages('goal/goal')),
      import(packages('core/agent-loop')),
      import(packages('session/session-persistence-jsonl')),
    ])
  await ctx.plugin(llm.default)
  await ctx.plugin(session.default)
  await ctx.plugin(systemPrompt.default, { persona: 'Stable binder fixture.' })
  await ctx.plugin(tools.default)
  await ctx.plugin(skill.default)
  await ctx.plugin(toolSkill)
  await ctx.plugin(agent.default)
  await ctx.plugin(projection.default)
  await ctx.plugin(goal.default)
  await ctx.plugin(agentLoop.default, { agents: [] })
  if (persistenceRoot !== undefined) {
    await ctx.plugin(persistence.default, { root: persistenceRoot, compression: 'none' })
  }
  ctx.provide('workspaceRegistry', {
    resolveByPath: async () => ({ id: WORKSPACE_ID }),
  } as never)
  const scriptedCapabilityGap = options.firstCapabilityGap

  class FixedAdapter extends llm.LlmAdapter {
    requests: unknown[] = []

    resolveModel(provider: string, model: string) {
      return Promise.resolve({ provider, id: model, name: model })
    }

    async * stream(request: unknown) {
      this.requests.push(structuredClone(request))
      if (this.requests.length === 1 && scriptedCapabilityGap !== undefined) {
        const callId = llm.ToolCallId('model-declared-capability-gap')
        const argumentsJson = JSON.stringify({ name: scriptedCapabilityGap })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield {
          type: 'tool-call-delta',
          index: 0,
          id: callId,
          name: 'report_capability_gap',
          argumentsDelta: argumentsJson,
        }
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: callId,
            name: 'report_capability_gap',
            arguments: argumentsJson,
          },
        }
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'ok' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new FixedAdapter()
  ctx.llm.registerAdapter(['fixed'], adapter)
  return adapter
}

async function createAndRunAgent(
  ctx: Awaited<ReturnType<typeof bootStorage>>,
  sessionId: string,
  cwd: string,
) {
  const llm = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'llm', 'llm', 'lib', 'index.js')).href
  )
  const session = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'core', 'session', 'lib', 'index.js')).href
  )
  const handle = await ctx.agents.create({
    sessionId: session.SessionId(sessionId),
    agentOptions: { provider: 'fixed', model: 'fixed' },
    meta: { cwd },
  })
  handle.agent.followup(llm.createUserMessage({
    content: [{ type: 'text', text: 'run one real step' }],
    source: { kind: 'user' },
  }))
  await handle.agent.whenIdle()
  return handle.agent
}

async function resumeAndRunAgent(
  ctx: Awaited<ReturnType<typeof bootStorage>>,
  sessionId: string,
) {
  const llm = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'llm', 'llm', 'lib', 'index.js')).href
  )
  const session = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'core', 'session', 'lib', 'index.js')).href
  )
  const handle = await ctx.agents.resume({
    resumeSessionId: session.SessionId(sessionId),
    agentOptions: { provider: 'fixed', model: 'fixed' },
  })
  handle.agent.followup(llm.createUserMessage({
    content: [{ type: 'text', text: 'run one resumed step' }],
    source: { kind: 'user' },
  }))
  await handle.agent.whenIdle()
  return handle.agent
}

async function runAgentTurn(
  agent: { followup(message: unknown): void; whenIdle(): Promise<void> },
  text: string,
): Promise<void> {
  const llm = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'llm', 'llm', 'lib', 'index.js')).href
  )
  agent.followup(llm.createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
}

function identityOf(agent: {
  session: { header: { id: string; createdAt: number; cwd?: string } }
}) {
  const { id, createdAt, cwd } = agent.session.header
  return {
    workspaceId: WORKSPACE_ID,
    sessionId: String(id),
    createdAt,
    ...cwd === undefined ? {} : { cwd },
  }
}

function generationEvidenceQuery(session: Session, callId: string): {
  readonly subject: InteractionGenerationEvidenceSubjectV1
  readonly requestControl: InteractionEpisodeTriggerRequestControlFactV1
} {
  const events = session.snapshotEvents() as readonly SessionEvent[]
  const turnEnd = [...events].reverse().find(event => event.type === 'turn/end')
  if (turnEnd?.type !== 'turn/end') throw new Error('completed turn is missing')
  const transcript = proveInteractionEpisodeTranscript(
    session,
    Number(turnEnd.seq),
    { callId },
  )
  if (transcript.status !== 'proven') {
    throw new Error(`real Agent Loop trigger was not proven: ${transcript.reason}`)
  }
  const subject = structuredClone({
    schemaVersion: 1,
    kind: 'durable-interaction-episode-subject-v1',
    session: {
      header: session.header,
      inheritedEventCount: Number(session.inheritedEventCount),
      throughSeq: Number(turnEnd.seq),
      events,
    },
    transcript: transcript.proof,
  } as const satisfies InteractionGenerationEvidenceSubjectV1)
  const requestControl = projectInteractionEpisodeTriggerRequestControlV1(subject)
  if (requestControl.status !== 'projected') {
    throw new Error('real trigger request control was not projected')
  }
  return { subject, requestControl: requestControl.fact }
}

async function writeStorageConfig(root: string): Promise<string> {
  const packageScope = join(root, 'node_modules', '@deepseek-ai')
  await mkdir(packageScope, { recursive: true })
  for (const [name, source] of [
    ['dsh-storage', join(dshSourceDir, 'packages', 'storage', 'storage')],
    ['dsh-storage-json', join(dshSourceDir, 'packages', 'storage', 'storage-json')],
    ['dsh-storage-domain', join(dshSourceDir, 'packages', 'storage', 'storage-domain')],
  ] as const) {
    await import('node:fs/promises').then(({ symlink }) => symlink(source, join(packageScope, name), 'dir'))
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
  return boot('dsh-evolve-generation-binder-test', configPath)
}

async function makeWritable(path: string): Promise<void> {
  await chmod(path, 0o755).catch(() => undefined)
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isDirectory()) await makeWritable(join(path, entry.name))
  }
}
