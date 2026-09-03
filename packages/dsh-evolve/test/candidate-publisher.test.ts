import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CandidatePublisher } from '../src/candidate-publisher.js'
import { GenerationBundleRepository } from '../src/generation-bundle-repository.js'
import { sha256, hashTree } from '../src/hash.js'
import type {
  CapabilityGeneration,
  EvolutionStore,
  GenerationInput,
} from '../src/generation-store.js'
import type { ReviewCandidate } from '../src/review-inbox.js'
import { assembleSkillBundleArchive } from '../src/skill-bundle-archive.js'
import type { SkillCandidateLineage } from '../src/skill-candidate-lineage.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (path) => {
    await makeWritable(path)
    await rm(path, { recursive: true, force: true })
  }))
})

describe('internally authored Candidate publisher', () => {
  it('publishes and resolves a complete content-addressed Skill Bundle', async () => {
    const root = await temporaryRoot('dsh-evolve-bundle-publisher-')
    const candidate = await newSkillCandidate(root)
    const store = fakeStore()
    const bundles = new GenerationBundleRepository(join(root, 'cache'))
    const publisher = new CandidatePublisher(store, bundles)

    const preview = await publisher.preview(candidate)
    const generation = await publisher.publish(candidate)

    expect(preview).toMatchObject({
      truncated: false,
      impact: {
        version: 'lexical-protected-effects-v1',
        scope: 'new-skill',
        indicators: ['production-change'],
      },
    })
    expect(preview.patch).toContain('new file mode 100644')
    expect(generation).toMatchObject({
      artifacts: [{
        kind: 'skill-bundle',
        name: 'release-proof',
        treeHash: candidate.candidateTreeHash,
        artifactDigest: candidate.lineage?.contentHash,
        contentBase64: expect.any(String),
        lineage: candidate.lineage,
      }],
    })
    expect(generation.artifacts[0]).not.toHaveProperty('gitCommit')

    const provider = await bundles.providerFor(generation)
    const observation = await provider.list({})
    const listed = 'candidates' in observation ? observation.candidates : observation
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ name: 'release-proof', provider: 'evoforge-generation' })
    const definition = await provider.get(listed[0]!, {})
    expect(definition?.content).toContain('Require clean-profile proof')
    expect(definition?.resourceBase).toMatchObject({ kind: 'directory' })

    // A fresh repository instance must verify the immutable cache exactly as a
    // restarted DSH Host would; nested references are part of the normal Skill
    // bundle shape and must not be mistaken for duplicate directories.
    const recoveredProvider = await new GenerationBundleRepository(join(root, 'cache')).providerFor(generation)
    const recovered = await recoveredProvider.list({})
    const recoveredListed = 'candidates' in recovered ? recovered.candidates : recovered
    expect(recoveredListed).toHaveLength(1)
    expect(await recoveredProvider.get(recoveredListed[0]!, {})).toMatchObject({
      name: 'release-proof',
      content: expect.stringContaining('Require clean-profile proof'),
    })
  })

  it('rejects Candidate content that differs from admitted lineage', async () => {
    const root = await temporaryRoot('dsh-evolve-bundle-identity-')
    const candidate = await newSkillCandidate(root)
    const mismatched = {
      ...candidate,
      lineage: { ...candidate.lineage!, contentHash: '0'.repeat(64) },
    }
    const store = fakeStore()
    const publisher = new CandidatePublisher(
      store,
      new GenerationBundleRepository(join(root, 'cache')),
    )

    await expect(publisher.publish(mismatched))
      .rejects.toThrow('brand-new Skill bundle does not match its sealed Candidate identity')
    expect(store.publishGeneration).not.toHaveBeenCalled()
  })

  it('rejects stale capability-absent evidence when the active Generation has the Skill', async () => {
    const root = await temporaryRoot('dsh-evolve-bundle-conflict-')
    const candidate = await newSkillCandidate(root)
    const bundles = new GenerationBundleRepository(join(root, 'cache'))
    const generation = await new CandidatePublisher(fakeStore(), bundles).publish(candidate)
    const conflictingStore = fakeStore(generation)
    const publisher = new CandidatePublisher(conflictingStore, bundles)

    await expect(publisher.preview(candidate))
      .rejects.toThrow("capability-absent review conflicts with active Skill 'release-proof'")
    await expect(publisher.publish(candidate))
      .rejects.toThrow("capability-absent review conflicts with active Skill 'release-proof'")
    expect(conflictingStore.publishGeneration).not.toHaveBeenCalled()
  })

  it('quarantines every legacy repository artifact instead of resolving it', async () => {
    const root = await temporaryRoot('dsh-evolve-legacy-quarantine-')
    const bundles = new GenerationBundleRepository(join(root, 'cache'))
    const legacy = generation({
      id: '1'.repeat(64),
      artifacts: [{
        kind: 'skill',
        name: 'legacy-skill',
        gitCommit: '2'.repeat(40),
        treeHash: '3'.repeat(40),
      }],
    })

    await expect(bundles.providerFor(legacy))
      .rejects.toThrow("contains a quarantined legacy artifact for Skill 'legacy-skill'")
  })

  it('fails closed when persisted Bundle identity is tampered', async () => {
    const root = await temporaryRoot('dsh-evolve-bundle-tamper-')
    const candidate = await newSkillCandidate(root)
    const bundles = new GenerationBundleRepository(join(root, 'cache'))
    const generation = await new CandidatePublisher(fakeStore(), bundles).publish(candidate)
    const artifact = generation.artifacts[0]!
    if (artifact.kind !== 'skill-bundle') throw new Error('expected Skill Bundle artifact')
    const tampered = {
      ...generation,
      artifacts: [{
        ...artifact,
        artifactDigest: '0'.repeat(64),
        lineage: { ...artifact.lineage, contentHash: '0'.repeat(64) },
      }],
    }

    await expect(bundles.providerFor(tampered))
      .rejects.toThrow("Generation Skill bundle 'release-proof' failed content identity verification")
  })

  it('fails closed when an owned materialization is made writable', async () => {
    const root = await temporaryRoot('dsh-evolve-cache-permission-')
    const candidate = await newSkillCandidate(root)
    const cacheRoot = join(root, 'cache')
    const bundles = new GenerationBundleRepository(cacheRoot)
    const generation = await new CandidatePublisher(fakeStore(), bundles).publish(candidate)
    const provider = await bundles.providerFor(generation)
    const observation = await provider.list({})
    const listed = 'candidates' in observation ? observation.candidates : observation
    const definition = await provider.get(listed[0]!, {})
    if (definition?.resourceBase?.kind !== 'directory') throw new Error('expected directory resource')
    await chmod(join(definition.resourceBase.path, 'SKILL.md'), 0o644)

    await expect(new GenerationBundleRepository(cacheRoot).providerFor(generation))
      .rejects.toThrow('is not read-only')
  })

  it('refuses existing-Skill publication until a complete native baseline Bundle is sealed', async () => {
    const root = await temporaryRoot('dsh-evolve-existing-abstain-')
    const { baselineKind: _baselineKind, ...candidate } = await newSkillCandidate(root)
    const store = fakeStore()
    const bundles = { providerFor: vi.fn() }
    const publisher = new CandidatePublisher(store, bundles)

    await expect(publisher.preview(candidate))
      .rejects.toThrow("cannot be published without a sealed complete baseline Bundle")
    await expect(publisher.publish(candidate))
      .rejects.toThrow("cannot be published without a sealed complete baseline Bundle")
    expect(bundles.providerFor).not.toHaveBeenCalled()
    expect(store.publishGeneration).not.toHaveBeenCalled()
  })

  it('rejects lineage that names a different exact Candidate tree', async () => {
    const root = await temporaryRoot('dsh-evolve-lineage-mismatch-')
    const candidate = await newSkillCandidate(root)
    const mismatched = {
      ...candidate,
      lineage: { ...candidate.lineage!, candidateTreeHash: '0'.repeat(64) },
    }
    const store = fakeStore()
    const publisher = new CandidatePublisher(
      store,
      new GenerationBundleRepository(join(root, 'cache')),
    )

    await expect(publisher.preview(mismatched))
      .rejects.toThrow('Review lineage does not match its exact Candidate')
    await expect(publisher.publish(mismatched))
      .rejects.toThrow('Review lineage does not match its exact Candidate')
    expect(store.publishGeneration).not.toHaveBeenCalled()
  })
})

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

async function newSkillCandidate(root: string): Promise<ReviewCandidate> {
  const skill = [
    '---',
    'name: release-proof',
    'description: Produce durable release proof.',
    '---',
    '',
    '# Release Proof',
    '',
    'Require clean-profile proof before declaring success.',
    'Follow the [evidence protocol](references/evidence.md).',
    '',
  ].join('\n')
  const reference = '# Evidence\n\nRecord the exact DSH revision.\n'
  const candidateDir = join(root, 'candidate-tree')
  await mkdir(join(candidateDir, 'references'), { recursive: true })
  await writeFile(join(candidateDir, 'SKILL.md'), skill)
  await writeFile(join(candidateDir, 'references', 'evidence.md'), reference)
  const proposal = {
    claim: 'Add the internally discovered release-proof Skill',
    files: [
      { path: 'SKILL.md', content: skill },
      { path: 'references/evidence.md', content: reference },
    ],
  }
  const candidateTreeHash = await hashTree(candidateDir)
  const assembled = await assembleSkillBundleArchive(proposal.files)
  return {
    id: '7'.repeat(64),
    workspaceId: WORKSPACE_ID,
    runId: '8'.repeat(64),
    status: 'pending',
    outputDir: join(root, 'run'),
    skillName: 'release-proof',
    recommendation: 'promote',
    claim: proposal.claim,
    changedFiles: proposal.files.map(file => file.path),
    candidateTreeHash,
    baseTreeHash: '9'.repeat(64),
    baselineKind: 'capability-absent',
    proposalHash: sha256(JSON.stringify(proposal)),
    proposal,
    cases: [{ id: 'holdout', baseline: 'fail', candidate: 'pass', passedChecks: 5, totalChecks: 5 }],
    cost: { inputTokens: 0, outputTokens: 0, trialCount: 4 },
    reasons: ['candidate passed while the absent baseline failed'],
    limitations: ['internal Candidate has no release authority'],
    evaluatorVersion: 'holdout-v1',
    compositionFingerprint: 'a'.repeat(64),
    compositionStable: true,
    startedAt: '2026-08-19T00:00:00.000Z',
    lineage: {
      ...discoveredLineage(candidateTreeHash, assembled.artifactDigest),
      candidateId: 'b'.repeat(64),
      skillName: 'release-proof',
      opportunityId: 'c'.repeat(64),
    },
    evidenceHash: 'd'.repeat(64),
  }
}

function discoveredLineage(
  candidateTreeHash: string,
  contentHash: string,
): SkillCandidateLineage {
  return {
    kind: 'internal-skill-candidate-lineage-v3',
    candidateId: '1'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: 'release-proof',
    opportunityId: '4'.repeat(64),
    evaluationEvidenceId: '6'.repeat(64),
    policyId: 'release-proof-author',
    versionKind: 'experience-authored-bundle-v1',
    contentHash,
    candidateTreeHash,
    admissionId: '3'.repeat(64),
    evaluationEnvelopeId: 'e'.repeat(64),
    releaseAuthority: 'none',
  }
}

function fakeStore(active?: CapabilityGeneration): EvolutionStore & {
  publishGeneration: ReturnType<typeof vi.fn>
} {
  const publishGeneration = vi.fn(async (input: GenerationInput) => {
    const value = generation({
      ...input,
      id: sha256(JSON.stringify({ schemaVersion: 2, ...input })),
    })
    return { created: true, generation: value }
  })
  return {
    publishGeneration,
    getGeneration: vi.fn(),
    getActiveGeneration: vi.fn(() => active),
    promoteGeneration: vi.fn(),
    rollbackGeneration: vi.fn(),
    pinSession: vi.fn(),
    fallbackSessionToNative: vi.fn(),
    getSessionGeneration: vi.fn(),
    isRecoveryPaused: vi.fn(() => false),
    setRecoveryPaused: vi.fn(),
    close: vi.fn(),
  } as unknown as EvolutionStore & { publishGeneration: ReturnType<typeof vi.fn> }
}

function generation(input: Partial<CapabilityGeneration> & Pick<CapabilityGeneration, 'id'>): CapabilityGeneration {
  return {
    schemaVersion: 2,
    workspaceId: WORKSPACE_ID,
    createdAt: 1_723_456_789_000,
    artifacts: [],
    evaluatorVersion: 'fixture-v1',
    policyVersion: 'fixture-policy',
    compositionFingerprint: 'f'.repeat(64),
    ...input,
  }
}

async function makeWritable(root: string): Promise<void> {
  await chmod(root, 0o755).catch(() => undefined)
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await makeWritable(path)
    else await chmod(path, 0o644).catch(() => undefined)
  }
}
