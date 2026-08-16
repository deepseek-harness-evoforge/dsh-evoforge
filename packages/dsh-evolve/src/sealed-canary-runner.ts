import { mkdir, readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CanaryComparisonRunner } from './counterfactual-canary.ts'
import type { CapabilityGeneration, EvolutionStore, SkillGenerationArtifact } from './generation-store.ts'
import type { GitSkillSource, ResolvedGitSkillArtifact } from './git-skill-source.ts'
import { hashTree } from './hash.ts'
import { loadShadowRunState } from './shadow-run-state.ts'
import { parseCasePackManifest } from './shadow.ts'
import { runPairedTrial } from './trial.ts'

/** Build the production Adapter that rechecks one exact Skill Generation after a failed delivery. */
export function createSealedCanaryRunner(
  source: GitSkillSource,
  store: Pick<EvolutionStore, 'getGeneration'>,
): CanaryComparisonRunner {
  return async ({ candidate, generation, outcome, signal }) => {
    signal.throwIfAborted()
    if (candidate.generationId !== generation.id || outcome.generationId !== generation.id) {
      throw new Error('canary evidence does not identify the selected Generation')
    }
    const artifact = generationSkill(generation, candidate.skillName)
    if (candidate.evaluatorVersion !== generation.evaluatorVersion) {
      throw new Error('canary review evaluator does not match its Generation')
    }

    const runState = await loadShadowRunState(candidate.outputDir)
    if (runState.phase !== 'complete' || runState.outcome?.kind !== 'complete') {
      throw new Error('canary requires terminal original Shadow evidence')
    }
    if (runState.runId !== candidate.runId || runState.resumeInputs === undefined) {
      throw new Error('canary original Shadow identity is incomplete')
    }
    if (runState.identity.skillName !== candidate.skillName
      || runState.identity.baseTreeHash !== candidate.baseTreeHash
      || runState.identity.evaluatorVersion !== candidate.evaluatorVersion) {
      throw new Error('canary original Shadow identity does not match reviewed evidence')
    }

    const casePackDir = await realpath(runState.resumeInputs.casePackDir)
    if (await hashTree(casePackDir) !== runState.identity.casePackHash) {
      throw new Error('canary Case Pack changed since the original sealed Trial')
    }
    const manifest = parseCasePackManifest(
      await readFile(resolve(casePackDir, 'manifest.json'), 'utf8'),
    )
    if (manifest.epoch.dshRevision !== runState.identity.dshRevision
      || manifest.epoch.evaluatorVersion !== runState.identity.evaluatorVersion) {
      throw new Error('canary Case Pack epoch changed since the original sealed Trial')
    }
    if (manifest.trial === undefined || manifest.calibration === undefined) {
      throw new Error('canary Case Pack has no sealed Trial and calibration')
    }

    const exactCandidate = await source.resolveArtifact(candidate.skillName, artifact)
    await assertContentHash(exactCandidate, candidate.candidateTreeHash, 'Candidate')
    const exactParent = await resolveParent(source, store, generation, artifact)
    await assertContentHash(exactParent, candidate.baseTreeHash, 'parent')

    const trialOutput = join(candidate.outputDir, 'canary', generation.id, 'trial')
    await mkdir(trialOutput, { recursive: true })
    const paired = await runPairedTrial({
      calibration: manifest.calibration,
      candidateSkillDir: exactCandidate.resourceBase,
      casePackDir,
      dshRevision: manifest.epoch.dshRevision,
      outputDir: trialOutput,
      signal,
      skillDir: exactParent.resourceBase,
      trial: manifest.trial,
      trialLimit: manifest.budget.trialLimit,
    })
    if (paired.baseline.treeHash !== candidate.baseTreeHash
      || paired.candidate.treeHash !== candidate.candidateTreeHash) {
      throw new Error('canary Trial did not execute the reviewed exact Skill trees')
    }

    return {
      calibrationPassed: paired.calibration.every(item => item.passed),
      parentPassed: paired.baseline.passed,
      candidatePassed: paired.candidate.passed,
      report: {
        schemaVersion: 1,
        backend: paired.backend,
        trialCount: paired.count,
        assembled: paired.assembled,
        proposalModelCalls: 0,
        casePackHash: runState.identity.casePackHash,
        parentContentHash: paired.baseline.treeHash,
        candidateContentHash: paired.candidate.treeHash,
        calibration: paired.calibration,
        parentChecks: paired.baseline.checks.map(check => ({ name: check.name, passed: check.passed })),
        candidateChecks: paired.candidate.checks.map(check => ({ name: check.name, passed: check.passed })),
      },
    }
  }
}

async function resolveParent(
  source: GitSkillSource,
  store: Pick<EvolutionStore, 'getGeneration'>,
  generation: CapabilityGeneration,
  candidate: SkillGenerationArtifact,
): Promise<ResolvedGitSkillArtifact> {
  if (generation.parentId === undefined) {
    return source.resolveParentArtifact(candidate.name, candidate)
  }
  const parent = store.getGeneration(generation.parentId)
  if (parent === undefined) throw new Error('canary parent Generation is missing')
  const artifact = parent.artifacts.find(item => item.name === candidate.name)
  if (artifact === undefined) throw new Error('canary parent Generation has no matching Skill artifact')
  return source.resolveArtifact(candidate.name, artifact)
}

function generationSkill(
  generation: CapabilityGeneration,
  name: string,
): SkillGenerationArtifact {
  const matches = generation.artifacts.filter(artifact => artifact.name === name)
  if (matches.length !== 1) {
    throw new Error(`canary Generation must contain exactly one artifact for Skill '${name}'`)
  }
  return matches[0]!
}

async function assertContentHash(
  artifact: ResolvedGitSkillArtifact,
  expected: string,
  label: string,
): Promise<void> {
  if (await hashTree(artifact.resourceBase) !== expected) {
    throw new Error(`canary ${label} content does not match reviewed evidence`)
  }
}
