import { createHash, randomUUID } from 'node:crypto'
import { mkdir, realpath, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { pack } from '../../../dsh-evolve/node_modules/tar-stream/index.js'

export const name = 'evoforge-browser-workspace-bootstrap'
export const inject = [
  'agents',
  'agentPresets',
  'sessions',
  'sessionPersistence',
  'storageDomain',
  'workspaceRegistry',
]

/** Browser-only fixture: DSH creates and owns the Workspace, Session, and Agent. */
export async function apply(ctx, config) {
  await mkdir(config.runRoot, { recursive: true })
  const evolvePlugin = await import(pathToFileURL(config.evolveEntry).href)
  const workspace = await ctx.workspaceRegistry.create(config.workspacePath, 'EvoForge Browser Acceptance')
  const configureEvaluation = config.seedCapabilityGaps === true
    || config.seedExistingSkillHoldoutEvaluation === true
    || config.seedExistingSkillRetentionEvaluation === true
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
  if (config.seedSkillEvaluationRuns === true) {
    await seedExactSkillEvaluationRuns(ctx, workspace, config)
  }
  if (config.seedExistingSkillHoldoutEvaluation === true) {
    await seedExistingSkillHoldoutEvaluation(workspace, config)
  }
  if (config.seedExistingSkillRetentionEvaluation === true) {
    await seedExistingSkillRetentionEvaluation(workspace, config)
  }
  if (config.seedGoalMetrics === true) {
    await seedNativeGoalMetrics(ctx, workspace, agent)
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
    for (const capabilityHandle of capabilityHandles.reverse()) await capabilityHandle.dispose()
    await evolutionFiber.dispose()
    await handle?.dispose()
  }, 'evoforge-browser-workspace-bootstrap.dispose')
}

/** Seed one exact durable result for the production existing-Skill scanner. */
async function seedExistingSkillHoldoutEvaluation(workspace, config) {
  const workspaceId = String(workspace.id)
  const policyId = 'browser-evaluation-governance'
  const candidateId = '4'.repeat(64)
  const admissionId = '5'.repeat(64)
  const envelopeId = '6'.repeat(64)
  const opportunityId = '7'.repeat(64)
  const qualificationId = '8'.repeat(64)
  const baselineId = '9'.repeat(64)
  const baselineTreeHash = 'a'.repeat(64)
  const candidateTreeHash = 'b'.repeat(64)
  const casePackHash = 'c'.repeat(64)
  const dshRevision = '47f943859bef60e4160492346772ded9b24f765a'
  const skillName = 'verify-dsh-release'
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
}

/** Seed one exact durable V4.41 Retention result for the production scanner. */
async function seedExistingSkillRetentionEvaluation(workspace, config) {
  const workspaceId = String(workspace.id)
  const policyId = 'browser-evaluation-governance'
  const candidateId = '4'.repeat(64)
  const admissionId = '5'.repeat(64)
  const envelopeId = '6'.repeat(64)
  const opportunityId = '7'.repeat(64)
  const qualificationId = '8'.repeat(64)
  const baselineId = '9'.repeat(64)
  const baselineTreeHash = 'a'.repeat(64)
  const candidateTreeHash = 'b'.repeat(64)
  const holdoutCasePackHash = 'c'.repeat(64)
  const casePackHash = 'd'.repeat(64)
  const dshRevision = '47f943859bef60e4160492346772ded9b24f765a'
  const skillName = 'verify-dsh-release'
  const holdoutEvaluationId = sha256(JSON.stringify([
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
  let inactive = before.reviews.inactiveGenerations.find(item => item.reviewId === reviewId)
  if (inactive === undefined) {
    await control.approveReview(workspaceId, reviewId,
      'Deterministic browser fixture: publish exact inactive Generation.')
    const after = await control.overview(workspaceId)
    inactive = after.reviews.inactiveGenerations.find(item => item.reviewId === reviewId)
  }
  if (inactive === undefined) {
    throw new Error('real browser fixture did not publish an inactive Generation')
  }
  const expectedPromotionStatus = retentionStatus === 'retained' ? 'eligible' : 'blocked'
  const expectedPromotionReason = retentionStatus === 'retained'
    ? 'exact-retention-retained'
    : 'retention-regressed'
  if (inactive.promotion.status !== expectedPromotionStatus
    || inactive.promotion.reason !== expectedPromotionReason
    || inactive.promotion.retentionId !== retentionId) {
    throw new Error(`real browser fixture did not project exact ${retentionStatus} promotion eligibility`)
  }
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
