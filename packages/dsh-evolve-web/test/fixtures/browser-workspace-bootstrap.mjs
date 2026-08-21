import { createHash, randomUUID } from 'node:crypto'
import { mkdir, realpath, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { pack } from '../../../dsh-evolve/node_modules/tar-stream/index.js'
import {
  defineDomain,
  domainTable,
} from '../../../dsh-evolve/node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js'
import { z } from '../../../dsh-evolve/node_modules/zod/index.js'

export const name = 'evoforge-browser-workspace-bootstrap'
export const inject = [
  'agents',
  'agentPresets',
  'sessions',
  'sessionPersistence',
  'storageDomain',
  'tools',
  'workspaceRegistry',
]

const browserExistingSkillCandidateDomain = defineDomain({
  name: 'evoforge_existing_skill_candidates',
  version: 1,
  tables: { candidates: domainTable(z.unknown()) },
})

/** Browser-only fixture: DSH creates and owns the Workspace, Session, and Agent. */
export async function apply(ctx, config) {
  await mkdir(config.runRoot, { recursive: true })
  const evolvePlugin = await import(pathToFileURL(config.evolveEntry).href)
  const workspace = await ctx.workspaceRegistry.create(config.workspacePath, 'EvoForge Browser Acceptance')
  const configureEvaluation = config.seedCapabilityGaps === true
    || config.seedExistingSkillHoldoutEvaluation === true
    || config.seedExistingSkillRetentionEvaluation === true
    || config.seedExistingSkillRelease === true
  const releaseSeed = config.seedExistingSkillRelease === true
    ? await seedExistingSkillReleaseCandidate(ctx, workspace, config)
    : undefined
  const evolutionFiber = ctx.root.plugin(evolvePlugin, {
    cacheRoot: config.cacheRoot,
    ...(configureEvaluation
      ? { candidateEvaluationPolicies: [{
          id: 'browser-evaluation-governance',
          workspaceId: String(workspace.id),
          governanceRoot: config.governanceRoot,
          runRoot: config.runRoot,
          dshRevision: '47f943859bef60e4160492346772ded9b24f765a',
        }] }
      : {}),
    supervisor: {
      runRoots: [{
        workspaceId: String(workspace.id),
        path: configureEvaluation ? join(config.runRoot, 'shadow') : config.runRoot,
      }],
      scanIntervalMs: 30_000,
    },
  })
  await evolutionFiber

  let handle
  let agent = ctx.agents.get(config.sessionId)
  if (agent === undefined) {
    const persisted = (await ctx.sessionPersistence.list())
      .some(header => String(header.id) === String(config.sessionId))
    const common = {
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, config.agentPreset).then(() => undefined),
    }
    handle = persisted
      ? await ctx.agents.resume({ resumeSessionId: config.sessionId, ...common })
      : await ctx.agents.create({
          sessionId: config.sessionId,
          meta: { cwd: workspace.path, agentPreset: config.agentPreset },
          ...common,
        })
    agent = handle.agent
  }
  await workspace.attachSession(agent.session.id)
  const skillEvaluationSeed = config.seedSkillEvaluationRuns === true
    ? await seedExactSkillEvaluationRuns(ctx, workspace, config)
    : undefined
  if (skillEvaluationSeed !== undefined && config.seedCounterfactualCanary === true) {
    const current = await overview(ctx, String(workspace.id), String(agent.session.id))
    const active = current?.active
    const exactActive = active?.artifacts.some(artifact =>
      artifact.kind === 'skill-bundle'
        && artifact.name === skillEvaluationSeed.skillName
        && artifact.lineage?.candidateId === skillEvaluationSeed.candidateId) === true
    if (active !== undefined && exactActive) {
      const canaryId = await seedCounterfactualCanary(
        workspace,
        config,
        skillEvaluationSeed,
        active.id,
      )
      await waitFor(ctx, String(workspace.id), String(agent.session.id), value =>
        value.counterfactualCanary?.runs.some(run =>
          run.id === canaryId && run.status === 'rollback-eligible') === true,
      'real browser fixture did not expose the exact missing-Skill Canary')
    }
  }
  if (releaseSeed === undefined && config.seedExistingSkillHoldoutEvaluation === true) {
    await seedExistingSkillHoldoutEvaluation(workspace, config)
  }
  if (releaseSeed === undefined && config.seedExistingSkillRetentionEvaluation === true) {
    await seedExistingSkillRetentionEvaluation(workspace, config)
  }
  if (releaseSeed !== undefined) {
    const releaseOverview = await waitFor(ctx, String(workspace.id), String(agent.session.id), value =>
      value.existingSkillRelease?.items.some(item =>
        item.candidateId === releaseSeed.candidateId
          && (item.status === 'eligible' || item.status === 'approved')) === true,
    'real browser fixture did not expose an eligible or approved existing Skill release')
    const release = releaseOverview.existingSkillRelease.items.find(item =>
      item.candidateId === releaseSeed.candidateId)
    if (config.seedExistingSkillCounterfactualCanary === true
      && release?.status === 'approved'
      && release.generationId !== undefined
      && release.activeForFutureSessions
      && releaseOverview.active?.id === release.generationId) {
      const canaryId = await seedExistingSkillCounterfactualCanary(
        workspace,
        config,
        releaseSeed,
        release,
      )
      await waitFor(ctx, String(workspace.id), String(agent.session.id), value =>
        value.existingSkillCounterfactualCanary?.runs.some(run =>
          run.id === canaryId && run.status === 'rollback-eligible') === true,
      'real browser fixture did not expose the exact existing-Skill Canary')
    }
  }
  if (config.seedGoalMetrics === true) {
    await seedNativeGoalMetrics(ctx, workspace, agent)
  }
  const skillReuseHandles = []
  if (config.seedSkillReuse === true) {
    await seedNativeSkillReuse(ctx, workspace, config, skillReuseHandles)
  }
  const capabilityHandles = []
  const capabilitySeedTask = config.seedCapabilityGaps === true
    ? new Promise(resolve => setTimeout(resolve, 0))
        .then(async () => {
          const { agentEvents } = await import(pathToFileURL(config.agentEntry).href)
          return seedNativeCapabilityGaps(ctx, workspace, agent, agentEvents, config, capabilityHandles)
        })
    : undefined
  capabilitySeedTask?.catch((error) => {
    const message = `evoforge browser Capability Gap seed failed: ${errorMessage(error)}`
    ctx.logger.error(message)
    console.error(message)
  })
  ctx.effect(() => async () => {
    await capabilitySeedTask?.catch(() => undefined)
    for (const skillReuseHandle of skillReuseHandles.reverse()) await skillReuseHandle.dispose()
    for (const capabilityHandle of capabilityHandles.reverse()) await capabilityHandle.dispose()
    await evolutionFiber.dispose()
    await handle?.dispose()
  }, 'evoforge-browser-workspace-bootstrap.dispose')
}

/**
 * Prepare one exact release-eligible existing-Skill lineage before the installed
 * Host starts. This is durable test setup only: approval and promotion remain
 * untouched so the real Web controls must perform both authority transitions.
 */
async function seedExistingSkillReleaseCandidate(ctx, workspace, config) {
  const workspaceId = String(workspace.id)
  const skillName = 'verify-dsh-release'
  const baseline = await assembleBrowserSkillBundle([{
    path: 'SKILL.md',
    content: [
      '---',
      `name: ${skillName}`,
      'description: Verify the original DSH release procedure.',
      '---',
      '',
      '# Original DSH release procedure',
      '',
      'Run the original verification sequence.',
      '',
    ].join('\n'),
  }, {
    path: 'assets/preserved.bin',
    content: Buffer.from([0, 1, 2, 255]),
  }])
  const candidateArchive = await assembleBrowserSkillBundle([{
    path: 'SKILL.md',
    content: [
      '---',
      `name: ${skillName}`,
      'description: Verify the strengthened DSH release procedure.',
      '---',
      '',
      '# Strengthened DSH release procedure',
      '',
      'Follow the [verified release contract](references/release.md).',
      '',
    ].join('\n'),
  }, {
    path: 'assets/preserved.bin',
    content: Buffer.from([0, 1, 2, 255]),
  }, {
    path: 'references/release.md',
    content: '# Verified release contract\n\nInstall, boot, reload, recover, and uninstall.\n',
  }])
  const opportunityId = sha256('browser-existing-skill-opportunity')
  const qualificationId = sha256('browser-existing-skill-qualification')
  const baselineId = sha256('browser-existing-skill-baseline')
  const evaluationEvidenceId = sha256('browser-existing-skill-evaluation-evidence')
  const envelopeId = sha256('browser-existing-skill-holdout-envelope')
  const input = {
    kind: 'existing-skill-improvement-candidate-v1',
    createdAt: Date.parse('2026-08-21T00:00:00.000Z'),
    workspaceId,
    skillName,
    description: 'Verify the strengthened DSH release procedure.',
    opportunity: {
      kind: 'internal-existing-skill-correction-v1',
      id: opportunityId,
      signalCount: 5,
      goalCount: 5,
    },
    baseline: {
      qualificationId,
      id: baselineId,
      artifactDigest: baseline.artifactDigest,
      treeHash: baseline.treeHash,
    },
    authorship: {
      kind: 'protected-correction-authoring-v1',
      policyId: 'browser-existing-release',
      modelIdentityHash: sha256('browser-protected-author'),
      evaluationEvidenceId,
      inputDigest: sha256('browser-protected-authoring-input'),
      holdoutEnvelopeId: envelopeId,
      claim: 'Preserve the complete installed Skill while strengthening its verified release procedure.',
    },
    scope: 'workspace',
    version: {
      kind: 'existing-skill-improvement-bundle-v1',
      parentBaselineId: baselineId,
      artifactDigest: candidateArchive.artifactDigest,
      treeHash: candidateArchive.treeHash,
    },
    contentHash: candidateArchive.artifactDigest,
    diff: {
      kind: 'bounded-instruction-tree-diff-v1',
      changedPaths: ['SKILL.md', 'references/release.md'],
      addedPaths: ['references/release.md'],
      preservedFileCount: 1,
      preservedBinaryFileCount: 1,
    },
    package: {
      path: skillName,
      fileCount: candidateArchive.files.length,
      totalBytes: candidateArchive.totalBytes,
      hasExecutableFiles: false,
    },
    permissions: {
      declared: false,
      executableContentChanged: false,
      externalEffects: 'unchanged-or-unknown',
    },
    license: { status: 'unknown' },
    safety: {
      status: 'quarantined',
      checks: [
        { name: 'artifact-digest-integrity', status: 'passed' },
        { name: 'exact-baseline-binding', status: 'passed' },
        { name: 'whole-tree-inheritance', status: 'passed' },
        { name: 'skill-identity', status: 'passed' },
        { name: 'instruction-only-diff', status: 'passed' },
        { name: 'effect-review', status: 'required' },
      ],
    },
    artifact: {
      kind: 'sealed-complete-skill-bundle',
      format: 'tar.gz',
      digest: candidateArchive.artifactDigest,
    },
    lifecycle: 'inactive',
    verification: 'unevaluated',
    execution: 'never',
    releaseAuthority: 'none',
  }
  const candidateId = sha256(JSON.stringify([
    'existing-skill-improvement-candidate-v1',
    input.workspaceId,
    input.skillName,
    input.opportunity,
    input.baseline,
    input.authorship,
    input.version,
    input.contentHash,
  ]))
  const candidate = { schemaVersion: 1, id: candidateId, ...input }
  const domain = await ctx.storageDomain.open(browserExistingSkillCandidateDomain)
  try {
    await domain.table('candidates').put(candidateId, candidate)
  } finally {
    await domain.close()
  }

  const candidateRoot = join(config.governanceRoot, 'candidate-vault')
  const artifactRoot = join(candidateRoot, 'existing-skill-candidates', candidateId)
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 })
  await writeFile(join(artifactRoot, 'bundle.tar.gz'), candidateArchive.content, { mode: 0o600 })
  await writeFixtureJson(join(artifactRoot, 'manifest.json'), candidate)

  const admissionId = sha256(JSON.stringify([
    'existing-skill-candidate-admission-v1',
    candidateId,
    workspaceId,
    skillName,
    opportunityId,
    qualificationId,
    baselineId,
    evaluationEvidenceId,
  ]))
  const admissionRoot = join(resolve(config.runRoot), 'existing-skill-admission', 'runs', admissionId)
  await mkdir(admissionRoot, { recursive: true, mode: 0o700 })
  await writeFixtureJson(join(admissionRoot, 'state.json'), {
    schemaVersion: 1,
    kind: 'existing-skill-candidate-admission-state-v1',
    id: admissionId,
    candidateId,
    workspaceId,
    skillName,
    opportunityId,
    qualificationId,
    baselineId,
    evaluationEvidenceId,
  })
  await writeFixtureJson(join(admissionRoot, 'result.json'), {
    schemaVersion: 1,
    id: admissionId,
    candidateId,
    workspaceId,
    skillName,
    status: 'qualified-for-holdout',
    reasons: ['exact-paired-subjects-admitted'],
    evidence: {
      baselineId,
      baselineArtifactDigest: baseline.artifactDigest,
      baselineTreeHash: baseline.treeHash,
      candidateArtifactDigest: candidateArchive.artifactDigest,
      candidateTreeHash: candidateArchive.treeHash,
      evaluationEvidenceId,
      protectedAdmissionSampleHash: sha256('browser-protected-admission-sample'),
      protectedAdmissionSampleCount: 1,
      changedFileCount: 2,
      addedFileCount: 1,
      preservedFileCount: 1,
      preservedBinaryFileCount: 1,
      candidateExecuted: false,
      evaluatorClass: 'host-structural',
    },
    releaseAuthority: 'none',
  })
  const evidence = {
    candidateId,
    admissionId,
    envelopeId,
    opportunityId,
    qualificationId,
    baselineId,
    baselineTreeHash: baseline.treeHash,
    candidateTreeHash: candidateArchive.treeHash,
    holdoutCasePackHash: sha256('browser-existing-skill-holdout-case-pack'),
    retentionCasePackHash: sha256('browser-existing-skill-retention-case-pack'),
    skillName,
  }
  const holdoutEvaluationId = await seedExistingSkillHoldoutEvaluation(workspace, config, evidence)
  const retentionEvaluationId = await seedExistingSkillRetentionEvaluation(
    workspace,
    config,
    { ...evidence, holdoutEvaluationId },
  )
  return { ...evidence, holdoutEvaluationId, retentionEvaluationId }
}

/** Seed one exact durable result for the production existing-Skill scanner. */
async function seedExistingSkillHoldoutEvaluation(workspace, config, release = {}) {
  const workspaceId = String(workspace.id)
  const policyId = 'browser-evaluation-governance'
  const candidateId = release.candidateId ?? '4'.repeat(64)
  const admissionId = release.admissionId ?? '5'.repeat(64)
  const envelopeId = release.envelopeId ?? '6'.repeat(64)
  const opportunityId = release.opportunityId ?? '7'.repeat(64)
  const qualificationId = release.qualificationId ?? '8'.repeat(64)
  const baselineId = release.baselineId ?? '9'.repeat(64)
  const baselineTreeHash = release.baselineTreeHash ?? 'a'.repeat(64)
  const candidateTreeHash = release.candidateTreeHash ?? 'b'.repeat(64)
  const casePackHash = release.holdoutCasePackHash ?? 'c'.repeat(64)
  const dshRevision = '47f943859bef60e4160492346772ded9b24f765a'
  const skillName = release.skillName ?? 'verify-dsh-release'
  const id = sha256(JSON.stringify([
    'existing-skill-holdout-evaluation-v1',
    policyId,
    candidateId,
    admissionId,
    envelopeId,
    workspaceId,
    skillName,
    opportunityId,
    qualificationId,
    baselineId,
    baselineTreeHash,
    candidateTreeHash,
    casePackHash,
    dshRevision,
  ]))
  // Match the production policy's lexical `resolve()` exactly. On macOS,
  // `realpath('/tmp/...')` rewrites the path to `/private/tmp/...`; that makes
  // the fixture's reportPath disagree with the authoritative scanner root.
  const runRoot = resolve(config.runRoot)
  const runDir = join(runRoot, 'existing-skill-holdout', 'runs', id)
  const reportPath = join(runDir, 'result.json')
  const startedAt = '2026-08-21T00:00:00.000Z'
  const finishedAt = '2026-08-21T00:00:01.000Z'
  await mkdir(runDir, { recursive: true })
  await writeFixtureJson(join(runDir, 'state.json'), {
    schemaVersion: 1,
    kind: 'existing-skill-holdout-evaluation-state-v1',
    id,
    policyId,
    candidateId,
    admissionId,
    envelopeId,
    workspaceId,
    skillName,
    opportunityId,
    qualificationId,
    baselineId,
    baselineTreeHash,
    candidateTreeHash,
    casePackHash,
    dshRevision,
    phase: 'complete',
    createdAt: startedAt,
    updatedAt: finishedAt,
  })
  await writeFixtureJson(reportPath, {
    schemaVersion: 1,
    kind: 'existing-skill-holdout-evaluation-result-v1',
    id,
    candidateId,
    admissionId,
    envelopeId,
    workspaceId,
    skillName,
    status: 'complete',
    verdict: 'improved',
    reason: 'candidate-passed-protected-holdout',
    evidence: {
      baselineTreeHash,
      candidateTreeHash,
      casePackHash,
      baseline: 'fail',
      candidate: 'pass',
      calibrationPassed: true,
      assembled: true,
      compositionStable: true,
      inputIntegrityStable: true,
      proposerCalls: 0,
      trialCount: 4,
      modelCalls: { baseline: 1, candidate: 1 },
      usage: {
        baseline: { inputTokens: 120, outputTokens: 20, cacheReadTokens: 40 },
        candidate: { inputTokens: 110, outputTokens: 18, cacheReadTokens: 50 },
      },
    },
    reportPath,
    startedAt,
    finishedAt,
    releaseAuthority: 'none',
  })
  return id
}

/** Seed one exact durable V4.41 Retention result for the production scanner. */
async function seedExistingSkillRetentionEvaluation(workspace, config, release = {}) {
  const workspaceId = String(workspace.id)
  const policyId = 'browser-evaluation-governance'
  const candidateId = release.candidateId ?? '4'.repeat(64)
  const admissionId = release.admissionId ?? '5'.repeat(64)
  const envelopeId = release.envelopeId ?? '6'.repeat(64)
  const opportunityId = release.opportunityId ?? '7'.repeat(64)
  const qualificationId = release.qualificationId ?? '8'.repeat(64)
  const baselineId = release.baselineId ?? '9'.repeat(64)
  const baselineTreeHash = release.baselineTreeHash ?? 'a'.repeat(64)
  const candidateTreeHash = release.candidateTreeHash ?? 'b'.repeat(64)
  const holdoutCasePackHash = release.holdoutCasePackHash ?? 'c'.repeat(64)
  const casePackHash = release.retentionCasePackHash ?? 'd'.repeat(64)
  const dshRevision = '47f943859bef60e4160492346772ded9b24f765a'
  const skillName = release.skillName ?? 'verify-dsh-release'
  const holdoutEvaluationId = release.holdoutEvaluationId ?? sha256(JSON.stringify([
    'existing-skill-holdout-evaluation-v1',
    policyId,
    candidateId,
    admissionId,
    envelopeId,
    workspaceId,
    skillName,
    opportunityId,
    qualificationId,
    baselineId,
    baselineTreeHash,
    candidateTreeHash,
    holdoutCasePackHash,
    dshRevision,
  ]))
  const id = sha256(JSON.stringify([
    'existing-skill-retention-evaluation-v1',
    policyId,
    candidateId,
    holdoutEvaluationId,
    admissionId,
    envelopeId,
    workspaceId,
    skillName,
    opportunityId,
    qualificationId,
    baselineId,
    baselineTreeHash,
    candidateTreeHash,
    holdoutCasePackHash,
    casePackHash,
    dshRevision,
  ]))
  const runRoot = resolve(config.runRoot)
  const runDir = join(runRoot, 'existing-skill-retention', 'runs', id)
  const reportPath = join(runDir, 'result.json')
  const startedAt = '2026-08-21T00:01:00.000Z'
  const finishedAt = '2026-08-21T00:01:01.000Z'
  const regressed = config.retentionStatus === 'regressed'
  await mkdir(runDir, { recursive: true })
  await writeFixtureJson(join(runDir, 'state.json'), {
    schemaVersion: 1,
    kind: 'existing-skill-retention-evaluation-state-v1',
    id,
    policyId,
    candidateId,
    holdoutEvaluationId,
    admissionId,
    envelopeId,
    workspaceId,
    skillName,
    opportunityId,
    qualificationId,
    baselineId,
    baselineTreeHash,
    candidateTreeHash,
    holdoutCasePackHash,
    casePackHash,
    dshRevision,
    phase: 'complete',
    createdAt: startedAt,
    updatedAt: finishedAt,
  })
  await writeFixtureJson(reportPath, {
    schemaVersion: 1,
    kind: 'existing-skill-retention-evaluation-result-v1',
    id,
    candidateId,
    holdoutEvaluationId,
    admissionId,
    envelopeId,
    workspaceId,
    skillName,
    status: 'complete',
    verdict: regressed ? 'regressed' : 'retained',
    reason: regressed
      ? 'candidate-regressed-protected-retention'
      : 'candidate-passed-protected-retention',
    evidence: {
      holdoutCasePackHash,
      baselineTreeHash,
      candidateTreeHash,
      casePackHash,
      baseline: regressed ? 'pass' : 'fail',
      candidate: regressed ? 'fail' : 'pass',
      calibrationPassed: true,
      assembled: true,
      compositionStable: true,
      inputIntegrityStable: true,
      proposerCalls: 0,
      trialCount: 4,
      modelCalls: { baseline: 1, candidate: 1 },
      usage: {
        baseline: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 60 },
        candidate: { inputTokens: 90, outputTokens: 18, cacheReadTokens: 70 },
      },
    },
    reportPath,
    startedAt,
    finishedAt,
    releaseAuthority: 'none',
  })
  return id
}

/**
 * Seed one exact terminal evidence record only after the real Web has approved
 * and promoted the release. The fixture never invokes rollback; the installed
 * Host gate must revalidate this record and the authoritative release lineage.
 */
async function seedExistingSkillCounterfactualCanary(workspace, config, releaseSeed, release) {
  const policyId = 'browser-evaluation-governance'
  const workspaceId = String(workspace.id)
  const generationId = release.generationId
  const outcomeId = sha256('browser-existing-skill-failed-outcome')
  const dshRevision = '47f943859bef60e4160492346772ded9b24f765a'
  const identity = {
    policyId,
    workspaceId,
    generationId,
    outcomeId,
    candidateId: release.candidateId,
    skillName: release.skillName,
    admissionId: release.admissionId,
    holdoutEvaluationId: release.holdoutEvaluationId,
    retentionEvaluationId: release.retentionEvaluationId,
    evaluationEnvelopeId: releaseSeed.envelopeId,
    holdoutCasePackHash: releaseSeed.holdoutCasePackHash,
    retentionCasePackHash: releaseSeed.retentionCasePackHash,
    baselineTreeHash: releaseSeed.baselineTreeHash,
    candidateTreeHash: releaseSeed.candidateTreeHash,
    dshRevision,
  }
  const id = sha256(JSON.stringify([
    'existing-skill-counterfactual-canary-v1',
    identity.policyId,
    identity.workspaceId,
    identity.generationId,
    identity.outcomeId,
    identity.candidateId,
    identity.skillName,
    identity.admissionId,
    identity.holdoutEvaluationId,
    identity.retentionEvaluationId,
    identity.evaluationEnvelopeId,
    identity.holdoutCasePackHash,
    identity.retentionCasePackHash,
    identity.baselineTreeHash,
    identity.candidateTreeHash,
    identity.dshRevision,
  ]))
  const runDir = join(resolve(config.runRoot), 'existing-skill-canary', 'runs', id)
  const startedAt = '2026-08-21T00:02:00.000Z'
  const finishedAt = '2026-08-21T00:02:01.000Z'
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  await writeFixtureJson(join(runDir, 'state.json'), {
    schemaVersion: 1,
    kind: 'existing-skill-counterfactual-canary-state-v1',
    id,
    ...identity,
    phase: 'terminal',
    createdAt: startedAt,
    updatedAt: finishedAt,
  })
  await writeFixtureJson(join(runDir, 'result.json'), {
    schemaVersion: 1,
    kind: 'existing-skill-counterfactual-canary-result-v1',
    id,
    policyId,
    workspaceId,
    generationId,
    outcomeId,
    candidateId: release.candidateId,
    skillName: release.skillName,
    admissionId: release.admissionId,
    holdoutEvaluationId: release.holdoutEvaluationId,
    retentionEvaluationId: release.retentionEvaluationId,
    evaluationEnvelopeId: releaseSeed.envelopeId,
    status: 'rollback-eligible',
    reason: 'candidate-regressed-baseline-recovers',
    startedAt,
    finishedAt,
    evidence: {
      holdoutCasePackHash: releaseSeed.holdoutCasePackHash,
      retentionCasePackHash: releaseSeed.retentionCasePackHash,
      baselineTreeHash: releaseSeed.baselineTreeHash,
      candidateTreeHash: releaseSeed.candidateTreeHash,
      baseline: 'pass',
      candidate: 'fail',
      calibrationPassed: true,
      assembled: true,
      compositionStable: true,
      inputIntegrityStable: true,
      activePointerStable: true,
      proposerCalls: 0,
      trialCount: 4,
      modelCalls: { baseline: 1, candidate: 1 },
      usage: {
        baseline: evaluatorUsage(100, 60),
        candidate: evaluatorUsage(90, 70),
      },
    },
    releaseAuthority: 'none',
  })
  return id
}

/**
 * Seed one exact terminal missing-Skill Canary only after the real Web has
 * promoted its inactive Generation. This fixture owns no pointer writer and
 * never invokes rollback; the installed Host gate must revalidate the exact
 * evidence and expected-active pointer before the browser action can succeed.
 */
async function seedCounterfactualCanary(workspace, config, seed, generationId) {
  const workspaceId = String(workspace.id)
  const outcomeId = sha256('browser-missing-skill-failed-outcome')
  const identityWithoutId = {
    schemaVersion: 1,
    kind: 'internal-counterfactual-canary-run-v1',
    workspaceId,
    generationId,
    outcomeId,
    candidateId: seed.candidateId,
    skillName: seed.skillName,
    reviewId: seed.reviewId,
    retentionId: seed.retentionId,
    admissionId: seed.admissionId,
    evaluationEnvelopeId: seed.evaluationEnvelopeId,
    retentionCasePackHash: seed.retentionCasePackHash,
    baselineTreeHash: seed.baselineTreeHash,
    candidateTreeHash: seed.candidateTreeHash,
  }
  const id = sha256(JSON.stringify([
    'internal-counterfactual-canary-v1',
    identityWithoutId.workspaceId,
    identityWithoutId.generationId,
    identityWithoutId.outcomeId,
    identityWithoutId.candidateId,
    identityWithoutId.skillName,
    identityWithoutId.reviewId,
    identityWithoutId.retentionId,
    identityWithoutId.admissionId,
    identityWithoutId.evaluationEnvelopeId,
    identityWithoutId.retentionCasePackHash,
    identityWithoutId.baselineTreeHash,
    identityWithoutId.candidateTreeHash,
  ]))
  const identity = { ...identityWithoutId, id }
  const runDir = join(resolve(config.runRoot), 'canary', id)
  const startedAt = '2026-08-21T00:03:00.000Z'
  const finishedAt = '2026-08-21T00:03:01.000Z'
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  await writeFixtureJson(join(runDir, 'prepared.json'), identity)
  await writeFixtureJson(join(runDir, 'result.json'), {
    schemaVersion: 1,
    kind: 'internal-counterfactual-canary-result-v1',
    id,
    workspaceId,
    generationId,
    outcomeId,
    candidateId: seed.candidateId,
    skillName: seed.skillName,
    reviewId: seed.reviewId,
    retentionId: seed.retentionId,
    admissionId: seed.admissionId,
    evaluationEnvelopeId: seed.evaluationEnvelopeId,
    status: 'rollback-eligible',
    reason: 'candidate-regressed-sealed-canary',
    startedAt,
    finishedAt,
    evidence: {
      retentionCasePackHash: seed.retentionCasePackHash,
      baselineTreeHash: seed.baselineTreeHash,
      candidateTreeHash: seed.candidateTreeHash,
      baseline: 'pass',
      candidate: 'fail',
      calibrationPassed: true,
      assembled: true,
      compositionStable: true,
      inputIntegrityStable: true,
      activePointerStable: true,
      proposerCalls: 0,
      trialCount: 4,
      modelCalls: { baseline: 2, candidate: 2 },
      usage: {
        baseline: evaluatorUsage(100, 80),
        candidate: evaluatorUsage(90, 70),
      },
    },
    releaseAuthority: 'none',
  })
  return id
}

/**
 * Seed one exact, deterministic Shadow/Retention artifact pair for real-browser
 * projection acceptance. Production readers still validate the full durable
 * shape and lineage; this fixture does not claim a provider evaluation.
 */
async function seedExactSkillEvaluationRuns(ctx, workspace, config) {
  const workspaceId = String(workspace.id)
  const retentionStatus = config.retentionStatus === 'regressed' ? 'regressed' : 'retained'
  const skillName = 'publish-dsh-plugin'
  const candidateId = '1'.repeat(64)
  const opportunityId = '2'.repeat(64)
  const evaluationEvidenceId = '3'.repeat(64)
  const admissionId = '6'.repeat(64)
  const evaluationEnvelopeId = '7'.repeat(64)
  const baselineTreeHash = '8'.repeat(64)
  const shadowRunId = '9'.repeat(64)
  const holdoutCasePackHash = 'a'.repeat(64)
  const compositionFingerprint = 'b'.repeat(64)
  const retentionCasePackHash = 'c'.repeat(64)
  const canonicalRunRoot = await realpath(config.runRoot)
  const shadowRoot = join(canonicalRunRoot, 'shadow')
  const retentionRoot = join(canonicalRunRoot, 'retention')
  const fixtureInputs = join(canonicalRunRoot, 'browser-evaluation-inputs')
  const runDir = join(shadowRoot, 'exact-browser-evaluation')
  const reportPath = join(runDir, 'report.json')
  await Promise.all([
    shadowRoot,
    retentionRoot,
    runDir,
    join(fixtureInputs, 'baseline'),
    join(fixtureInputs, 'holdout'),
    join(fixtureInputs, 'candidate'),
  ].map(path => mkdir(path, { recursive: true })))

  const proposal = {
    claim: 'Preserve verified native DSH plugin delivery behavior.',
    files: [{
      path: 'SKILL.md',
      content: [
        '---',
        `name: ${skillName}`,
        'description: Apply the verified native DSH plugin delivery procedure.',
        '---',
        '',
        '# Native DSH plugin delivery',
        '',
        'Follow the [acceptance contract](references/acceptance.md).',
        '',
      ].join('\n'),
    }, {
      path: 'references/acceptance.md',
      content: '# Acceptance contract\n\nVerify install, boot, reload, dispose, and uninstall.\n',
    }],
  }
  const assembledBundle = await assembleBrowserSkillBundle(proposal.files)
  const contentHash = assembledBundle.artifactDigest
  const candidateTreeHash = assembledBundle.treeHash
  const lineage = {
    kind: 'internal-skill-candidate-lineage-v3',
    candidateId,
    workspaceId,
    skillName,
    opportunityId,
    evaluationEvidenceId,
    policyId: 'browser-evaluation-seed',
    versionKind: 'experience-authored-bundle-v1',
    contentHash,
    candidateTreeHash,
    admissionId,
    evaluationEnvelopeId,
    releaseAuthority: 'none',
  }
  const startedAt = '2026-08-20T00:00:00.000Z'
  const finishedAt = '2026-08-20T00:01:00.000Z'
  await writeFixtureJson(join(runDir, 'run-state.json'), {
    schemaVersion: 1,
    runId: shadowRunId,
    phase: 'complete',
    startedAt,
    updatedAt: finishedAt,
    identity: {
      workspaceId,
      baseTreeHash: baselineTreeHash,
      casePackHash: holdoutCasePackHash,
      dshRevision: 'd'.repeat(40),
      evaluatorVersion: 'browser-holdout-v1',
      modelConfigHash: 'e'.repeat(64),
      modelRoute: 'pinned-internal-candidate-v1',
      skillName,
      baselineKind: 'capability-absent',
      skillCandidateLineage: lineage,
    },
    resumeInputs: {
      skillDir: join(fixtureInputs, 'baseline'),
      casePackDir: join(fixtureInputs, 'holdout'),
      baselineKind: 'capability-absent',
      baselineSkillName: skillName,
      candidateSkillDir: join(fixtureInputs, 'candidate'),
    },
    proposal,
    proposalHash: sha256(JSON.stringify(proposal)),
    modelUsage: { inputTokens: 120, outputTokens: 24 },
    outcome: {
      kind: 'complete',
      reportPath,
      summary: 'promote: exact Candidate passed the sealed browser holdout',
    },
  })
  await writeFixtureJson(reportPath, {
    schemaVersion: 1,
    run: { id: shadowRunId, status: 'complete' },
    subject: {
      skillName,
      baselineKind: 'capability-absent',
      baseTreeHash: baselineTreeHash,
      unchanged: true,
    },
    candidate: {
      treeHash: candidateTreeHash,
      claim: proposal.claim,
      changedFiles: proposal.files.map(file => file.path),
    },
    epoch: { evaluatorVersion: 'browser-holdout-v1' },
    trial: { count: 4 },
    cases: [{
      id: 'sealed-browser-holdout',
      baseline: 'fail',
      candidate: 'pass',
      checks: [
        { name: 'candidate-outcome', passed: true },
        { name: 'composition', passed: true },
      ],
    }],
    composition: {
      baselineFingerprint: compositionFingerprint,
      candidateFingerprint: compositionFingerprint,
      stable: true,
    },
    decision: {
      recommendation: 'promote',
      reasons: ['exact Candidate passed the sealed holdout'],
      limitations: ['deterministic real-browser projection fixture'],
    },
    lineage,
  })

  const retentionId = sha256(JSON.stringify([
    'opportunity-bound-internal-skill-retention-v1',
    candidateId,
    admissionId,
    evaluationEnvelopeId,
    shadowRunId,
    retentionCasePackHash,
  ]))
  const retentionDir = join(retentionRoot, retentionId)
  const retentionReportPath = join(retentionDir, 'result.json')
  await mkdir(retentionDir, { recursive: true })
  await writeFixtureJson(join(retentionDir, 'prepared.json'), {
    schemaVersion: 1,
    kind: 'internal-skill-retention-run-v1',
    id: retentionId,
    candidateId,
    workspaceId,
    skillName,
    admissionId,
    evaluationEnvelopeId,
    shadowRunId,
    baselineTreeHash,
    candidateTreeHash,
    retentionCasePackHash,
  })
  await writeFixtureJson(retentionReportPath, {
    schemaVersion: 1,
    kind: 'internal-skill-retention-result-v1',
    id: retentionId,
    candidateId,
    workspaceId,
    skillName,
    admissionId,
    evaluationEnvelopeId,
    shadowRunId,
    status: retentionStatus,
    reason: retentionStatus === 'retained'
      ? 'candidate-retained-prior-case'
      : 'candidate-regressed-prior-case',
    releaseAuthority: 'none',
    reportPath: retentionReportPath,
    startedAt,
    finishedAt,
    evidence: {
      retentionCasePackHash,
      baselineTreeHash,
      candidateTreeHash,
      baseline: 'pass',
      candidate: retentionStatus === 'retained' ? 'pass' : 'fail',
      calibrationPassed: true,
      compositionStable: true,
      proposerCalls: 0,
      trialCount: 4,
      modelCalls: { baseline: 2, candidate: 2 },
      usage: {
        baseline: evaluatorUsage(100, 80),
        candidate: evaluatorUsage(90, 70),
      },
    },
  })

  const control = ctx.get('evoforge.evolutionControl')
  if (control === undefined) throw new Error('real browser fixture has no installed evolution control')
  const proposalHash = sha256(JSON.stringify(proposal))
  const reviewId = sha256(JSON.stringify({ runId: shadowRunId, proposalHash }))
  const before = await control.overview(workspaceId)
  let active = exactActiveGeneration(before, candidateId, skillName)
  let inactive = before.reviews.inactiveGenerations.find(item => item.reviewId === reviewId)
  if (inactive === undefined && active === undefined) {
    await control.approveReview(workspaceId, reviewId,
      'Deterministic browser fixture: publish exact inactive Generation.')
    const after = await control.overview(workspaceId)
    inactive = after.reviews.inactiveGenerations.find(item => item.reviewId === reviewId)
    active = exactActiveGeneration(after, candidateId, skillName)
  }
  if (inactive === undefined && active === undefined) {
    throw new Error('real browser fixture did not publish or restore the exact Generation')
  }
  const expectedPromotionStatus = retentionStatus === 'retained' ? 'eligible' : 'blocked'
  const expectedPromotionReason = retentionStatus === 'retained'
    ? 'exact-retention-retained'
    : 'retention-regressed'
  if (inactive !== undefined && (inactive.promotion.status !== expectedPromotionStatus
    || inactive.promotion.reason !== expectedPromotionReason
    || inactive.promotion.retentionId !== retentionId)) {
    throw new Error(`real browser fixture did not project exact ${retentionStatus} promotion eligibility`)
  }
  return {
    candidateId,
    skillName,
    reviewId,
    retentionId,
    admissionId,
    evaluationEnvelopeId,
    retentionCasePackHash,
    baselineTreeHash,
    candidateTreeHash,
  }
}

function exactActiveGeneration(overview, candidateId, skillName) {
  const active = overview.active
  if (active === undefined) return undefined
  return active.artifacts.some(artifact =>
    artifact.kind === 'skill-bundle'
      && artifact.name === skillName
      && artifact.lineage?.candidateId === candidateId)
    ? active
    : undefined
}

async function assembleBrowserSkillBundle(input) {
  const files = input.map(file => ({ path: file.path, content: Buffer.from(file.content) }))
    .sort((left, right) => compareBundlePaths(left.path, right.path))
  const tree = createHash('sha256')
  const archive = pack()
  const output = collectBrowserStream(archive)
  for (const file of files) {
    tree.update(file.path)
    tree.update('\0')
    tree.update(file.content)
    tree.update('\0')
    await new Promise((resolve, reject) => {
      archive.entry({
        name: file.path,
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        uname: '',
        gname: '',
        mtime: new Date(0),
      }, file.content, error => error === null ? resolve() : reject(error))
    })
  }
  archive.finalize()
  const content = gzipSync(await output, { level: 9 })
  return {
    content,
    files,
    totalBytes: files.reduce((total, file) => total + file.content.byteLength, 0),
    treeHash: tree.digest('hex'),
    artifactDigest: sha256(content),
  }
}

function compareBundlePaths(left, right) {
  const leftParts = left.split('/')
  const rightParts = right.split('/')
  const length = Math.min(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const order = leftParts[index].localeCompare(rightParts[index])
    if (order !== 0) return order
  }
  return leftParts.length - rightParts.length
}

async function collectBrowserStream(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function evaluatorUsage(inputTokens, cacheReadTokens) {
  return {
    inputTokens,
    outputTokens: 20,
    cacheReadTokens,
    cacheWriteTokens: 5,
    reasoningTokens: 10,
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function writeFixtureJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

/**
 * Drive the installed Host's native catalog + failed Skill observation path.
 * This test-only seed emits the same Cordis tool-result event consumed by the
 * production monitor; it never writes a Gap store or governance manifest.
 */
async function seedNativeCapabilityGaps(ctx, workspace, agent, agentEvents, config, handles) {
  const workspaceId = String(workspace.id)
  const sessionId = String(agent.session.id)
  const existing = await overview(ctx, workspaceId, sessionId)
  if (existing?.skillOpportunities?.items.some(item =>
    item.skillName === 'publish-dsh-plugin' && item.goalCount >= 4)) return

  const persistedIds = new Set((await ctx.sessionPersistence.list()).map(header => String(header.id)))
  for (let index = 1; index <= 4; index += 1) {
    const goalId = `goal-evoforge-browser-gap-${index}`
    const current = await overview(ctx, workspaceId, sessionId)
    if (current?.capabilityGaps?.items.some(item => item.goal?.id === goalId)) continue
    const gapSessionId = `evoforge-browser-gap-session-${index}`
    let gapAgent = ctx.agents.get(gapSessionId)
    if (gapAgent === undefined) {
      const common = {
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, config.agentPreset).then(() => undefined),
      }
      const gapHandle = persistedIds.has(gapSessionId)
        ? await ctx.agents.resume({ resumeSessionId: gapSessionId, ...common })
        : await ctx.agents.create({
            sessionId: gapSessionId,
            meta: { cwd: workspace.path, agentPreset: config.agentPreset },
            ...common,
          })
      handles.push(gapHandle)
      gapAgent = gapHandle.agent
    }
    await workspace.attachSession(gapAgent.session.id)
    await agentEvents(ctx, gapAgent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter', messages: [] }),
    )
    await waitFor(ctx, workspaceId, String(gapAgent.session.id),
      value => value.capabilityMap?.status === 'complete',
      `real browser fixture did not observe a complete DSH Skill catalog for ${gapSessionId}`)
    const session = gapAgent.session
    const objective = `Complete internal DSH capability-gap acceptance ${index}.`
    if (!session.events.some(event => event.type === 'goal/change' && event.data.goal?.id === goalId)) {
      const time = Math.max(Date.now(), (session.events.at(-1)?.time ?? 0) + 100)
      appendAt(session, time, 'goal/change', {
        kind: 'goal/change',
        version: 1,
        operation: 'create',
        goal: {
          id: goalId,
          revision: 1,
          objective,
          phase: 'active',
          maxGoalRounds: 2,
        },
        roundsStarted: 0,
        createdAt: time,
        updatedAt: time,
      })
    }
    await waitForCurrentGoal(ctx, gapAgent, goalId)
    const callId = `evoforge-browser-missing-skill-${index}`
    ctx.emit('tools/result', {
      callId,
      rootCallId: callId,
      name: 'skill',
      arguments: { name: 'publish-dsh-plugin' },
      agent: gapAgent,
      signal: new AbortController().signal,
      token: Symbol(callId),
    }, {
      isError: true,
      error: { message: 'test-owned missing native DSH Skill' },
      content: [],
    })
    await waitFor(ctx, workspaceId, String(gapAgent.session.id),
      value => value.capabilityGaps?.items.some(item => item.goal?.id === goalId) === true,
      `real browser fixture did not persist Capability Gap ${index}`)
    await ctx.sessions.flush(session)
  }
  await waitFor(ctx, workspaceId, sessionId, value => {
    const opportunity = value.skillOpportunities?.items.find(item =>
      item.skillName === 'publish-dsh-plugin')
    const readiness = opportunity?.evaluationReadiness
    return readiness?.status === 'ready-to-seal'
      && value.skillCandidates?.items.length === 0
  }, 'real browser fixture did not project ready-to-seal evidence without a Candidate')
}

async function waitForCurrentGoal(ctx, agent, goalId) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      if (ctx.get('goals')?.get(agent)?.id === goalId) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`real browser fixture did not activate native Goal ${goalId}`)
}

/**
 * Execute one real native DSH Skill Tool in two Goal-owned Sessions. The
 * fixture writes only native Session events; the installed Host owns the
 * durable exact-use projection and cross-Goal aggregation.
 */
async function seedNativeSkillReuse(ctx, workspace, config, handles) {
  const workspaceId = String(workspace.id)
  const current = await overview(ctx, workspaceId, config.sessionId)
  const exactContextReady = current?.skillOutcomeContext?.items.some(item =>
    item.skillName === 'reuse-dsh-evidence'
      && item.goalContextCount === 2
      && item.outcomeObservedGoalContextCount === 2
      && item.outcomeAttemptCount === 3
      && item.repeatedOutcomeGoalContextCount === 1
      && item.recoveredGoalContextCount === 1
      && item.metrics.measured === 2) === true
  if ((current?.skillReuse?.all.crossGoalSkillVersionCount ?? 0) > 0 && exactContextReady) return

  const persistedIds = new Set((await ctx.sessionPersistence.list()).map(header => String(header.id)))
  for (let index = 1; index <= 2; index += 1) {
    const sessionId = `evoforge-browser-skill-reuse-${index}`
    let useAgent = ctx.agents.get(sessionId)
    if (useAgent === undefined) {
      const common = {
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, config.agentPreset).then(() => undefined),
      }
      const handle = persistedIds.has(sessionId)
        ? await ctx.agents.resume({ resumeSessionId: sessionId, ...common })
        : await ctx.agents.create({
            sessionId,
            meta: { cwd: workspace.path, agentPreset: config.agentPreset },
            ...common,
          })
      handles.push(handle)
      useAgent = handle.agent
    }
    await workspace.attachSession(useAgent.session.id)
    const skills = useAgent.ctx.get('skills')
    if (skills === undefined) throw new Error('real browser fixture has no Agent-scoped Skill registry')
    skills.register({
      name: 'reuse-dsh-evidence',
      description: 'Verify durable cross-Goal Skill reuse evidence.',
      source: 'browser-test-owned',
      content: 'Use the same exact native Skill content in independent DSH Goals.',
    })
    const { agentEvents } = await import(pathToFileURL(config.agentEntry).href)
    await agentEvents(ctx, useAgent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter', messages: [] }),
    )

    const session = useAgent.session
    const callId = `evoforge-browser-skill-reuse-call-${index}`
    const goalId = `goal-evoforge-browser-skill-reuse-${index}`
    if (!session.events.some(event => event.type === 'tool/call' && event.data.callId === callId)) {
      const base = Math.max(Date.now(), (session.events.at(-1)?.time ?? 0) + 100)
      appendAt(session, base, 'goal/change', {
        kind: 'goal/change',
        version: 1,
        operation: 'create',
        goal: {
          id: goalId,
          revision: 1,
          objective: `Verify exact Skill reuse evidence ${index}.`,
          phase: 'active',
          maxGoalRounds: 2,
        },
        roundsStarted: 0,
        createdAt: base,
        updatedAt: base,
      })
      appendAt(session, base + 1, 'turn/start', { turn: 1 })
      appendAt(session, base + 2, 'step/start', { turn: 1, step: 1 })
      appendAt(session, base + 3, 'user/message', message({
        role: 'user',
        content: [{ type: 'text', text: `Use the exact Skill and verify delivery ${index}.` }],
        source: { kind: 'goal', goalId, revision: 1, round: 1 },
      }), { surfaceOp: 'append' })
      const firstToken = appendAt(session, base + 4, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'Using exact Skill.' },
      })
      const usage = {
        inputTokens: 20 + index,
        outputTokens: 4 + index,
        cacheReadTokens: 30 + index,
        cacheWriteTokens: 2 + index,
      }
      const usageChunk = appendAt(session, base + 5, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'usage', usage },
      })
      appendAt(session, base + 6, 'assistant/message', {
        turn: 1,
        step: 1,
        message: message({
          role: 'assistant',
          content: [{ type: 'text', text: 'Using exact Skill.' }],
          source: { kind: 'model', provider: 'browser-fixture', model: 'browser-fixture' },
        }),
        usage,
      }, { surfaceOp: 'append', sourceEventSeqs: [firstToken.seq, usageChunk.seq] })
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId,
        name: 'skill',
        arguments: { name: 'reuse-dsh-evidence' },
        agent: useAgent,
      })
      if (result.isError) throw new Error('real browser fixture native Skill Tool failed')
      const call = appendAt(session, base + 10, 'tool/call', {
        turn: 1,
        step: 1,
        callId,
        name: 'skill',
        arguments: '{"name":"reuse-dsh-evidence"}',
      })
      appendAt(session, base + 20, 'tool/result', {
        turn: 1,
        step: 1,
        message: message({
          role: 'user',
          source: { kind: 'tool', callId },
          content: [{
            type: 'tool-result',
            toolCallId: callId,
            content: result.content,
            isError: false,
          }],
        }),
      }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
      await ctx.sessions.flush(session)
    }

    const passedCallId = `evoforge-browser-skill-outcome-passed-${index}`
    if (!session.events.some(event => event.type === 'tool/call' && event.data.callId === passedCallId)) {
      const base = Math.max(Date.now(), (session.events.at(-1)?.time ?? 0) + 100)
      let offset = 0
      if (index === 1) {
        const failedCallId = 'evoforge-browser-skill-outcome-failed-1'
        const failedCall = appendAt(session, base, 'tool/call', {
          turn: 1,
          step: 1,
          callId: failedCallId,
          name: 'complete_delivery',
          arguments: '{}',
        })
        appendAt(session, base + 10, 'tool/result', {
          turn: 1,
          step: 1,
          message: deliveryResultMessage(failedCallId, goalId, 1, 'failed'),
        }, { surfaceOp: 'append', sourceEventSeqs: [failedCall.seq] })
        offset = 20
      }
      appendAt(session, base + offset, 'goal/change', {
        kind: 'goal/change',
        version: 1,
        operation: 'complete',
        goal: {
          id: goalId,
          revision: 2,
          objective: `Verify exact Skill reuse evidence ${index}.`,
          phase: 'complete',
          maxGoalRounds: 2,
        },
        roundsStarted: 1,
        createdAt: base,
        updatedAt: base + offset,
      })
      const passedCall = appendAt(session, base + offset + 10, 'tool/call', {
        turn: 1,
        step: 1,
        callId: passedCallId,
        name: 'complete_delivery',
        arguments: '{}',
      })
      appendAt(session, base + offset + 20, 'tool/result', {
        turn: 1,
        step: 1,
        message: deliveryResultMessage(passedCallId, goalId, 2, 'passed'),
      }, { surfaceOp: 'append', sourceEventSeqs: [passedCall.seq] })
      appendAt(session, base + offset + 30, 'step/end', { turn: 1, step: 1 })
      appendAt(session, base + offset + 40, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
      await ctx.sessions.flush(session)
    }
  }

  await waitFor(ctx, workspaceId, config.sessionId, value =>
    value.skillReuse?.items.some(item =>
      item.skillName === 'reuse-dsh-evidence'
        && item.goalCount === 2
        && item.status === 'cross-goal-observed') === true,
  'real browser fixture did not expose exact cross-Goal Skill reuse')
  await waitFor(ctx, workspaceId, config.sessionId, value =>
    value.skillOutcomeContext?.items.some(item =>
      item.skillName === 'reuse-dsh-evidence'
        && item.goalContextCount === 2
        && item.outcomeObservedGoalContextCount === 2
        && item.outcomeAttemptCount === 3
        && item.repeatedOutcomeGoalContextCount === 1
        && item.recoveredGoalContextCount === 1
        && item.latest.passed === 2
        && item.metrics.measured === 2) === true,
  'real browser fixture did not expose exact later Delivery Outcome context')
}

function deliveryResultMessage(callId, goalId, revision, status) {
  return message({
    role: 'user',
    source: { kind: 'tool', callId },
    content: [{
      type: 'tool-result',
      toolCallId: callId,
      content: [{
        type: 'text',
        text: JSON.stringify({
          schemaVersion: 1,
          status,
          reason: status === 'passed'
            ? 'browser test-owned delivery recovered and passed'
            : 'browser test-owned first delivery attempt failed',
          goal: { id: goalId, revision, phase: status === 'passed' ? 'complete' : 'active' },
        }),
      }],
      isError: false,
    }],
  })
}

async function overview(ctx, workspaceId, sessionId) {
  return ctx.get('evoforge.evolutionControl')?.overview(workspaceId, sessionId)
}

async function waitFor(ctx, workspaceId, sessionId, predicate, message) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const value = await overview(ctx, workspaceId, sessionId)
    if (value !== undefined && predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(message)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Commit one deterministic, test-owned native Session sequence so the real
 * browser acceptance covers DSH projection -> evolve Host -> Typert -> Web.
 * The sequence is idempotent across Host restart and never ships in the Bundle.
 */
async function seedNativeGoalMetrics(ctx, workspace, agent) {
  const session = agent.session
  const callId = 'evoforge-browser-goal-metrics'
  if (session.events.some(event => event.type === 'tool/call' && event.data.callId === callId)) {
    await waitForMeasuredOutcome(ctx, String(workspace.id), String(session.id))
    return
  }

  const goalId = 'goal-evoforge-browser-metrics'
  const lastEventTime = session.events.at(-1)?.time ?? 0
  const base = Math.max(Date.now(), lastEventTime + 100)
  appendAt(session, base, 'goal/change', {
    kind: 'goal/change',
    version: 1,
    operation: 'create',
    goal: {
      id: goalId,
      revision: 1,
      objective: 'Verify exact native DSH Goal execution metrics in the real Web control plane.',
      phase: 'active',
      maxGoalRounds: 8,
    },
    roundsStarted: 0,
    createdAt: base,
    updatedAt: base,
  })
  appendAt(session, base + 100, 'turn/start', { turn: 1 })
  appendAt(session, base + 110, 'step/start', { turn: 1, step: 1 })
  appendAt(session, base + 115, 'user/message', message({
    role: 'user',
    content: [{ type: 'text', text: 'Produce one verified delivery outcome.' }],
    source: { kind: 'goal', goalId, revision: 1, round: 1 },
  }), { surfaceOp: 'append' })
  const firstToken = appendAt(session, base + 130, 'assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: { type: 'text-delta', index: 0, text: 'Verified.' },
  })
  const usage = {
    inputTokens: 40,
    outputTokens: 8,
    cacheReadTokens: 30,
    cacheWriteTokens: 5,
  }
  const usageChunk = appendAt(session, base + 170, 'assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: { type: 'usage', usage },
  })
  appendAt(session, base + 200, 'assistant/message', {
    turn: 1,
    step: 1,
    message: message({
      role: 'assistant',
      content: [{ type: 'text', text: 'Verified.' }],
      source: { kind: 'model', provider: 'browser-fixture', model: 'browser-fixture' },
    }),
    usage,
  }, { surfaceOp: 'append', sourceEventSeqs: [firstToken.seq, usageChunk.seq] })
  const call = appendAt(session, base + 210, 'tool/call', {
    turn: 1,
    step: 1,
    callId,
    name: 'complete_delivery',
    arguments: '{}',
  })
  appendAt(session, base + 229, 'goal/change', {
    kind: 'goal/change',
    version: 1,
    operation: 'complete',
    goal: {
      id: goalId,
      revision: 2,
      objective: 'Verify exact native DSH Goal execution metrics in the real Web control plane.',
      phase: 'complete',
      maxGoalRounds: 8,
    },
    roundsStarted: 1,
    createdAt: base,
    updatedAt: base + 229,
  })
  appendAt(session, base + 230, 'tool/result', {
    turn: 1,
    step: 1,
    message: message({
      role: 'user',
      source: { kind: 'tool', callId },
      content: [{
        type: 'tool-result',
        toolCallId: callId,
        content: [{
          type: 'text',
          text: JSON.stringify({
            schemaVersion: 1,
            status: 'passed',
            reason: 'real DSH browser projection verified',
            goal: { id: goalId, revision: 2, phase: 'complete' },
            artifact: { commit: 'b'.repeat(40) },
          }),
        }],
        isError: false,
      }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  appendAt(session, base + 240, 'step/end', { turn: 1, step: 1 })
  appendAt(session, base + 250, 'turn/end', { turn: 1, reason: { kind: 'completed' } })

  await ctx.sessions.flush(session)
  await waitForMeasuredOutcome(ctx, String(workspace.id), String(session.id))
}

function message(input) {
  return Object.freeze({ id: crypto.randomUUID(), ...input })
}

function appendAt(session, time, type, data, options) {
  const realNow = Date.now
  Date.now = () => time
  try {
    return session.append(type, data, options)
  } finally {
    Date.now = realNow
  }
}

async function waitForMeasuredOutcome(ctx, workspaceId, sessionId) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const control = ctx.get('evoforge.evolutionControl')
    const overview = await control?.overview(workspaceId, sessionId)
    if ((overview?.deliveryOutcomes?.metrics.all.measured ?? 0) > 0) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('real browser fixture did not project a measured native DSH delivery outcome')
}
