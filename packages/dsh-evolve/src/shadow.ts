import { lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { hashTree, sha256 } from './hash.ts'
import {
  acquireShadowRunLock,
  assertShadowRunIdentity,
  loadShadowRunState,
  saveShadowRunState,
  writeDurableJson,
  type ShadowRunIdentity,
  type ShadowRunState,
} from './shadow-run-state.ts'
import {
  runCalibrationTrial,
  runComparisonTrial,
  runPairedTrial,
  type CalibrationTrialResult,
  type PairedTrialResult,
  type TrialBaselineKind,
} from './trial.ts'
import {
  parseSkillCandidateLineage,
  type SkillCandidateLineage,
} from './skill-candidate-lineage.ts'

export interface ShadowOptions {
  baselineKind?: TrialBaselineKind
  baselineSkillName?: string
  casePackDir: string
  exactCandidate: {
    claim: string
    lineage?: SkillCandidateLineage
    skillDir: string
  }
  expectedCasePackHash?: string
  outputDir: string
  resume?: boolean
  signal?: AbortSignal
  skillDir: string
}

export interface CasePackManifest {
  schemaVersion: 1
  id: string
  workspaceId: string
  epoch: {
    dshRevision: string
    evaluatorVersion: string
  }
  budget: {
    candidateLimit: number
    trialLimit: number
    inputTokenLimit: number
    outputTokenLimit: number
  }
  evidence: {
    rationale: 'evidence/rationale.md'
  }
  trial?: {
    evaluator: string
    timeoutMs: number
    outputLimitBytes: number
    dshAssembled?: boolean
    dshProfileInstall?: boolean
    capabilityAbsentBaseline?: boolean
  }
  calibration?: {
    knownBad: string
    knownCorrection: string
  }
}

interface Proposal {
  claim: string
  files: Array<{ path: string; content: string }>
}

export async function runShadow(options: ShadowOptions): Promise<
  | { status: 'complete'; reportPath: string; summary: string }
  | { status: 'incomplete'; reportPath: string; reason: string }
> {
  options.signal?.throwIfAborted()
  const baselineKind = options.baselineKind ?? 'skill-tree'
  const skillDir = await realpath(options.skillDir)
  const casePackDir = await realpath(options.casePackDir)
  const exactCandidateDir = await realpath(options.exactCandidate.skillDir)
  const requestedOutputDir = resolve(options.outputDir)
  const outputDir = resolve(await realpath(dirname(requestedOutputDir)), basename(requestedOutputDir))
  assertSeparateOutput(outputDir, skillDir, casePackDir, exactCandidateDir)
  assertSeparateTrees(exactCandidateDir, skillDir, 'exact Candidate', 'baseline Skill')
  assertSeparateTrees(exactCandidateDir, casePackDir, 'exact Candidate', 'Case Pack')

  const manifest = parseCasePackManifest(await readFile(resolve(casePackDir, 'manifest.json'), 'utf8'))
  if (manifest.trial?.dshAssembled !== true) {
    throw new Error('exact Candidate Shadow requires an assembled DSH Trial')
  }
  if (baselineKind === 'capability-absent') {
    if (!isPublicSkillName(options.baselineSkillName)) {
      throw new Error('capability-absent Shadow requires an exact Skill name')
    }
    if (manifest.trial?.capabilityAbsentBaseline !== true) {
      throw new Error('capability-absent Shadow evaluator does not declare protocol support')
    }
  } else if (options.baselineSkillName !== undefined) {
    throw new Error('baseline Skill name is only valid for a capability-absent Shadow')
  }
  const skillSource = await readFile(resolve(
    baselineKind === 'capability-absent' ? exactCandidateDir : skillDir,
    'SKILL.md',
  ), 'utf8')
  const skillName = parseSkillName(skillSource)
  if (baselineKind === 'capability-absent' && skillName !== options.baselineSkillName) {
    throw new Error('capability-absent Shadow Candidate does not match the missing Skill name')
  }
  const baseTreeHash = await hashTree(skillDir)
  const casePackHash = await hashTree(casePackDir)
  if (options.expectedCasePackHash !== undefined && casePackHash !== options.expectedCasePackHash) {
    throw new Error('Shadow Case Pack does not match the expected qualified hash')
  }
  const exactCandidateTreeHash = await hashTree(exactCandidateDir)
  const skillCandidateLineage = options.exactCandidate.lineage === undefined
    ? undefined
    : parseSkillCandidateLineage(options.exactCandidate.lineage)
  if (skillCandidateLineage !== undefined
    && (skillCandidateLineage.workspaceId !== manifest.workspaceId
      || skillCandidateLineage.skillName !== skillName
      || skillCandidateLineage.candidateTreeHash !== exactCandidateTreeHash)) {
    throw new Error('Skill Candidate lineage does not match the exact Shadow inputs')
  }
  const exactProposal = await proposalFromExactCandidate(
    skillDir,
    exactCandidateDir,
    normalizeExactClaim(options.exactCandidate.claim),
    baselineKind,
  )
  const modelRoute = 'pinned-internal-candidate-v1'
  const modelConfigHash = sha256(JSON.stringify({
    candidateTreeHash: exactCandidateTreeHash,
    claim: exactProposal.claim,
    model: modelRoute,
  }))
  const baselineFingerprint = sha256(
    JSON.stringify({ baselineKind, baseTreeHash, casePackHash, modelConfigHash }),
  )
  let startedAt = new Date().toISOString()

  const identity: ShadowRunIdentity = {
    workspaceId: manifest.workspaceId,
    baseTreeHash,
    casePackHash,
    dshRevision: manifest.epoch.dshRevision,
    evaluatorVersion: manifest.epoch.evaluatorVersion,
    modelConfigHash,
    modelRoute,
    skillName,
    ...(baselineKind === 'skill-tree' ? {} : { baselineKind }),
    ...(skillCandidateLineage === undefined ? {} : { skillCandidateLineage }),
  }
  const resumeInputs = {
    skillDir,
    casePackDir,
    ...(baselineKind === 'skill-tree' ? {} : {
      baselineKind,
      baselineSkillName: options.baselineSkillName!,
    }),
    candidateSkillDir: exactCandidateDir,
  }
  const runId = sha256(JSON.stringify(identity))
  if (options.resume === true) {
    const actualOutputDir = await realpath(outputDir)
    if (actualOutputDir !== outputDir) throw new Error('Shadow resume output path is not exact')
  } else {
    await mkdir(outputDir)
    await mkdir(resolve(outputDir, 'evidence'))
  }
  const releaseRunLock = await acquireShadowRunLock(outputDir)
  try {
    let state: ShadowRunState
    if (options.resume === true) {
      state = await loadShadowRunState(outputDir)
      startedAt = state.startedAt
      assertShadowRunIdentity(state.identity, identity)
      if (state.runId !== runId) throw new Error('Shadow resume run id does not match its inputs')
      if (state.resumeInputs !== undefined
        && JSON.stringify(state.resumeInputs) !== JSON.stringify(resumeInputs)) {
        throw new Error('Shadow resume paths do not match the durable run inputs')
      }
      if (state.outcome?.kind === 'complete') {
        await assertTerminalReport(outputDir, state.outcome.reportPath)
        return {
          status: 'complete',
          reportPath: state.outcome.reportPath,
          summary: state.outcome.summary,
        }
      }
      if (state.outcome?.kind === 'incomplete') {
        await assertTerminalReport(outputDir, state.outcome.reportPath)
        return {
          status: 'incomplete',
          reportPath: state.outcome.reportPath,
          reason: state.outcome.reason,
        }
      }
    } else {
      state = {
        schemaVersion: 1,
        runId,
        phase: 'prepared',
        startedAt,
        updatedAt: startedAt,
        identity,
        resumeInputs,
      }
      await saveShadowRunState(outputDir, state)
    }

    const updateState = async (patch: Partial<ShadowRunState>): Promise<void> => {
      state = { ...state, ...patch, updatedAt: new Date().toISOString() }
      await saveShadowRunState(outputDir, state)
    }
    if (state.resumeInputs === undefined) {
      await updateState({ resumeInputs })
    }
    const finishIncomplete = async (reportPath: string, reason: string) => {
      await updateState({
        phase: 'incomplete',
        outcome: { kind: 'incomplete', reportPath, reason },
      })
      return { status: 'incomplete' as const, reportPath, reason }
    }
    const finishComplete = async (reportPath: string, summary: string) => {
      await updateState({
        phase: 'complete',
        outcome: { kind: 'complete', reportPath, summary },
      })
      return { status: 'complete' as const, reportPath, summary }
    }

    const finishBeforeProposalIncomplete = async (
      reason: string,
      calibration: PairedTrialResult['calibration'] = [],
      finalCasePackHash = casePackHash,
    ) => {
      const finalTreeHash = await hashTree(skillDir)
      const reportPath = resolve(outputDir, 'report.json')
      await writeJson(reportPath, {
        schemaVersion: 1,
        run: {
          id: runId,
          status: 'incomplete',
          startedAt,
          finishedAt: new Date().toISOString(),
        },
        subject: {
          skillName,
          baselineKind,
          baseTreeHash,
          finalTreeHash,
          unchanged: finalTreeHash === baseTreeHash,
        },
        epoch: {
          dshRevision: manifest.epoch.dshRevision,
          modelRoute,
          modelConfigHash,
          evaluatorVersion: manifest.epoch.evaluatorVersion,
          casePackHash,
          casePackFinalHash: finalCasePackHash,
          casePackUnchanged: finalCasePackHash === casePackHash,
        },
        calibration,
        cases: [],
        composition: {
          baselineFingerprint,
          candidateFingerprint: baselineFingerprint,
          allowedDifference: [],
        },
        budget: {
          candidateLimit: manifest.budget.candidateLimit,
          trialLimit: manifest.budget.trialLimit,
          inputTokens: 0,
          outputTokens: 0,
        },
        ...(skillCandidateLineage === undefined ? {} : { lineage: skillCandidateLineage }),
      })
      return finishIncomplete(reportPath, reason)
    }

    let preflightCalibration: CalibrationTrialResult | undefined
    if (state.phase === 'prepared'
      && manifest.trial !== undefined
      && manifest.calibration !== undefined) {
      if (manifest.budget.trialLimit < 4) {
        return finishBeforeProposalIncomplete(
          `case pack trial budget is ${manifest.budget.trialLimit}; paired calibration requires 4`,
        )
      }
      try {
        preflightCalibration = await runCalibrationTrial({
          calibration: manifest.calibration,
          casePackDir,
          dshRevision: manifest.epoch.dshRevision,
          outputDir,
          ...options.signal === undefined ? {} : { signal: options.signal },
          trial: manifest.trial,
          trialLimit: manifest.budget.trialLimit,
        })
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason
        const reason = error instanceof Error ? error.message : String(error)
        return finishBeforeProposalIncomplete(reason)
      }
      const finalCasePackHash = await hashTree(casePackDir)
      if (finalCasePackHash !== casePackHash) {
        return finishBeforeProposalIncomplete(
          'case pack changed during pre-proposal calibration',
          preflightCalibration.calibration,
          finalCasePackHash,
        )
      }
      if (preflightCalibration.calibration.some(result => !result.passed)) {
        return finishBeforeProposalIncomplete(
          'case pack calibration failed before proposal',
          preflightCalibration.calibration,
        )
      }
    }

    let proposal: Proposal
    try {
      if (state.phase !== 'prepared') {
        if (state.proposal === undefined
          || state.proposalHash === undefined
          || state.modelUsage === undefined) {
          throw new Error('durable Candidate checkpoint is incomplete; refusing proposal retry')
        }
        proposal = parsePersistedProposal(state.proposal)
        if (state.proposalHash !== sha256(JSON.stringify(proposal))) {
          throw new Error('durable Candidate does not match its recorded hash')
        }
        if (state.modelUsage.inputTokens !== 0 || state.modelUsage.outputTokens !== 0) {
          throw new Error('exact Candidate checkpoint contains forbidden Shadow model usage')
        }
      } else {
        proposal = structuredClone(exactProposal)
        if (await hashTree(exactCandidateDir) !== exactCandidateTreeHash) {
          throw new Error('exact Candidate changed while its proposal was derived')
        }
        await updateState({
          phase: 'candidate-ready',
          proposal,
          proposalHash: sha256(JSON.stringify(proposal)),
          modelUsage: { inputTokens: 0, outputTokens: 0 },
        })
      }
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason
      const reason = error instanceof Error ? error.message : String(error)
      const finalTreeHash = await hashTree(skillDir)
      const reportPath = resolve(outputDir, 'report.json')
      await writeJson(reportPath, {
        schemaVersion: 1,
        run: {
          id: runId,
          status: 'incomplete',
          startedAt,
          finishedAt: new Date().toISOString(),
        },
        subject: {
          skillName,
          baselineKind,
          baseTreeHash,
          finalTreeHash,
          unchanged: finalTreeHash === baseTreeHash,
        },
        epoch: {
          dshRevision: manifest.epoch.dshRevision,
          modelRoute,
          modelConfigHash,
          evaluatorVersion: manifest.epoch.evaluatorVersion,
          casePackHash,
        },
        calibration: [],
        cases: [],
        composition: {
          baselineFingerprint,
          candidateFingerprint: baselineFingerprint,
          allowedDifference: [],
        },
        budget: {
          candidateLimit: manifest.budget.candidateLimit,
          trialLimit: manifest.budget.trialLimit,
          inputTokens: 0,
          outputTokens: 0,
        },
        ...(skillCandidateLineage === undefined ? {} : { lineage: skillCandidateLineage }),
      })
      return finishIncomplete(reportPath, reason)
    }
    const changedFiles = proposal.files.map((file) => file.path)
    const unsafePaths = changedFiles.filter((path) => !isOwnedRelativePath(path))
    const proposalEvidence = {
      claim: proposal.claim,
      files: proposal.files.map((file) => ({
        path: file.path,
        contentHash: sha256(file.content),
        byteLength: Buffer.byteLength(file.content),
      })),
      modelRoute,
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    }
    await writeJson(resolve(outputDir, 'evidence', 'proposal.json'), proposalEvidence)

    const finalTreeHash = await hashTree(skillDir)
    const activeSkillUnchanged = finalTreeHash === baseTreeHash

    const candidateTreeHash = sha256(JSON.stringify(proposal))
    const reportBase = {
      schemaVersion: 1,
      run: {
        id: runId,
        status: activeSkillUnchanged && unsafePaths.length > 0 ? 'complete' : 'incomplete',
        startedAt,
        finishedAt: new Date().toISOString(),
      },
      subject: {
        skillName,
        baselineKind,
        baseTreeHash,
        finalTreeHash,
        unchanged: activeSkillUnchanged,
      },
      epoch: {
        dshRevision: manifest.epoch.dshRevision,
        modelRoute,
        modelConfigHash,
        evaluatorVersion: manifest.epoch.evaluatorVersion,
        casePackHash,
      },
      candidate: {
        id: candidateTreeHash.slice(0, 16),
        treeHash: candidateTreeHash,
        parentTreeHash: baseTreeHash,
        parentKind: baselineKind,
        claim: proposal.claim,
        changedFiles,
      },
      calibration: [],
      cases: [
        {
          id: manifest.id,
          partition: 'structural-admission',
          baseline: 'pass',
          candidate: activeSkillUnchanged && unsafePaths.length > 0 ? 'fail' : 'incomplete',
          checks: [
            {
              name: 'owned-path',
              passed: unsafePaths.length === 0,
              evidenceRef: 'evidence/proposal.json',
            },
            ...activeSkillUnchanged
              ? []
              : [{
                  name: 'active-skill-unchanged',
                  passed: false,
                  evidenceRef: 'report.json#subject',
                }],
          ],
        },
      ],
      composition: {
        baselineFingerprint,
        candidateFingerprint: sha256(`${baselineFingerprint}:${candidateTreeHash}`),
        allowedDifference: baselineKind === 'capability-absent'
          ? ['skill.presence', 'skill.body']
          : ['skill.body'],
      },
      budget: {
        candidateLimit: manifest.budget.candidateLimit,
        trialLimit: manifest.budget.trialLimit,
        inputTokens: 0,
        outputTokens: 0,
      },
      ...(skillCandidateLineage === undefined ? {} : { lineage: skillCandidateLineage }),
    } as const
    const reportPath = resolve(outputDir, 'report.json')
    if (!activeSkillUnchanged) {
      const reason = 'active Skill changed during shadow evaluation'
      await writeJson(reportPath, reportBase)
      return finishIncomplete(reportPath, reason)
    }
    if (unsafePaths.length > 0) {
      const reason = 'candidate attempted to change a non-owned path'
      await writeJson(reportPath, {
        ...reportBase,
        decision: {
          recommendation: 'reject',
          reasons: [reason],
          limitations: ['P0A.1 evaluates the owned-path hard gate only'],
        },
      })
      return finishComplete(reportPath, `reject: ${reason}; report: ${reportPath}`)
    }
    const identityGate = checkCandidateSkillIdentity(proposal, skillName)
    if (!identityGate.passed) {
      await writeJson(reportPath, {
        ...reportBase,
        run: { ...reportBase.run, status: 'complete' },
        cases: [{
          id: manifest.id,
          partition: 'structural-admission',
          baseline: 'pass',
          candidate: 'fail',
          checks: [{
            name: 'skill-name-stable',
            passed: false,
            evidenceRef: 'evidence/proposal.json',
          }],
        }],
        decision: {
          recommendation: 'reject',
          reasons: [identityGate.reason],
          limitations: ['Candidate identity hard gate failed before Trial'],
        },
      })
      return finishComplete(
        reportPath,
        `reject: ${identityGate.reason}; report: ${reportPath}`,
      )
    }
    if (!manifest.trial || !manifest.calibration) {
      const reason = 'no trial evaluator is configured for an in-scope candidate'
      await writeJson(reportPath, reportBase)
      return finishIncomplete(reportPath, reason)
    }

    const casePackHashBeforeTrial = await hashTree(casePackDir)
    if (casePackHashBeforeTrial !== casePackHash) {
      const reason = 'case pack changed during shadow evaluation'
      await writeJson(reportPath, {
        ...reportBase,
        run: { ...reportBase.run, finishedAt: new Date().toISOString() },
        epoch: {
          ...reportBase.epoch,
          casePackFinalHash: casePackHashBeforeTrial,
          casePackUnchanged: false,
        },
      })
      return finishIncomplete(reportPath, reason)
    }

    let pairedTrial: PairedTrialResult
    try {
      await updateState({ phase: 'trial-running' })
      if (preflightCalibration === undefined) {
        pairedTrial = await runPairedTrial({
          baselineKind,
          ...options.baselineSkillName === undefined
            ? {}
            : { baselineSkillName: options.baselineSkillName },
          calibration: manifest.calibration,
          casePackDir,
          dshRevision: manifest.epoch.dshRevision,
          outputDir,
          candidateSkillDir: exactCandidateDir,
          ...options.signal === undefined ? {} : { signal: options.signal },
          skillDir,
          trial: manifest.trial,
          trialLimit: manifest.budget.trialLimit,
        })
      } else {
        const comparison = await runComparisonTrial({
          baselineKind,
          ...options.baselineSkillName === undefined
            ? {}
            : { baselineSkillName: options.baselineSkillName },
          casePackDir,
          dshRevision: manifest.epoch.dshRevision,
          outputDir,
          candidateSkillDir: exactCandidateDir,
          ...options.signal === undefined ? {} : { signal: options.signal },
          skillDir,
          trial: manifest.trial,
          trialLimit: manifest.budget.trialLimit,
        })
        pairedTrial = {
          backend: comparison.backend,
          count: 4,
          assembled: comparison.assembled,
          calibration: preflightCalibration.calibration,
          baseline: comparison.baseline,
          candidate: comparison.candidate,
        }
      }
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason
      const reason = error instanceof Error ? error.message : String(error)
      const treeHashAfterTrial = await hashTree(skillDir)
      await writeJson(reportPath, {
        ...reportBase,
        run: { ...reportBase.run, finishedAt: new Date().toISOString() },
        subject: {
          ...reportBase.subject,
          finalTreeHash: treeHashAfterTrial,
          unchanged: treeHashAfterTrial === baseTreeHash,
        },
      })
      return finishIncomplete(reportPath, reason)
    }

    const treeHashAfterTrial = await hashTree(skillDir)
    const casePackHashAfterTrial = await hashTree(casePackDir)
    if (casePackHashAfterTrial !== casePackHash) {
      const reason = 'case pack changed during shadow evaluation'
      await writeJson(reportPath, {
        ...reportBase,
        run: { ...reportBase.run, finishedAt: new Date().toISOString() },
        epoch: {
          ...reportBase.epoch,
          casePackFinalHash: casePackHashAfterTrial,
          casePackUnchanged: false,
        },
        calibration: pairedTrial.calibration,
      })
      return finishIncomplete(reportPath, reason)
    }
    if (treeHashAfterTrial !== baseTreeHash) {
      const reason = 'active Skill changed during sealed Trial'
      await writeJson(reportPath, {
        ...reportBase,
        run: { ...reportBase.run, finishedAt: new Date().toISOString() },
        subject: {
          ...reportBase.subject,
          finalTreeHash: treeHashAfterTrial,
          unchanged: false,
        },
        calibration: pairedTrial.calibration,
      })
      return finishIncomplete(reportPath, reason)
    }

    let exactCandidateTreeHashAfterTrial: string
    try {
      exactCandidateTreeHashAfterTrial = await hashTree(exactCandidateDir)
    } catch {
      exactCandidateTreeHashAfterTrial = 'unreadable'
    }
    if (exactCandidateTreeHashAfterTrial !== exactCandidateTreeHash
      || pairedTrial.candidate.treeHash !== exactCandidateTreeHash) {
      const reason = exactCandidateTreeHashAfterTrial !== exactCandidateTreeHash
        ? 'exact Candidate changed during sealed Trial'
        : 'exact Candidate proposal did not reproduce its pinned tree'
      await writeJson(reportPath, {
        ...reportBase,
        run: { ...reportBase.run, finishedAt: new Date().toISOString() },
        subject: {
          ...reportBase.subject,
          finalTreeHash: treeHashAfterTrial,
          unchanged: true,
        },
        epoch: {
          ...reportBase.epoch,
          casePackFinalHash: casePackHashAfterTrial,
          casePackUnchanged: true,
        },
        candidate: {
          ...reportBase.candidate,
          treeHash: pairedTrial.candidate.treeHash,
        },
        calibration: pairedTrial.calibration,
      })
      return finishIncomplete(reportPath, reason)
    }

    const calibrationPassed = pairedTrial.calibration.every((result) => result.passed)
    const baselineComposition = pairedTrial.baseline.composition
    const candidateComposition = pairedTrial.candidate.composition
    const hasCompositionEvidence = baselineComposition !== undefined && candidateComposition !== undefined
    const compositionStable = !hasCompositionEvidence
      || baselineComposition.fingerprint === candidateComposition.fingerprint
    const decision = decidePairedTrial({
      baselinePassed: pairedTrial.baseline.passed,
      calibrationPassed,
      candidatePassed: pairedTrial.candidate.passed,
      compositionStable,
    })
    const actualCandidateTreeHash = pairedTrial.candidate.treeHash
    await writeJson(reportPath, {
      ...reportBase,
      run: { ...reportBase.run, status: 'complete', finishedAt: new Date().toISOString() },
      subject: {
        ...reportBase.subject,
        finalTreeHash: treeHashAfterTrial,
        unchanged: true,
      },
      epoch: {
        ...reportBase.epoch,
        casePackFinalHash: casePackHashAfterTrial,
        casePackUnchanged: true,
      },
      candidate: {
        ...reportBase.candidate,
        id: actualCandidateTreeHash.slice(0, 16),
        treeHash: actualCandidateTreeHash,
      },
      calibration: pairedTrial.calibration,
      cases: [{
        id: manifest.id,
        partition: 'final-test',
        baseline: pairedTrial.baseline.passed ? 'pass' : 'fail',
        candidate: pairedTrial.candidate.passed && compositionStable ? 'pass' : 'fail',
        checks: [
          ...pairedTrial.candidate.checks,
          ...hasCompositionEvidence
            ? [{ name: 'non-target-composition-stable', passed: compositionStable }]
            : [],
        ],
      }],
      composition: {
        ...reportBase.composition,
        baselineFingerprint: baselineComposition?.fingerprint ?? baselineFingerprint,
        candidateFingerprint: candidateComposition?.fingerprint
          ?? sha256(`${baselineFingerprint}:${actualCandidateTreeHash}`),
        ...hasCompositionEvidence ? { stable: compositionStable } : {},
      },
      trial: {
        backend: pairedTrial.backend,
        enforcement: 'full',
        count: pairedTrial.count,
        ...baselineComposition !== undefined && candidateComposition !== undefined
          ? {
              modelCalls: {
                baseline: baselineComposition.modelCalls,
                candidate: candidateComposition.modelCalls,
              },
              usage: {
                baseline: baselineComposition.usage,
                candidate: candidateComposition.usage,
              },
            }
          : {},
      },
      decision: {
        recommendation: decision.recommendation,
        reasons: [decision.reason],
        limitations: [skillCandidateLineage !== undefined
          ? 'Internal Opportunity-bound Candidate; Shadow has no release authority'
          : 'Exact Candidate without internal lineage requires human provenance review'],
      },
    })
    return finishComplete(
      reportPath,
      `${decision.recommendation}: ${decision.reason}; report: ${reportPath}`,
    )
  } finally {
    await releaseRunLock()
  }
}

function checkCandidateSkillIdentity(
  proposal: Proposal,
  expectedName: string,
): { passed: true } | { passed: false; reason: string } {
  const skillFiles = proposal.files.filter((file) => file.path === 'SKILL.md')
  if (skillFiles.length === 0) return { passed: true }
  if (skillFiles.length > 1) {
    return { passed: false, reason: 'candidate proposed SKILL.md more than once' }
  }
  try {
    if (parseSkillName(skillFiles[0]!.content) !== expectedName) {
      return { passed: false, reason: 'candidate changed the Skill name' }
    }
  } catch {
    return { passed: false, reason: 'candidate SKILL.md has no valid name' }
  }
  return { passed: true }
}

function decidePairedTrial(input: {
  baselinePassed: boolean
  calibrationPassed: boolean
  candidatePassed: boolean
  compositionStable: boolean
}): { recommendation: 'promote' | 'review' | 'reject'; reason: string } {
  if (!input.calibrationPassed) {
    return { recommendation: 'reject', reason: 'case pack calibration failed' }
  }
  if (!input.candidatePassed) {
    return { recommendation: 'reject', reason: 'candidate failed the Trial evaluator' }
  }
  if (!input.compositionStable) {
    return { recommendation: 'reject', reason: 'candidate changed non-target DSH composition' }
  }
  if (!input.baselinePassed) {
    return {
      recommendation: 'promote',
      reason: 'candidate passed sealed final-test while baseline failed',
    }
  }
  return { recommendation: 'review', reason: 'candidate did not improve the passing baseline' }
}

function assertSeparateOutput(
  outputDir: string,
  skillDir: string,
  casePackDir: string,
  exactCandidateDir: string,
): void {
  for (const protectedDir of [skillDir, casePackDir, exactCandidateDir]) {
    const fromProtected = relative(protectedDir, outputDir)
    const fromOutput = relative(outputDir, protectedDir)
    if (fromProtected === '' || (!fromProtected.startsWith('..') && !isAbsolute(fromProtected))) {
      throw new Error('output directory must be outside the Skill and case pack')
    }
    if (fromOutput === '' || (!fromOutput.startsWith('..') && !isAbsolute(fromOutput))) {
      throw new Error('output directory must not contain the Skill or case pack')
    }
  }
}

function assertSeparateTrees(left: string, right: string, leftLabel: string, rightLabel: string): void {
  const fromLeft = relative(left, right)
  const fromRight = relative(right, left)
  const contains = (value: string): boolean => value === ''
    || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value))
  if (contains(fromLeft) || contains(fromRight)) {
    throw new Error(`${leftLabel} and ${rightLabel} must use separate roots`)
  }
}

function normalizeExactClaim(value: string): string {
  const claim = value.replaceAll(/[\r\n]+/g, ' ').trim()
  if (claim.length === 0 || claim.length > 500) {
    throw new Error('exact Candidate claim must be 1-500 characters')
  }
  return claim
}

async function proposalFromExactCandidate(
  baselineDir: string,
  candidateDir: string,
  claim: string,
  baselineKind: TrialBaselineKind = 'skill-tree',
): Promise<Proposal> {
  const [baseline, candidate] = await Promise.all([
    baselineKind === 'capability-absent'
      ? Promise.resolve(new Map<string, Buffer>())
      : readRegularTree(baselineDir),
    readRegularTree(candidateDir),
  ])
  for (const path of baseline.keys()) {
    if (!candidate.has(path)) {
      throw new Error(`exact Candidate removes baseline file '${path}'; deletion is not publishable`)
    }
  }
  const files: Proposal['files'] = []
  for (const [path, content] of candidate) {
    if (baseline.get(path)?.equals(content)) continue
    const text = content.toString('utf8')
    if (!Buffer.from(text).equals(content)) {
      throw new Error(`exact Candidate file '${path}' is not UTF-8 text`)
    }
    files.push({ path, content: text })
  }
  if (files.length === 0) throw new Error('exact Candidate has no change from its baseline')
  return { claim, files }
}

function isPublicSkillName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

async function readRegularTree(root: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`exact Candidate comparison found unsupported entry '${entry.name}'`)
      }
      const ownedPath = relative(root, path).split(sep).join('/')
      if (!isOwnedRelativePath(ownedPath)) {
        throw new Error(`exact Candidate comparison path is not owned: '${ownedPath}'`)
      }
      files.set(ownedPath, await readFile(path))
    }
  }
  await visit(root)
  return files
}

export function parseCasePackManifest(source: string): CasePackManifest {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('case pack manifest is not valid JSON')
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.id !== 'string'
    || typeof value.workspaceId !== 'string' || !zUuid(value.workspaceId)) {
    throw new Error('case pack manifest must use schemaVersion 1 and have an id and Workspace id')
  }
  if (Object.hasOwn(value, 'search')) {
    throw new Error('case pack manifest uses the retired search field; use evidence.rationale')
  }
  const knownFields = new Set([
    'schemaVersion', 'id', 'workspaceId', 'epoch', 'budget', 'evidence', 'trial', 'calibration',
  ])
  const unknownField = Object.keys(value).find(key => !knownFields.has(key))
  if (unknownField !== undefined) {
    throw new Error(`case pack manifest has unknown field '${unknownField}'`)
  }
  if (!isRecord(value.epoch)
    || typeof value.epoch.dshRevision !== 'string'
    || typeof value.epoch.evaluatorVersion !== 'string') {
    throw new Error('case pack manifest has an invalid epoch')
  }
  if (!isRecord(value.evidence)
    || value.evidence.rationale !== 'evidence/rationale.md'
    || Object.keys(value.evidence).some(key => key !== 'rationale')) {
    throw new Error('case pack manifest evidence must contain only rationale="evidence/rationale.md"')
  }
  if (!isRecord(value.budget)) throw new Error('case pack manifest has no budget')
  for (const key of ['candidateLimit', 'trialLimit', 'inputTokenLimit', 'outputTokenLimit']) {
    const amount = value.budget[key]
    if (!Number.isSafeInteger(amount) || (amount as number) <= 0) {
      throw new Error(`case pack budget ${key} must be a positive integer`)
    }
  }
  if (value.trial !== undefined || value.calibration !== undefined) {
    if (!isRecord(value.trial)
      || typeof value.trial.evaluator !== 'string'
      || !isOwnedRelativePath(value.trial.evaluator)
      || !Number.isSafeInteger(value.trial.timeoutMs)
      || (value.trial.timeoutMs as number) <= 0
      || !Number.isSafeInteger(value.trial.outputLimitBytes)
      || (value.trial.outputLimitBytes as number) <= 0) {
      throw new Error('case pack has an invalid Trial definition')
    }
    if (value.trial.dshAssembled !== undefined && typeof value.trial.dshAssembled !== 'boolean') {
      throw new Error('case pack Trial dshAssembled must be boolean')
    }
    if (value.trial.dshProfileInstall !== undefined && typeof value.trial.dshProfileInstall !== 'boolean') {
      throw new Error('case pack Trial dshProfileInstall must be boolean')
    }
    if (value.trial.dshProfileInstall === true && value.trial.dshAssembled !== true) {
      throw new Error('case pack Trial dshProfileInstall requires dshAssembled')
    }
    if (value.trial.capabilityAbsentBaseline !== undefined
      && typeof value.trial.capabilityAbsentBaseline !== 'boolean') {
      throw new Error('case pack Trial capabilityAbsentBaseline must be boolean')
    }
    if (!isRecord(value.calibration)
      || typeof value.calibration.knownBad !== 'string'
      || !isOwnedRelativePath(value.calibration.knownBad)
      || typeof value.calibration.knownCorrection !== 'string'
      || !isOwnedRelativePath(value.calibration.knownCorrection)) {
      throw new Error('case pack has an invalid calibration definition')
    }
  }
  return value as unknown as CasePackManifest
}

function zUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

function parseSkillName(source: string): string {
  const match = /^---\n[\s\S]*?^name:\s*([^\n]+)$/m.exec(source)
  if (!match?.[1]) throw new Error('SKILL.md frontmatter must declare name')
  return match[1].trim()
}

function parsePersistedProposal(value: unknown): Proposal {
  if (!isRecord(value) || typeof value.claim !== 'string' || !Array.isArray(value.files)) {
    throw new Error('durable Candidate has an invalid shape')
  }
  for (const file of value.files) {
    if (!isRecord(file) || typeof file.path !== 'string' || typeof file.content !== 'string') {
      throw new Error('durable Candidate file has an invalid shape')
    }
  }
  return structuredClone(value) as unknown as Proposal
}

function isOwnedRelativePath(path: string): boolean {
  if (path.length === 0 || path.includes('\\') || isAbsolute(path)) return false
  const normalized = path.split('/')
  return normalized.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeDurableJson(path, value)
}

async function assertTerminalReport(outputDir: string, reportPath: string): Promise<void> {
  if (reportPath !== resolve(outputDir, 'report.json')) {
    throw new Error('Shadow terminal state references a report outside its run')
  }
  await readFile(reportPath)
}
