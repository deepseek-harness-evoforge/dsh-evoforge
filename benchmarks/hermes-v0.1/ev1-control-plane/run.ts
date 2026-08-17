import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { GitSkillSource } from '../../../packages/dsh-evolve/src/git-skill-source.ts'
import { openEvolutionStore } from '../../../packages/dsh-evolve/src/generation-store.ts'
import { runCalibrationTrial, runComparisonTrial } from '../../../packages/dsh-evolve/src/trial.ts'
import { VerifiedEvolutionStore } from '../../../packages/dsh-evolve/src/verified-evolution-store.ts'

const execFile = promisify(execFileCallback)
const benchmarkRoot = dirname(fileURLToPath(import.meta.url))
const suiteRoot = resolve(benchmarkRoot, '../../..')
const dshRoot = resolve(suiteRoot, '../deepseek-harness')
const hermesRoot = resolve(suiteRoot, '../hermes-agent')
const manifest = JSON.parse(await readFile(join(benchmarkRoot, 'manifest.json'), 'utf8'))
const expectedResult = JSON.parse(await readFile(join(benchmarkRoot, 'result.json'), 'utf8'))
const casePackDir = resolve(suiteRoot, manifest.fixture.casePack)
const baselineFixture = join(casePackDir, manifest.fixture.baseline)
const correctionFixture = join(casePackDir, manifest.fixture.correction)
const skillName = 'browser-e2e-baseline'
const workspaceA = '11111111-1111-4111-8111-111111111111'
const workspaceB = '22222222-2222-4222-8222-222222222222'
const temporaryRoot = await mkdtemp(join(tmpdir(), 'evoforge-hermes-ev1-'))

try {
  await assertRevision(dshRoot, manifest.revisions.deepseekHarness)
  await assertRevision(hermesRoot, manifest.revisions.hermesAgent)

  const baselineDir = join(temporaryRoot, 'dsh-baseline')
  const candidateDir = join(temporaryRoot, 'dsh-candidate')
  const trialOutput = join(temporaryRoot, 'trial-output')
  await Promise.all([
    cp(baselineFixture, baselineDir, { recursive: true }),
    cp(correctionFixture, candidateDir, { recursive: true }),
    mkdir(trialOutput),
  ])
  const baselineBefore = await fileHash(join(baselineDir, 'SKILL.md'))
  const trial = {
    evaluator: manifest.fixture.evaluator,
    timeoutMs: 5_000,
    outputLimitBytes: 65_536,
  }
  const calibration = await runCalibrationTrial({
    calibration: { knownBad: manifest.fixture.baseline, knownCorrection: manifest.fixture.correction },
    casePackDir,
    dshRevision: manifest.revisions.deepseekHarness,
    outputDir: trialOutput,
    trial,
    trialLimit: 4,
  })
  const evoforgeTrial = await runComparisonTrial({
    casePackDir,
    dshRevision: manifest.revisions.deepseekHarness,
    outputDir: trialOutput,
    candidateSkillDir: candidateDir,
    skillDir: baselineDir,
    trial,
    trialLimit: 4,
  })

  const baseline = await readFile(join(baselineDir, 'SKILL.md'), 'utf8')
  const correction = await readFile(join(candidateDir, 'SKILL.md'), 'utf8')
  const oldString = 'For Web or GUI work, component tests and screenshots are sufficient.'
  const newString = 'For Web or GUI work, verify the real flow in a controlled browser, refresh once, and inspect the visible failure path.'
  if (!baseline.includes(oldString) || !correction.includes(newString)) {
    throw new Error('frozen correction fixture no longer matches the benchmark epoch')
  }
  const hermesInput = join(temporaryRoot, 'hermes-input.json')
  await writeFile(hermesInput, JSON.stringify({ name: skillName, baseline, oldString, newString }))
  const hermesHome = join(temporaryRoot, 'hermes-home')
  await mkdir(hermesHome)
  const hermesProcess = await execFile('python3', [
    join(benchmarkRoot, 'hermes-active-skill.py'),
    hermesRoot,
    hermesHome,
    hermesInput,
  ], {
    cwd: hermesRoot,
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
      HERMES_DISABLE_TELEMETRY: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    },
    timeout: 30_000,
  })
  const hermesMutation = JSON.parse(hermesProcess.stdout.trim())
  const hermesTrial = await runComparisonTrial({
    casePackDir,
    dshRevision: manifest.revisions.deepseekHarness,
    outputDir: trialOutput,
    candidateSkillDir: hermesMutation.activePath.replace(/\/SKILL\.md$/u, ''),
    skillDir: hermesMutation.baselineSnapshot,
    trial,
    trialLimit: 4,
  })

  const release = await exerciseEvoForgeRelease({ baselineDir, candidateDir })
  const baselineAfter = await fileHash(join(baselineDir, 'SKILL.md'))
  const result = {
    schemaVersion: 1,
    benchmarkId: manifest.id,
    revisions: manifest.revisions,
    comparable: true,
    scope: manifest.scope,
    calibration,
    outcome: {
      evoforge: trialOutcome(evoforgeTrial),
      hermes: trialOutcome(hermesTrial),
    },
    primaryMetric: {
      name: 'active Skill artifacts modified before final-test and explicit promotion',
      lowerIsBetter: true,
      evoforge: baselineBefore === baselineAfter ? 0 : 1,
      hermes: hermesMutation.activeModifiedInPlace ? 1 : 0,
    },
    hardGates: {
      evoforge: {
        calibrated: calibration.calibration.every((entry: { passed: boolean }) => entry.passed),
        baselineImmutableDuringTrial: baselineBefore === baselineAfter,
        oldSessionPinnedAcrossPromotion: release.oldSessionGeneration === release.baselineGeneration,
        futureSessionUsesCandidate: release.newSessionGeneration === release.candidateGeneration,
        crossWorkspaceFailClosed: release.crossWorkspaceFailClosed,
        rollbackAndRestartExact: release.rollbackAndRestartExact,
      },
      hermes: {
        calibrated: calibration.calibration.every((entry: { passed: boolean }) => entry.passed),
        baselineImmutableDuringTrial: false,
        activeArtifactModifiedInPlace: hermesMutation.activeModifiedInPlace,
        candidateBoundaryBeforeMutation: false,
        sessionGenerationPin: false,
      },
    },
    verdict: 'better for deterministic Skill-correction release control; no claim about model quality, channels, or global Hermes replacement',
  }

  assertResult(result)
  if (JSON.stringify(result) !== JSON.stringify(expectedResult)) {
    throw new Error('paired result drifted from the frozen epoch; create a new epoch instead of rewriting evidence')
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  await makeWritable(temporaryRoot)
  await rm(temporaryRoot, { recursive: true, force: true })
}

async function exerciseEvoForgeRelease(input: { baselineDir: string; candidateDir: string }) {
  const repository = join(temporaryRoot, 'skill-source')
  const skillDir = join(repository, 'skills', skillName)
  await mkdir(skillDir, { recursive: true })
  await cp(join(input.baselineDir, 'SKILL.md'), join(skillDir, 'SKILL.md'))
  await git(repository, 'init', '--quiet')
  await git(repository, 'add', '.')
  await git(repository, '-c', 'user.name=EvoForge Benchmark', '-c', 'user.email=benchmark@example.invalid', 'commit', '--quiet', '-m', 'baseline')
  const baselineRevision = await revision(repository)
  await cp(join(input.candidateDir, 'SKILL.md'), join(skillDir, 'SKILL.md'))
  await git(repository, 'add', '.')
  await git(repository, '-c', 'user.name=EvoForge Benchmark', '-c', 'user.email=benchmark@example.invalid', 'commit', '--quiet', '-m', 'candidate')
  const candidateRevision = await revision(repository)

  const configPath = await writeStorageConfig(temporaryRoot)
  const firstContext = await bootStorage(configPath, 'evoforge-hermes-ev1-first')
  let baselineGeneration = ''
  let candidateGeneration = ''
  let oldSessionGeneration = ''
  let newSessionGeneration = ''
  let crossWorkspaceFailClosed = false
  try {
    const source = new GitSkillSource(join(temporaryRoot, 'generation-cache'), [{
      name: skillName,
      repository,
      path: `skills/${skillName}`,
    }])
    const store = new VerifiedEvolutionStore(await openEvolutionStore(firstContext.storageDomain), source)
    const compositionFingerprint = createHash('sha256').update('ev1-stable-composition').digest('hex')
    const root = await store.publishGeneration(generationInput(workspaceA, baselineRevision, compositionFingerprint))
    baselineGeneration = root.generation.id
    await store.promoteGeneration(workspaceA, baselineGeneration)
    const oldIdentity = { workspaceId: workspaceA, sessionId: 'ev1-old-session', createdAt: 1 }
    oldSessionGeneration = (await store.pinSession(oldIdentity))?.id ?? ''
    const candidate = await store.publishGeneration(generationInput(
      workspaceA,
      candidateRevision,
      compositionFingerprint,
      baselineGeneration,
    ))
    candidateGeneration = candidate.generation.id
    try {
      await store.promoteGeneration(workspaceB, candidateGeneration)
    } catch (error) {
      crossWorkspaceFailClosed = error instanceof Error && error.message.includes('belongs to Workspace')
    }
    await store.promoteGeneration(workspaceA, candidateGeneration)
    oldSessionGeneration = (await store.pinSession(oldIdentity))?.id ?? ''
    newSessionGeneration = (await store.pinSession({
      workspaceId: workspaceA,
      sessionId: 'ev1-new-session',
      createdAt: 2,
    }))?.id ?? ''
    await store.rollbackGeneration(workspaceA)
    await store.close()
  } finally {
    await firstContext.fiber.dispose()
  }

  const secondContext = await bootStorage(configPath, 'evoforge-hermes-ev1-second')
  let rollbackAndRestartExact = false
  try {
    const store = await openEvolutionStore(secondContext.storageDomain)
    rollbackAndRestartExact = store.getActiveGeneration(workspaceA)?.id === baselineGeneration
      && store.getSessionGeneration({ workspaceId: workspaceA, sessionId: 'ev1-old-session', createdAt: 1 })?.id === baselineGeneration
      && store.getSessionGeneration({ workspaceId: workspaceA, sessionId: 'ev1-new-session', createdAt: 2 })?.id === candidateGeneration
    await store.close()
  } finally {
    await secondContext.fiber.dispose()
  }
  return {
    baselineGeneration,
    candidateGeneration,
    oldSessionGeneration,
    newSessionGeneration,
    crossWorkspaceFailClosed,
    rollbackAndRestartExact,
  }
}

function generationInput(
  workspaceId: string,
  revision: { commit: string; treeHash: string },
  compositionFingerprint: string,
  parentId?: string,
) {
  return {
    workspaceId,
    ...(parentId === undefined ? {} : { parentId }),
    createdAt: parentId === undefined ? 1 : 2,
    artifacts: [{ kind: 'skill' as const, name: skillName, gitCommit: revision.commit, treeHash: revision.treeHash }],
    evaluatorVersion: 'browser-e2e-guidance-v1',
    policyVersion: 'ev1-paired-epoch-1',
    compositionFingerprint,
  }
}

async function writeStorageConfig(root: string): Promise<string> {
  const packageScope = join(root, 'node_modules', '@deepseek-ai')
  await mkdir(packageScope, { recursive: true })
  for (const [name, source] of [
    ['dsh-storage', join(dshRoot, 'packages', 'storage', 'storage')],
    ['dsh-storage-json', join(dshRoot, 'packages', 'storage', 'storage-json')],
    ['dsh-storage-domain', join(dshRoot, 'packages', 'storage', 'storage-domain')],
  ] as const) {
    await symlink(source, join(packageScope, name), 'dir')
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  const configPath = join(root, 'storage.cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'storage', name: '@deepseek-ai/dsh-storage' },
    { id: 'storage-json', name: '@deepseek-ai/dsh-storage-json', config: { root: join(root, 'storage') } },
    { id: 'storage-domain', name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
  ], null, 2))
  return configPath
}

async function bootStorage(configPath: string, name: string) {
  const { boot } = await import(pathToFileURL(join(
    dshRoot,
    'packages',
    'boot',
    'app-boot',
    'lib',
    'index.js',
  )).href)
  return boot(name, configPath)
}

function trialOutcome(result: { baseline: { passed: boolean }; candidate: { passed: boolean } }) {
  return { baseline: result.baseline.passed ? 'pass' : 'fail', corrected: result.candidate.passed ? 'pass' : 'fail' }
}

function assertResult(result: any): void {
  if (result.outcome.evoforge.baseline !== 'fail' || result.outcome.evoforge.corrected !== 'pass') {
    throw new Error('EvoForge did not produce the frozen fail-to-pass outcome')
  }
  if (result.outcome.hermes.baseline !== 'fail' || result.outcome.hermes.corrected !== 'pass') {
    throw new Error('Hermes did not produce the frozen fail-to-pass outcome')
  }
  if (!Object.values(result.hardGates.evoforge).every(Boolean)) {
    throw new Error(`EvoForge hard gate failed: ${JSON.stringify(result.hardGates.evoforge)}`)
  }
  if (result.primaryMetric.evoforge !== 0 || result.primaryMetric.hermes !== 1) {
    throw new Error(`primary metric did not match the frozen expectation: ${JSON.stringify(result.primaryMetric)}`)
  }
}

async function revision(repository: string) {
  return {
    commit: await git(repository, 'rev-parse', 'HEAD'),
    treeHash: await git(repository, 'rev-parse', `HEAD:skills/${skillName}`),
  }
}

async function assertRevision(repository: string, expected: string): Promise<void> {
  const actual = await git(repository, 'rev-parse', 'HEAD')
  if (actual !== expected) throw new Error(`${repository} is ${actual}, expected ${expected}`)
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile('git', args, { cwd, timeout: 30_000 })
  return result.stdout.trim()
}

async function fileHash(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function makeWritable(root: string): Promise<void> {
  try {
    await realpath(root)
    await execFile('chmod', ['-R', 'u+w', root], { timeout: 30_000 })
  } catch {
    // Best-effort cleanup after sealed Trial materialization.
  }
}
