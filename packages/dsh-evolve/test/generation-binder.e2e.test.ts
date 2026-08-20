import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import * as EvolvePlugin from '../src/index.js'
import type { EvolutionStore } from '../src/generation-store.js'
import {
  assembleSealedSkillBundleArchive,
  assembleSkillBundleArchive,
} from '../src/skill-bundle-archive.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
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
    const ctx = await bootStorage(await writeStorageConfig(root))
    const adapter = await installAgentRuntime(ctx, undefined, {
      firstCapabilityGap: 'publish-dsh-plugin',
    })
    await ctx.plugin(EvolvePlugin, { cacheRoot: join(root, 'cache') })
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

    expect(adapter.requests).toHaveLength(2)
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
    expect(JSON.stringify(adapter.requests[1]))
      .toContain('internal Skill opportunity discovery continues asynchronously')

    await ctx.fiber.dispose()
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

async function installAgentRuntime(
  ctx: Awaited<ReturnType<typeof bootStorage>>,
  persistenceRoot?: string,
  options: { readonly firstCapabilityGap?: string } = {},
) {
  const packages = (path: string) => pathToFileURL(
    join(dshSourceDir, 'packages', path, 'lib', 'index.js'),
  ).href
  const [llm, session, systemPrompt, tools, skill, toolSkill, agent, goal, agentLoop, persistence] =
    await Promise.all([
      import(packages('llm/llm')),
      import(packages('core/session')),
      import(packages('core/system-prompt')),
      import(packages('core/tools')),
      import(packages('skill/skill')),
      import(packages('skill/tool-skill')),
      import(packages('core/agent')),
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
        const callId = llm.CallId('model-declared-capability-gap')
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
