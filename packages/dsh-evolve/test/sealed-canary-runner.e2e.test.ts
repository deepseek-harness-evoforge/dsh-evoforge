import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { createSealedCanaryRunner } from '../src/sealed-canary-runner.js'
import type { DeliveryOutcome } from '../src/delivery-outcome-monitor.js'
import type { CapabilityGeneration } from '../src/generation-store.js'
import { GitSkillSource } from '../src/git-skill-source.js'
import { hashTree, sha256 } from '../src/hash.js'
import type { ReviewCandidate } from '../src/review-inbox.js'
import { assembleSkillBundleArchive } from '../src/skill-bundle-archive.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const execFile = promisify(execFileCallback)
const suiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (path) => {
    await makeWritable(path)
    await rm(path, { force: true, recursive: true })
  }))
})

describe.skipIf(process.platform !== 'darwin')('sealed counterfactual canary runner', () => {
  it('replays the original Case Pack against exact Git parent and Candidate with zero model access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-sealed-canary-'))
    temporaryRoots.push(root)
    const repository = join(root, 'source')
    const skillPath = 'skills/stable-skill'
    await mkdir(join(repository, skillPath), { recursive: true })
    await git(repository, 'init', '--quiet')
    await writeSkill(join(repository, skillPath), 'Stable behavior.')
    await commit(repository, 'baseline')
    const parent = await revision(repository, skillPath)
    const parentContentHash = await hashTree(join(repository, skillPath))
    await writeSkill(join(repository, skillPath), 'Stable behavior.\n\nREGRESSION')
    await commit(repository, 'candidate')
    const candidateArtifact = await revision(repository, skillPath)
    const candidateContentHash = await hashTree(join(repository, skillPath))

    const casePackDir = join(root, 'case-pack')
    await writeCasePack(casePackDir)
    const outputDir = join(root, 'run')
    await mkdir(outputDir)
    const casePackHash = await hashTree(casePackDir)
    const generation: CapabilityGeneration = {
      id: '1'.repeat(64),
      schemaVersion: 2,
      workspaceId: WORKSPACE_ID,
      createdAt: 1_723_456_789_000,
      artifacts: [{ kind: 'skill', name: 'stable-skill', ...candidateArtifact }],
      evaluatorVersion: 'canary-e2e-v1',
      policyVersion: 'auto-clear-instruction-v1',
      compositionFingerprint: '2'.repeat(64),
    }
    const proposal = {
      claim: 'candidate fixture',
      files: [{ path: 'SKILL.md', content: 'fixture' }],
    }
    await writeFile(join(outputDir, 'run-state.json'), `${JSON.stringify({
      schemaVersion: 1,
      runId: '3'.repeat(64),
      phase: 'complete',
      startedAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:01:00.000Z',
      identity: {
        workspaceId: WORKSPACE_ID,
        baseTreeHash: parentContentHash,
        casePackHash,
        dshRevision: 'fixture-dsh',
        evaluatorVersion: 'canary-e2e-v1',
        modelConfigHash: '4'.repeat(64),
        modelRoute: 'fixture-model',
        skillName: 'stable-skill',
      },
      resumeInputs: { skillDir: join(repository, skillPath), casePackDir },
      proposal,
      proposalHash: sha256(JSON.stringify(proposal)),
      modelUsage: { inputTokens: 12, outputTokens: 4 },
      outcome: { kind: 'complete', reportPath: join(outputDir, 'report.json'), summary: 'promote' },
    }, null, 2)}\n`)
    const review = reviewCandidate(outputDir, parentContentHash, candidateContentHash)
    const source = new GitSkillSource(join(root, 'cache'), [{
      name: 'stable-skill', repository, path: skillPath,
    }])
    const runner = createSealedCanaryRunner(source, { getGeneration: () => undefined })
    const previousModelBaseUrl = process.env.DSH_EVOLVE_MODEL_BASE_URL
    const previousModelName = process.env.DSH_EVOLVE_MODEL_NAME
    delete process.env.DSH_EVOLVE_MODEL_BASE_URL
    delete process.env.DSH_EVOLVE_MODEL_NAME
    try {
      await expect(runner({
        candidate: review,
        generation,
        outcome: failedOutcome(generation.id),
        signal: new AbortController().signal,
      })).resolves.toMatchObject({
        calibrationPassed: true,
        parentPassed: true,
        candidatePassed: false,
        report: {
          backend: 'darwin-seatbelt',
          trialCount: 4,
          proposalModelCalls: 0,
          parentContentHash,
          candidateContentHash,
        },
      })
    } finally {
      restoreEnvironment('DSH_EVOLVE_MODEL_BASE_URL', previousModelBaseUrl)
      restoreEnvironment('DSH_EVOLVE_MODEL_NAME', previousModelName)
    }
  })

  it('replays a new Skill against its exact capability-absent parent without any Git source', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-absent-sealed-canary-')))
    temporaryRoots.push(root)
    const baselineDir = join(root, 'absent-subject')
    const candidateDir = join(root, 'candidate')
    const outputDir = join(root, 'run')
    const casePackDir = join(suiteRoot, 'examples', 'case-packs', 'browser-e2e-guidance-assembled')
    await Promise.all([
      mkdir(baselineDir),
      mkdir(join(candidateDir, 'references'), { recursive: true }),
      mkdir(outputDir),
    ])
    await writeFile(join(baselineDir, 'subject.json'), `${JSON.stringify({
      schemaVersion: 1,
      kind: 'internal-capability-absent-subject-v1',
      workspaceId: WORKSPACE_ID,
      opportunityId: 'b'.repeat(64),
      skillName: 'browser-e2e-baseline',
    })}\n`)
    const skill = [
      '---',
      'name: browser-e2e-baseline',
      'description: Develop a DSH plugin from a user request.',
      '---',
      '',
      '# Develop a DSH Plugin',
      '',
      'For Web or GUI work, verify the real flow in a controlled browser.',
      'Follow the [verification contract](references/verification.md).',
      '',
    ].join('\n')
    const reference = '# Verification\n\nRefresh once and inspect the visible failure path.\n'
    await writeFile(join(candidateDir, 'SKILL.md'), skill)
    await writeFile(join(candidateDir, 'references', 'verification.md'), reference)
    const proposal = {
      claim: 'Add the missing browser verification Skill',
      files: [
        { path: 'SKILL.md', content: skill },
        { path: 'references/verification.md', content: reference },
      ],
    }
    const bundle = await assembleSkillBundleArchive(proposal.files)
    const baseTreeHash = await hashTree(baselineDir)
    const casePackHash = await hashTree(casePackDir)
    const manifest = JSON.parse(await readFile(join(casePackDir, 'manifest.json'), 'utf8')) as {
      epoch: { dshRevision: string; evaluatorVersion: string }
    }
    const lineage = {
      kind: 'internal-skill-candidate-lineage-v3' as const,
      candidateId: 'a'.repeat(64),
      workspaceId: WORKSPACE_ID,
      skillName: 'browser-e2e-baseline',
      opportunityId: 'b'.repeat(64),
      evaluationEvidenceId: '6'.repeat(64),
      policyId: 'browser-skill-author',
      versionKind: 'experience-authored-bundle-v1' as const,
      contentHash: bundle.artifactDigest,
      candidateTreeHash: bundle.treeHash,
      admissionId: 'c'.repeat(64),
      evaluationEnvelopeId: 'd'.repeat(64),
      releaseAuthority: 'none' as const,
    }
    const runId = 'e'.repeat(64)
    await writeFile(join(outputDir, 'run-state.json'), `${JSON.stringify({
      schemaVersion: 1,
      runId,
      phase: 'complete',
      startedAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:01:00.000Z',
      identity: {
        workspaceId: WORKSPACE_ID,
        baseTreeHash,
        baselineKind: 'capability-absent',
        casePackHash,
        dshRevision: manifest.epoch.dshRevision,
        evaluatorVersion: manifest.epoch.evaluatorVersion,
        modelConfigHash: 'f'.repeat(64),
        modelRoute: 'fixture-model',
        skillName: 'browser-e2e-baseline',
        skillCandidateLineage: lineage,
      },
      resumeInputs: {
        skillDir: baselineDir,
        casePackDir,
        baselineKind: 'capability-absent',
        baselineSkillName: 'browser-e2e-baseline',
        candidateSkillDir: candidateDir,
      },
      proposal,
      proposalHash: sha256(JSON.stringify(proposal)),
      modelUsage: { inputTokens: 0, outputTokens: 0 },
      outcome: {
        kind: 'complete',
        reportPath: join(outputDir, 'report.json'),
        summary: 'promote: exact Candidate passed',
      },
    }, null, 2)}\n`)
    const generation: CapabilityGeneration = {
      id: '1'.repeat(64),
      schemaVersion: 2,
      workspaceId: WORKSPACE_ID,
      createdAt: 1_723_456_789_000,
      artifacts: [{
        kind: 'skill-bundle',
        name: 'browser-e2e-baseline',
        artifactDigest: bundle.artifactDigest,
        treeHash: bundle.treeHash,
        contentBase64: bundle.content.toString('base64'),
        lineage,
      }],
      evaluatorVersion: manifest.epoch.evaluatorVersion,
      policyVersion: 'human-review-v1',
      compositionFingerprint: '2'.repeat(64),
    }
    const review: ReviewCandidate = {
      ...reviewCandidate(outputDir, baseTreeHash, bundle.treeHash),
      runId,
      skillName: 'browser-e2e-baseline',
      baselineKind: 'capability-absent',
      changedFiles: proposal.files.map(file => file.path),
      evaluatorVersion: manifest.epoch.evaluatorVersion,
      proposal,
      proposalHash: sha256(JSON.stringify(proposal)),
      lineage,
    }
    const runner = createSealedCanaryRunner(
      new GitSkillSource(join(root, 'cache'), []),
      { getGeneration: () => undefined },
    )
    const previousDshSource = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
    process.env.DSH_EVOLVE_DSH_SOURCE_DIR = dshSourceDir
    try {
      await expect(runner({
        candidate: review,
        generation,
        outcome: failedOutcome(generation.id),
        signal: new AbortController().signal,
      })).resolves.toMatchObject({
        calibrationPassed: true,
        parentPassed: false,
        candidatePassed: true,
        report: {
          parentKind: 'capability-absent',
          parentContentHash: baseTreeHash,
          candidateContentHash: bundle.treeHash,
          proposalModelCalls: 0,
        },
      })

      const parentId = '9'.repeat(64)
      const generationWithInvalidParent = { ...generation, parentId }
      const invalidParent = { ...generation, id: parentId }
      const guardedRunner = createSealedCanaryRunner(
        new GitSkillSource(join(root, 'guard-cache'), []),
        { getGeneration: id => id === parentId ? invalidParent : undefined },
      )
      await expect(guardedRunner({
        candidate: review,
        generation: generationWithInvalidParent,
        outcome: failedOutcome(generation.id),
        signal: new AbortController().signal,
      })).rejects.toThrow('capability-absent parent unexpectedly contains the target Skill')
    } finally {
      restoreEnvironment('DSH_EVOLVE_DSH_SOURCE_DIR', previousDshSource)
    }
  }, 100_000)
})

async function writeCasePack(casePackDir: string): Promise<void> {
  await mkdir(join(casePackDir, 'calibration', 'known-bad'), { recursive: true })
  await mkdir(join(casePackDir, 'calibration', 'known-correction'), { recursive: true })
  await writeSkill(join(casePackDir, 'calibration', 'known-bad'), 'REGRESSION')
  await writeSkill(join(casePackDir, 'calibration', 'known-correction'), 'Stable behavior.')
  await writeFile(join(casePackDir, 'evaluator.mjs'), [
    "import { readFile } from 'node:fs/promises'",
    "import { join } from 'node:path'",
    "const source = await readFile(join(process.argv[2], 'SKILL.md'), 'utf8')",
    "const passed = source.includes('Stable behavior.') && !source.includes('REGRESSION')",
    "process.stdout.write(JSON.stringify({ schemaVersion: 1, passed, checks: [{ name: 'stable', passed }] }))",
  ].join('\n'))
  await writeFile(join(casePackDir, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    id: 'counterfactual-canary-fixture',
    epoch: { dshRevision: 'fixture-dsh', evaluatorVersion: 'canary-e2e-v1' },
    budget: { candidateLimit: 1, trialLimit: 4, inputTokenLimit: 100, outputTokenLimit: 100 },
    trial: { evaluator: 'evaluator.mjs', timeoutMs: 5_000, outputLimitBytes: 8_192 },
    calibration: {
      knownBad: 'calibration/known-bad',
      knownCorrection: 'calibration/known-correction',
    },
  }, null, 2)}\n`)
}

async function writeSkill(directory: string, body: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), [
    '---',
    'name: stable-skill',
    'description: A sealed canary fixture.',
    '---',
    '',
    body,
    '',
  ].join('\n'))
}

async function commit(repository: string, message: string): Promise<void> {
  await git(repository, 'add', '.')
  await git(repository, '-c', 'user.name=EvoForge Test', '-c', 'user.email=evoforge@example.invalid',
    'commit', '--quiet', '-m', message)
}

async function revision(repository: string, path: string): Promise<{ gitCommit: string; treeHash: string }> {
  return {
    gitCommit: await git(repository, 'rev-parse', 'HEAD'),
    treeHash: await git(repository, 'rev-parse', `HEAD:${path}`),
  }
}

async function git(repository: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', ['-C', repository, ...args], { encoding: 'utf8' })
  return stdout.trim()
}

function reviewCandidate(outputDir: string, baseTreeHash: string, candidateTreeHash: string): ReviewCandidate {
  return {
    id: '5'.repeat(64),
    workspaceId: WORKSPACE_ID,
    runId: '3'.repeat(64),
    status: 'approved',
    outputDir,
    skillName: 'stable-skill',
    recommendation: 'promote',
    claim: 'candidate fixture',
    changedFiles: ['SKILL.md'],
    candidateTreeHash,
    baseTreeHash,
    proposalHash: '6'.repeat(64),
    proposal: { claim: 'candidate fixture', files: [{ path: 'SKILL.md', content: 'fixture' }] },
    cases: [{ id: 'original', baseline: 'fail', candidate: 'pass', passedChecks: 1, totalChecks: 1 }],
    cost: { inputTokens: 12, outputTokens: 4, trialCount: 4 },
    reasons: ['fixture'],
    limitations: [],
    evaluatorVersion: 'canary-e2e-v1',
    compositionFingerprint: '2'.repeat(64),
    compositionStable: true,
    startedAt: '2026-08-16T00:00:00.000Z',
    evidenceHash: '7'.repeat(64),
    decisionActor: 'auto-clear-instruction-v1',
    generationId: '1'.repeat(64),
    activatedAt: '2026-08-16T00:01:00.000Z',
  }
}

function failedOutcome(generationId: string): DeliveryOutcome {
  return {
    id: '8'.repeat(64), schemaVersion: 2, workspaceId: WORKSPACE_ID,
    observedAt: 1_723_456_790_000,
    sessionId: 'session', callId: 'delivery', generationId,
    goal: { id: 'goal', revision: 1, phase: 'active' },
    status: 'failed', reason: 'check-failed:test', commit: '9'.repeat(40),
  }
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function makeWritable(root: string): Promise<void> {
  await chmod(root, 0o700).catch(() => undefined)
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await makeWritable(path)
    else await chmod(path, 0o600).catch(() => undefined)
  }
}
