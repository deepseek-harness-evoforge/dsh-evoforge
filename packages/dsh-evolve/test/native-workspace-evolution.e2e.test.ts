import { chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EvolutionStore } from '../src/generation-store.ts'
import { assembleSkillBundleArchive } from '../src/skill-bundle-archive.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(async (path) => {
    await makeWritable(path)
    await rm(path, { recursive: true, force: true })
  }))
})

describe.skipIf(process.platform !== 'darwin')('native DSH Workspace-owned evolution', () => {
  it('resolves two real Workspace ids and keeps activation and Session pins isolated across restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-native-workspace-evolution-'))
    temporaryRoots.push(root)
    const workspaceAPath = join(root, 'workspace-a')
    const workspaceBPath = join(root, 'workspace-b')
    await Promise.all([
      mkdir(workspaceAPath),
      mkdir(workspaceBPath),
    ])
    const canonicalA = await realpath(workspaceAPath)
    const canonicalB = await realpath(workspaceBPath)
    const baseline = skillSource('Baseline native Workspace instructions.')
    const configPath = join(root, 'native-workspace.patch.yml')
    await writeFile(configPath, JSON.stringify(hostConfig({
      root,
      workspacePaths: [workspaceAPath, workspaceBPath],
    }), null, 2))
    vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents-home'))
    vi.stubEnv('DSH_HOME', join(root, '.dsh-home'))
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')
    const previousCwd = process.cwd()
    process.chdir(root)
    try {
      const first = await bootLatestHeadlessProfile('dsh-native-workspace-evolution-test-1', root, configPath)
      let workspaceAId: string
      let workspaceBId: string
      try {
        const fixture = first.get('evoforge.nativeWorkspaceEvolutionFixture') as {
          workspaceIds: readonly [string, string]
        } | undefined
        if (fixture === undefined) throw new Error('native Workspace evolution fixture did not load')
        ;[workspaceAId, workspaceBId] = fixture.workspaceIds
        expect(workspaceAId).not.toBe(workspaceBId)
        expect(await first.workspaceRegistry.resolveByPath(canonicalA)).toMatchObject({ id: workspaceAId })
        expect(await first.workspaceRegistry.resolveByPath(canonicalB)).toMatchObject({ id: workspaceBId })

        const store = first.get('evoforge.evolution') as EvolutionStore | undefined
        if (store === undefined) throw new Error('evolution store did not load')
        const liveA = await createAgent(first, 'workspace-a-live', canonicalA)
        const liveB = await createAgent(first, 'workspace-b-live', canonicalB)
        await first.workspaceRegistry.get(workspaceAId)?.attachSession(liveA.agent.session.header.id)
        await first.workspaceRegistry.get(workspaceBId)?.attachSession(liveB.agent.session.header.id)
        await Promise.all([runAgent(liveA.agent, 'live-a'), runAgent(liveB.agent, 'live-b')])

        const generationA = (await store.publishGeneration(
          await generationInput(workspaceAId, baseline),
        )).generation
        await store.promoteGeneration(workspaceAId, generationA.id)
        await expect(store.promoteGeneration(workspaceBId, generationA.id))
          .rejects.toThrow('belongs to Workspace')
        expect(store.getActiveGeneration(workspaceAId)?.id).toBe(generationA.id)
        expect(store.getActiveGeneration(workspaceBId)).toBeUndefined()
        expect(store.getSessionGeneration(sessionIdentity(liveA.agent, workspaceAId))).toBeUndefined()
        expect(store.getSessionGeneration(sessionIdentity(liveB.agent, workspaceBId))).toBeUndefined()

        const futureA = await createAgent(first, 'workspace-a-future', canonicalA)
        const futureB = await createAgent(first, 'workspace-b-future', canonicalB)
        await first.workspaceRegistry.get(workspaceAId)?.attachSession(futureA.agent.session.header.id)
        await first.workspaceRegistry.get(workspaceBId)?.attachSession(futureB.agent.session.header.id)
        await Promise.all([runAgent(futureA.agent, 'future-a'), runAgent(futureB.agent, 'future-b')])
        expect(store.getSessionGeneration(sessionIdentity(futureA.agent, workspaceAId))?.id).toBe(generationA.id)
        expect(store.getSessionGeneration(sessionIdentity(futureB.agent, workspaceBId))).toBeUndefined()
        await expect(first.skills.get('native-evolution', { cwd: canonicalA, scope: futureA.agent }))
          .resolves.toMatchObject({ content: expect.stringContaining('Baseline native Workspace instructions.') })

        const statusA = await first.commands.execute(
          futureA.agent,
          '/evolve status',
          [],
          new AbortController().signal,
        )
        const statusB = await first.commands.execute(
          futureB.agent,
          '/evolve status',
          [],
          new AbortController().signal,
        )
        expect(statusA?.result).toMatchObject({ kind: 'success', text: expect.stringContaining(generationA.id) })
        expect(statusB?.result).toMatchObject({ kind: 'success', text: expect.stringContaining('Active: native DSH') })
        await Promise.all([liveA.dispose(), liveB.dispose(), futureA.dispose(), futureB.dispose()])
      } finally {
        await first.fiber.dispose()
      }

      const second = await bootLatestHeadlessProfile('dsh-native-workspace-evolution-test-2', root, configPath)
      try {
        const fixture = second.get('evoforge.nativeWorkspaceEvolutionFixture') as {
          workspaceIds: readonly [string, string]
        } | undefined
        if (fixture === undefined) throw new Error('restarted native Workspace fixture did not load')
        expect(fixture.workspaceIds).toEqual([workspaceAId!, workspaceBId!])
        const store = second.get('evoforge.evolution') as EvolutionStore | undefined
        if (store === undefined) throw new Error('restarted evolution store did not load')
        expect(store.getActiveGeneration(workspaceAId!)?.workspaceId).toBe(workspaceAId!)
        expect(store.getActiveGeneration(workspaceBId!)).toBeUndefined()
      } finally {
        await second.fiber.dispose()
      }
    } finally {
      process.chdir(previousCwd)
    }
  }, 60_000)
})

function hostConfig(input: {
  root: string
  workspacePaths: readonly [string, string]
}): unknown[] {
  return [
    { id: 'llm-deepseek', disabled: true },
    { id: 'headless-startup', disabled: true },
    { id: 'headless-runner', disabled: true },
    {
      id: 'agent-loop',
      config: {
        agents: [],
        workspaceContext: false,
        dshHome: join(input.root, '.dsh-home'),
        skills: { filesystem: { agentsHome: join(input.root, '.agents-home') } },
        invariants: { package_blocklist: ['^@deepseek-ai/dsh-scope$'] },
        persona: 'Keyless native Workspace evolution isolation smoke.',
      },
    },
    {
      id: 'session-persistence-jsonl',
      config: { root: join(input.root, 'sessions'), compression: 'none' },
    },
    { id: 'session-checkpoint-policy', disabled: true },
    {
      insert: [
        {
          id: 'workspace',
          name: '@deepseek-ai/dsh-workspace',
        },
        {
          id: 'cli-mock-llm',
          name: join(dshSourceDir, 'packages', 'test-support', 'loader-smoke', 'tests', 'fixtures', 'cli-mock-llm.ts'),
        },
        {
          id: 'native-workspace-evolution-bootstrap',
          name: join(packageRoot, 'test', 'fixtures', 'native-workspace-evolution-bootstrap.ts'),
          config: {
            cacheRoot: join(input.root, 'cache'),
            workspacePaths: input.workspacePaths,
          },
        },
      ],
    },
  ]
}

/**
 * Compose and boot the latest DSH shipped profile rather than embedding a
 * stale base bundle path in this fixture. The source checkout is pinned by
 * the test runner before Vitest starts; this helper keeps profile composition
 * aligned with that exact revision and makes alpha upgrades fail loudly.
 */
async function bootLatestHeadlessProfile(
  binName: string,
  root: string,
  overlayPath: string,
): Promise<any> {
  const appBoot = await import(pathToFileURL(
    join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
  ).href)
  const installAnchor = join(dshSourceDir, 'apps', 'cli', 'package.json')
  const home = join(root, '.dsh-home')
  const profile = appBoot.loadProfile(binName, 'headless', installAnchor, home, { userLayer: false })
  await appBoot.healProfilesModuleFallback({ installAnchor, profile })
  // Keep the composed root beside the profile-owned module fallback. DSH's
  // bare-module resolver intentionally resolves from this profile directory;
  // placing the generated document in the temporary test root bypasses that
  // resolver and makes every base bundle appear missing.
  const basePath = join(profile.dir, 'cordis.yml')
  await writeFile(basePath, '[]\n')
  const overlayPatches = appBoot.loadOverlayPatches(binName, overlayPath)
  const config = appBoot.renderConfigDump(
    binName,
    basePath,
    [
      ...profile.layers.map((layer: { packageName: string; patches: unknown[] }) => ({
        label: layer.packageName,
        patches: layer.patches,
      })),
      { label: overlayPath, patches: overlayPatches },
    ],
  )
  await writeFile(basePath, config)
  return await appBoot.boot(binName, basePath)
}

async function createAgent(ctx: any, sessionId: string, cwd: string) {
  return await ctx.agents.create({
    sessionId: SessionId(sessionId),
    meta: { cwd },
    agentOptions: { provider: 'cli-mock', model: 'cli-mock' },
  })
}

async function runAgent(agent: any, suffix: string): Promise<void> {
  const { freezeMessage, MessageId } = await import(pathToFileURL(
    join(dshSourceDir, 'packages', 'llm', 'llm', 'lib', 'index.js'),
  ).href)
  const priorTurns = agent.session.snapshotEvents().filter((event: { type: string }) => event.type === 'turn/end').length
  agent.followup(freezeMessage({
    id: MessageId(`native:workspace-evolution:${suffix}`),
    role: 'user',
    content: [{ type: 'text', text: `bind ${suffix}` }],
    source: { kind: 'user' },
  }))
  await vi.waitFor(() => {
    expect(agent.session.snapshotEvents().filter((event: { type: string }) => event.type === 'turn/end').length)
      .toBe(priorTurns + 1)
  }, { timeout: 15_000, interval: 25 })
}

async function generationInput(workspaceId: string, content: string) {
  const bundle = await assembleSkillBundleArchive([
    { path: 'SKILL.md', content },
    { path: 'references/internal-evidence.md', content: 'Authored from sealed internal DSH evidence.\n' },
  ])
  return {
    workspaceId,
    createdAt: 1_786_896_000_000,
    artifacts: [{
      kind: 'skill-bundle' as const,
      name: 'native-evolution',
      artifactDigest: bundle.artifactDigest,
      treeHash: bundle.treeHash,
      contentBase64: bundle.content.toString('base64'),
      lineage: {
        kind: 'internal-skill-candidate-lineage-v3' as const,
        candidateId: '1'.repeat(64),
        workspaceId,
        skillName: 'native-evolution',
        opportunityId: '2'.repeat(64),
        evaluationEvidenceId: '3'.repeat(64),
        policyId: 'native-workspace-e2e',
        versionKind: 'experience-authored-bundle-v1' as const,
        contentHash: bundle.artifactDigest,
        candidateTreeHash: bundle.treeHash,
        admissionId: '4'.repeat(64),
        evaluationEnvelopeId: '5'.repeat(64),
        releaseAuthority: 'none' as const,
      },
    }],
    evaluatorVersion: 'native-workspace-e2e-v1',
    policyVersion: 'human-review-v1',
    compositionFingerprint: 'a'.repeat(64),
  }
}

function sessionIdentity(
  agent: { session: { header: { id: unknown; createdAt: number; cwd?: string } } },
  workspaceId: string,
) {
  return {
    workspaceId,
    sessionId: String(agent.session.header.id),
    createdAt: agent.session.header.createdAt,
    ...(agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd }),
  }
}

function skillSource(body: string): string {
  return [
    '---',
    'name: native-evolution',
    'description: Native Workspace fixture.',
    '---',
    '',
    body,
    '',
    'Evidence: [internal DSH evidence](references/internal-evidence.md).',
    '',
  ].join('\n')
}

async function makeWritable(path: string): Promise<void> {
  await chmod(path, 0o755).catch(() => undefined)
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isDirectory()) await makeWritable(join(path, entry.name))
  }
}
