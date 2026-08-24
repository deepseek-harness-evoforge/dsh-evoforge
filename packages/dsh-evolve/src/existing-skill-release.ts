import { createHash } from 'node:crypto'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  createExistingSkillCandidateLineage,
  parseExistingSkillCandidateLineage,
  type ExistingSkillCandidateLineage,
} from './existing-skill-candidate-lineage.ts'
import type {
  ExistingSkillCandidateAdmissionResult,
  ExistingSkillCandidateAdmissionScan,
} from './existing-skill-candidate-admission.ts'
import type {
  ExistingSkillHoldoutEvaluationRunView,
  ExistingSkillHoldoutEvaluationScan,
} from './existing-skill-holdout-evaluation.ts'
import type {
  ExistingSkillRetentionEvaluationRunView,
  ExistingSkillRetentionEvaluationScan,
} from './existing-skill-retention-evaluation.ts'
import type {
  CapabilityGeneration,
  EvolutionStore,
  GenerationInput,
  SkillGenerationArtifact,
} from './generation-store.ts'
import type { GenerationBundleRepository } from './generation-bundle-repository.ts'
import {
  assembleSealedSkillBundleArchive,
  type AssembledSkillBundleArchive,
} from './skill-bundle-archive.ts'
import type { ExistingSkillCandidate } from './skill-candidate-repository.ts'
import type { ResolvedInstalledSkillBundle } from './installed-skill-baseline.ts'
import { projectCandidateImpact } from './candidate-impact.ts'

const HASH = /^[a-f0-9]{64}$/u
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const MAX_NOTE_BYTES = 2_048
const MAX_AUTOMATIC_APPEND_BYTES = 2_048

export type ExistingSkillReleaseReason =
  | 'exact-existing-skill-evidence-retained'
  | 'human-rejected'
  | 'candidate-not-found'
  | 'candidate-ambiguous'
  | 'admission-evidence-invalid'
  | 'admission-not-qualified'
  | 'holdout-evidence-invalid'
  | 'holdout-not-improved'
  | 'retention-evidence-invalid'
  | 'retention-not-retained'
  | 'release-decision-evidence-mismatch'

export type ExistingSkillReleaseEligibility = {
  readonly status: 'eligible' | 'approved'
  readonly reason: 'exact-existing-skill-evidence-retained'
  readonly candidateId: string
  readonly admissionId: string
  readonly holdoutEvaluationId: string
  readonly retentionEvaluationId: string
  readonly generationId?: string
} | {
  readonly status: 'rejected'
  readonly reason: 'human-rejected'
  readonly candidateId: string
} | {
  readonly status: 'blocked'
  readonly reason: Exclude<ExistingSkillReleaseReason, 'exact-existing-skill-evidence-retained'>
  readonly candidateId: string
}

export interface ExistingSkillReleaseDecision {
  readonly schemaVersion: 1
  readonly kind: 'existing-skill-release-decision-v1'
  readonly id: string
  readonly candidateId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly status: 'approved' | 'rejected'
  readonly actor: 'human' | 'automatic-clear-instruction-v2'
  readonly automaticPolicyId?: string | undefined
  readonly decisionNote: string
  readonly decidedAt: string
  readonly evidenceHash: string
  readonly admissionId?: string | undefined
  readonly holdoutEvaluationId?: string | undefined
  readonly retentionEvaluationId?: string | undefined
  readonly generationId?: string | undefined
}

export interface ExistingSkillAutomaticPromotionPolicy {
  readonly id: string
  readonly workspaceId: string
}

export type ExistingSkillAutomaticPromotionReason =
  | 'clear-low-risk-instruction-improved-and-retained'
  | 'instruction-change-is-not-append-only'
  | 'instruction-change-has-protected-effects'
  | 'candidate-cost-or-cache-regressed'
  | 'workspace-paused'
  | 'human-decision-controls-release'
  | ExistingSkillReleaseReason

export interface ExistingSkillAutomaticPromotionResult {
  readonly candidateId: string
  readonly status: 'promoted' | 'already-promoted' | 'review-required' | 'paused' | 'blocked'
  readonly reason: ExistingSkillAutomaticPromotionReason
  readonly generationId?: string | undefined
}

export interface ExistingSkillAutomaticPromotionScan {
  readonly configuredPolicyCount: number
  readonly scannedCandidateCount: number
  readonly promotedCount: number
  readonly reviewRequiredCount: number
  readonly warningCount: number
  readonly results: readonly ExistingSkillAutomaticPromotionResult[]
}

export interface ExistingSkillAutomaticPromotionStatus {
  readonly candidateId: string
  readonly status: 'eligible' | 'pending-promotion' | 'already-promoted' | 'review-required' | 'paused' | 'blocked'
  readonly reason: ExistingSkillAutomaticPromotionReason
  readonly generationId?: string | undefined
}

export interface ExistingSkillAutomaticPromotionStatusScan {
  readonly configuredPolicyCount: number
  readonly scannedCandidateCount: number
  readonly warningCount: number
  readonly results: readonly ExistingSkillAutomaticPromotionStatus[]
}

export interface ExistingSkillReleaseStore {
  get(candidateId: string): ExistingSkillReleaseDecision | undefined
  list(workspaceId?: string): ExistingSkillReleaseDecision[]
  record(decision: ExistingSkillReleaseDecision): Promise<{
    readonly created: boolean
    readonly decision: ExistingSkillReleaseDecision
  }>
  close(): Promise<void>
}

interface ExistingSkillReleaseOptions {
  readonly candidates: {
    listExistingCandidates(workspaceId?: string): ExistingSkillCandidate[]
    resolveExistingBundle(candidate: ExistingSkillCandidate): Promise<AssembledSkillBundleArchive>
  }
  readonly admissions: { scan(workspaceId?: string): Promise<ExistingSkillCandidateAdmissionScan> }
  readonly holdouts: { scan(workspaceId?: string): Promise<ExistingSkillHoldoutEvaluationScan> }
  readonly retentions: { scan(workspaceId?: string): Promise<ExistingSkillRetentionEvaluationScan> }
  readonly decisions: ExistingSkillReleaseStore
  readonly store: Pick<EvolutionStore,
    'getActiveGeneration' | 'getGeneration' | 'publishGeneration' | 'promoteGeneration'>
  readonly bundles: {
    providerFor(generation: CapabilityGeneration): ReturnType<GenerationBundleRepository['providerFor']>
  }
  readonly baselines?: {
    resolveBaseline(workspaceId: string, baselineId: string): Promise<ResolvedInstalledSkillBundle | undefined>
  }
  readonly automaticPromotionPolicies?: readonly ExistingSkillAutomaticPromotionPolicy[]
  readonly isPaused?: (workspaceId: string) => boolean
  readonly now?: () => number
}

interface ExactReleaseEvidence {
  readonly candidate: ExistingSkillCandidate
  readonly admission: ExistingSkillCandidateAdmissionResult
  readonly holdout: ExistingSkillHoldoutEvaluationRunView
  readonly retention: ExistingSkillRetentionEvaluationRunView
  readonly lineage: ExistingSkillCandidateLineage
  readonly evidenceHash: string
}

/**
 * Sole Host gate from independently owned existing-Skill evidence to an
 * inactive Generation and, in a separate explicit action, future Sessions.
 * It neither authors nor evaluates a Candidate and never mutates a live
 * Session.
 */
export class ExistingSkillRelease {
  private readonly options: ExistingSkillReleaseOptions
  private readonly automaticPolicies = new Map<string, ExistingSkillAutomaticPromotionPolicy>()
  private readonly actionTails = new Map<string, Promise<void>>()

  constructor(options: ExistingSkillReleaseOptions) {
    this.options = options
    const ids = new Set<string>()
    for (const policy of options.automaticPromotionPolicies ?? []) {
      if (!PUBLIC_ID.test(policy.id) || !z.string().uuid().safeParse(policy.workspaceId).success) {
        throw new Error('existing Skill automatic promotion policy has an invalid identity')
      }
      if (ids.has(policy.id) || this.automaticPolicies.has(policy.workspaceId)) {
        throw new Error('existing Skill automatic promotion policy ids and Workspaces must be unique')
      }
      ids.add(policy.id)
      this.automaticPolicies.set(policy.workspaceId, Object.freeze({ ...policy }))
    }
    if (this.automaticPolicies.size > 0
      && (options.baselines === undefined || options.isPaused === undefined)) {
      throw new Error('existing Skill automatic promotion requires exact baseline and pause authorities')
    }
  }

  async scan(workspaceId?: string): Promise<readonly ExistingSkillReleaseEligibility[]> {
    const candidates = this.options.candidates.listExistingCandidates(workspaceId)
    return Promise.all(candidates.map(candidate => this.eligibility(candidate.workspaceId, candidate.id)))
  }

  /** Read-only Web/Control projection; it never publishes or selects a Generation. */
  async scanAutomatic(workspaceId: string): Promise<ExistingSkillAutomaticPromotionStatusScan> {
    const policy = this.automaticPolicies.get(workspaceId)
    if (policy === undefined) return automaticStatusScan(0, 0, [])
    const candidates = this.options.candidates.listExistingCandidates(workspaceId)
      .filter(candidate => candidate.workspaceId === workspaceId)
      .sort((left, right) => left.id.localeCompare(right.id))
    if (this.options.isPaused!(workspaceId)) {
      return automaticStatusScan(1, candidates.length, candidates.map(candidate => Object.freeze({
        candidateId: candidate.id,
        status: 'paused' as const,
        reason: 'workspace-paused' as const,
      })))
    }
    const results: ExistingSkillAutomaticPromotionStatus[] = []
    let warningCount = 0
    for (const candidate of candidates) {
      try {
        results.push(await this.inspectAutomaticCandidate(policy, candidate))
      } catch {
        warningCount += 1
        results.push(Object.freeze({
          candidateId: candidate.id,
          status: 'blocked',
          reason: 'release-decision-evidence-mismatch',
        }))
      }
    }
    return automaticStatusScan(1, candidates.length, results, warningCount)
  }

  async eligibility(
    workspaceId: string,
    candidateId: string,
  ): Promise<ExistingSkillReleaseEligibility> {
    const decision = this.options.decisions.get(candidateId)
    if (decision?.status === 'rejected') {
      const candidates = this.options.candidates.listExistingCandidates(workspaceId)
        .filter(candidate => candidate.id === candidateId && candidate.workspaceId === workspaceId)
      if (candidates.length !== 1
        || decision.workspaceId !== workspaceId
        || decision.skillName !== candidates[0]!.skillName
        || decision.evidenceHash !== candidateOnlyEvidenceHash(candidates[0]!)) {
        return blocked(candidateId, 'release-decision-evidence-mismatch')
      }
      return Object.freeze({ status: 'rejected', reason: 'human-rejected', candidateId })
    }
    const resolved = await this.resolveEvidence(workspaceId, candidateId)
    if ('blocked' in resolved) return resolved.blocked
    const { evidence } = resolved
    if (decision !== undefined) {
      if (!decisionMatches(decision, evidence)) {
        return blocked(candidateId, 'release-decision-evidence-mismatch')
      }
      return exactEligibility(evidence, decision.status, decision.generationId)
    }
    return exactEligibility(evidence, 'eligible')
  }

  approve(
    workspaceId: string,
    candidateId: string,
    note: string,
  ): Promise<ExistingSkillReleaseDecision> {
    return this.enqueue(candidateId, () => this.approveNow(workspaceId, candidateId, note))
  }

  reject(
    workspaceId: string,
    candidateId: string,
    note: string,
  ): Promise<ExistingSkillReleaseDecision> {
    return this.enqueue(candidateId, () => this.rejectNow(workspaceId, candidateId, note))
  }

  promote(
    workspaceId: string,
    candidateId: string,
  ): Promise<{ readonly previousId: string | undefined; readonly generation: CapabilityGeneration }> {
    return this.enqueue(candidateId, () => this.promoteNow(workspaceId, candidateId))
  }

  /**
   * Reconcile one explicitly authorized Workspace from durable evaluation
   * evidence. This is the only automatic mutation seam and remains narrower
   * than human release: exact append-only, effect-clear SKILL.md changes only.
   */
  async reconcileAutomatic(
    workspaceId: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<ExistingSkillAutomaticPromotionScan> {
    const policy = this.automaticPolicies.get(workspaceId)
    if (policy === undefined) return automaticScan(0, 0, [])
    const candidates = this.options.candidates.listExistingCandidates(workspaceId)
      .filter(candidate => candidate.workspaceId === workspaceId)
      .sort((left, right) => left.id.localeCompare(right.id))
    if (this.options.isPaused!(workspaceId)) {
      return automaticScan(1, candidates.length, candidates.map(candidate => Object.freeze({
        candidateId: candidate.id,
        status: 'paused' as const,
        reason: 'workspace-paused' as const,
      })))
    }
    const results: ExistingSkillAutomaticPromotionResult[] = []
    let warningCount = 0
    for (const candidate of candidates) {
      options.signal?.throwIfAborted()
      try {
        results.push(await this.enqueue(candidate.id, () =>
          this.reconcileAutomaticCandidate(policy, candidate, options.signal)))
      } catch (error) {
        if (options.signal?.aborted === true) throw error
        if (error instanceof AutomaticPromotionPausedError) {
          results.push(automaticPaused(candidate.id))
          continue
        }
        warningCount += 1
        results.push(Object.freeze({
          candidateId: candidate.id,
          status: 'blocked',
          reason: 'release-decision-evidence-mismatch',
        }))
      }
    }
    return automaticScan(1, candidates.length, results, warningCount)
  }

  private async approveNow(
    workspaceId: string,
    candidateId: string,
    note: string,
    automaticPolicy?: ExistingSkillAutomaticPromotionPolicy,
  ): Promise<ExistingSkillReleaseDecision> {
    const normalizedNote = normalizeNote(note)
    const prior = this.options.decisions.get(candidateId)
    if (prior?.status === 'rejected') throw new Error('rejected existing Skill Candidate cannot be approved')
    if (prior?.status === 'approved') return prior
    const resolved = await this.resolveEvidence(workspaceId, candidateId)
    if ('blocked' in resolved) throw releaseBlocked(resolved.blocked.reason)
    const { evidence } = resolved
    const archive = await this.options.candidates.resolveExistingBundle(evidence.candidate)
    requireArchive(evidence.candidate, archive)
    const active = this.options.store.getActiveGeneration(workspaceId)
    if (active !== undefined) await this.options.bundles.providerFor(active)
    const artifacts = replaceExactParent(active?.artifacts ?? [], evidence)
    const artifact = {
      kind: 'skill-bundle' as const,
      name: evidence.candidate.skillName,
      artifactDigest: archive.artifactDigest,
      treeHash: archive.treeHash,
      contentBase64: archive.content.toString('base64'),
      lineage: evidence.lineage,
    }
    artifacts.push(artifact)
    const createdAt = exactFinishedAt(evidence.retention)
    const input: GenerationInput = {
      workspaceId,
      ...active === undefined ? {} : { parentId: active.id },
      createdAt,
      artifacts,
      evaluatorVersion: 'existing-skill-paired-v1',
      policyVersion: automaticPolicy === undefined
        ? 'human-review-existing-skill-v1'
        : 'automatic-clear-instruction-v2',
      compositionFingerprint: evidence.evidenceHash,
    }
    await this.options.bundles.providerFor({ id: '0'.repeat(64), schemaVersion: 2, ...input })
    if (automaticPolicy !== undefined && this.options.isPaused!(workspaceId)) {
      throw new AutomaticPromotionPausedError()
    }
    const published = await this.options.store.publishGeneration(input)
    requirePublishedGeneration(published.generation, input)
    if (this.options.store.getActiveGeneration(workspaceId)?.id !== active?.id) {
      throw new Error('active Generation changed while the existing Skill Candidate was being published')
    }
    const decision = createDecision({
      candidate: evidence.candidate,
      status: 'approved',
      note: normalizedNote,
      decidedAt: new Date(this.options.now?.() ?? Date.now()).toISOString(),
      evidenceHash: evidence.evidenceHash,
      admissionId: evidence.admission.id,
      holdoutEvaluationId: evidence.holdout.id,
      retentionEvaluationId: evidence.retention.id,
      generationId: published.generation.id,
      ...automaticPolicy === undefined
        ? { actor: 'human' as const }
        : {
            actor: 'automatic-clear-instruction-v2' as const,
            automaticPolicyId: automaticPolicy.id,
          },
    })
    if (automaticPolicy !== undefined && this.options.isPaused!(workspaceId)) {
      throw new AutomaticPromotionPausedError()
    }
    const recorded = await this.options.decisions.record(decision)
    if (!decisionEquals(recorded.decision, decision)) {
      throw new Error('existing Skill release decision conflicts with its exact published Generation')
    }
    return recorded.decision
  }

  private async reconcileAutomaticCandidate(
    policy: ExistingSkillAutomaticPromotionPolicy,
    candidate: ExistingSkillCandidate,
    signal?: AbortSignal,
  ): Promise<ExistingSkillAutomaticPromotionResult> {
    signal?.throwIfAborted()
    if (this.options.isPaused!(policy.workspaceId)) return automaticPaused(candidate.id)
    const eligibility = await this.eligibility(policy.workspaceId, candidate.id)
    if (eligibility.status === 'blocked' || eligibility.status === 'rejected') {
      return Object.freeze({
        candidateId: candidate.id,
        status: 'blocked',
        reason: eligibility.reason,
      })
    }
    const prior = this.options.decisions.get(candidate.id)
    if (prior !== undefined) {
      if (prior.actor !== 'automatic-clear-instruction-v2'
        || prior.automaticPolicyId !== policy.id
        || prior.generationId === undefined) {
        return Object.freeze({
          candidateId: candidate.id,
          status: 'review-required',
          reason: 'human-decision-controls-release',
          ...prior.generationId === undefined ? {} : { generationId: prior.generationId },
        })
      }
      if (this.options.store.getActiveGeneration(policy.workspaceId)?.id === prior.generationId) {
        return Object.freeze({
          candidateId: candidate.id,
          status: 'already-promoted',
          reason: 'clear-low-risk-instruction-improved-and-retained',
          generationId: prior.generationId,
        })
      }
      if (this.options.isPaused!(policy.workspaceId)) return automaticPaused(candidate.id)
      signal?.throwIfAborted()
      const promoted = await this.promoteNow(policy.workspaceId, candidate.id, policy)
      return Object.freeze({
        candidateId: candidate.id,
        status: 'promoted',
        reason: 'clear-low-risk-instruction-improved-and-retained',
        generationId: promoted.generation.id,
      })
    }
    const impactReason = await this.automaticImpactReason(candidate)
    if (impactReason !== undefined) {
      return Object.freeze({
        candidateId: candidate.id,
        status: 'review-required',
        reason: impactReason,
      })
    }
    const qualityReason = await this.automaticQualityReason(policy.workspaceId, candidate.id)
    if (qualityReason !== undefined) {
      return Object.freeze({
        candidateId: candidate.id,
        status: 'review-required',
        reason: qualityReason,
      })
    }
    if (this.options.isPaused!(policy.workspaceId)) return automaticPaused(candidate.id)
    const decision = await this.approveNow(
      policy.workspaceId,
      candidate.id,
      'Exact append-only instruction improved paired Holdout and independent Retention.',
      policy,
    )
    if (this.options.isPaused!(policy.workspaceId)) return automaticPaused(candidate.id)
    signal?.throwIfAborted()
    const promoted = await this.promoteNow(policy.workspaceId, candidate.id, policy)
    return Object.freeze({
      candidateId: candidate.id,
      status: 'promoted',
      reason: 'clear-low-risk-instruction-improved-and-retained',
      generationId: decision.generationId ?? promoted.generation.id,
    })
  }

  private async inspectAutomaticCandidate(
    policy: ExistingSkillAutomaticPromotionPolicy,
    candidate: ExistingSkillCandidate,
  ): Promise<ExistingSkillAutomaticPromotionStatus> {
    const eligibility = await this.eligibility(policy.workspaceId, candidate.id)
    if (eligibility.status === 'blocked' || eligibility.status === 'rejected') {
      return Object.freeze({
        candidateId: candidate.id,
        status: 'blocked',
        reason: eligibility.reason,
      })
    }
    const prior = this.options.decisions.get(candidate.id)
    if (prior !== undefined) {
      if (prior.actor !== 'automatic-clear-instruction-v2'
        || prior.automaticPolicyId !== policy.id
        || prior.generationId === undefined) {
        return Object.freeze({
          candidateId: candidate.id,
          status: 'review-required',
          reason: 'human-decision-controls-release',
          ...prior.generationId === undefined ? {} : { generationId: prior.generationId },
        })
      }
      return Object.freeze({
        candidateId: candidate.id,
        status: this.options.store.getActiveGeneration(policy.workspaceId)?.id === prior.generationId
          ? 'already-promoted'
          : 'pending-promotion',
        reason: 'clear-low-risk-instruction-improved-and-retained',
        generationId: prior.generationId,
      })
    }
    const impactReason = await this.automaticImpactReason(candidate)
    const qualityReason = impactReason === undefined
      ? await this.automaticQualityReason(policy.workspaceId, candidate.id)
      : undefined
    return Object.freeze({
      candidateId: candidate.id,
      status: impactReason === undefined && qualityReason === undefined ? 'eligible' : 'review-required',
      reason: impactReason ?? qualityReason ?? 'clear-low-risk-instruction-improved-and-retained',
    })
  }

  private async automaticQualityReason(
    workspaceId: string,
    candidateId: string,
  ): Promise<'candidate-cost-or-cache-regressed' | undefined> {
    const resolved = await this.resolveEvidence(workspaceId, candidateId)
    if ('blocked' in resolved) return 'candidate-cost-or-cache-regressed'
    const evidence = resolved.evidence
    return automaticUsageDoesNotRegress(evidence.holdout.evidence)
      && automaticUsageDoesNotRegress(evidence.retention.evidence)
      ? undefined
      : 'candidate-cost-or-cache-regressed'
  }

  private async automaticImpactReason(
    candidate: ExistingSkillCandidate,
  ): Promise<'instruction-change-is-not-append-only' | 'instruction-change-has-protected-effects' | undefined> {
    const baseline = await this.options.baselines!.resolveBaseline(
      candidate.workspaceId,
      candidate.baseline.id,
    )
    if (baseline === undefined) return 'instruction-change-is-not-append-only'
    const [baselineArchive, candidateArchive] = await Promise.all([
      assembleSealedSkillBundleArchive(baseline.files),
      this.options.candidates.resolveExistingBundle(candidate),
    ])
    if (baseline.manifest.id !== candidate.baseline.id
      || baseline.manifest.workspaceId !== candidate.workspaceId
      || baseline.manifest.skillName !== candidate.skillName
      || baseline.manifest.bundle.artifactDigest !== candidate.baseline.artifactDigest
      || baseline.manifest.bundle.treeHash !== candidate.baseline.treeHash
      || baseline.manifest.bundle.fileCount !== baselineArchive.files.length
      || baseline.manifest.bundle.totalBytes !== baselineArchive.totalBytes
      || baseline.manifest.bundle.hasExecutableFiles !== false
      || baseline.manifest.releaseAuthority !== 'none'
      || baselineArchive.artifactDigest !== candidate.baseline.artifactDigest
      || baselineArchive.treeHash !== candidate.baseline.treeHash
      || candidateArchive.artifactDigest !== candidate.version.artifactDigest
      || candidateArchive.treeHash !== candidate.version.treeHash
      || candidate.diff.changedPaths.length !== 1
      || candidate.diff.changedPaths[0] !== 'SKILL.md'
      || candidate.diff.addedPaths.length !== 0
      || candidate.package.hasExecutableFiles !== false
      || candidate.permissions.executableContentChanged !== false) {
      return 'instruction-change-is-not-append-only'
    }
    const baselineFiles = new Map(baselineArchive.files.map(file => [file.path, file]))
    const candidateFiles = new Map(candidateArchive.files.map(file => [file.path, file]))
    if (baselineFiles.size !== candidateFiles.size
      || [...baselineFiles].some(([path, file]) => {
        const changed = candidateFiles.get(path)
        return changed === undefined
          || changed.mode !== file.mode
          || (path !== 'SKILL.md' && !changed.content.equals(file.content))
      })) {
      return 'instruction-change-is-not-append-only'
    }
    const baselineSkillBytes = baselineFiles.get('SKILL.md')?.content
    const candidateSkillBytes = candidateFiles.get('SKILL.md')?.content
    if (baselineSkillBytes === undefined
      || candidateSkillBytes === undefined
      || candidateSkillBytes.byteLength <= baselineSkillBytes.byteLength
      || candidateSkillBytes.byteLength - baselineSkillBytes.byteLength > MAX_AUTOMATIC_APPEND_BYTES
      || !candidateSkillBytes.subarray(0, baselineSkillBytes.byteLength).equals(baselineSkillBytes)) {
      return 'instruction-change-is-not-append-only'
    }
    const baselineSkill = decodeCanonicalUtf8(baselineSkillBytes)
    const candidateSkill = decodeCanonicalUtf8(candidateSkillBytes)
    const impact = projectCandidateImpact(baselineSkill, [{ path: 'SKILL.md', content: candidateSkill }])
    if (impact.scope !== 'append-only-skill') return 'instruction-change-is-not-append-only'
    if (impact.indicators.length > 0) return 'instruction-change-has-protected-effects'
    return undefined
  }

  private async rejectNow(
    workspaceId: string,
    candidateId: string,
    note: string,
  ): Promise<ExistingSkillReleaseDecision> {
    const normalizedNote = normalizeNote(note)
    const prior = this.options.decisions.get(candidateId)
    if (prior?.status === 'approved') throw new Error('approved existing Skill Candidate cannot be rejected')
    if (prior?.status === 'rejected') return prior
    const candidates = this.options.candidates.listExistingCandidates(workspaceId)
      .filter(candidate => candidate.id === candidateId && candidate.workspaceId === workspaceId)
    if (candidates.length !== 1) throw releaseBlocked(candidates.length === 0 ? 'candidate-not-found' : 'candidate-ambiguous')
    const candidate = candidates[0]!
    const evidenceHash = candidateOnlyEvidenceHash(candidate)
    const decision = createDecision({
      candidate,
      status: 'rejected',
      note: normalizedNote,
      decidedAt: new Date(this.options.now?.() ?? Date.now()).toISOString(),
      evidenceHash,
    })
    return (await this.options.decisions.record(decision)).decision
  }

  private async promoteNow(
    workspaceId: string,
    candidateId: string,
    automaticPolicy?: ExistingSkillAutomaticPromotionPolicy,
  ): Promise<{ readonly previousId: string | undefined; readonly generation: CapabilityGeneration }> {
    const decision = this.options.decisions.get(candidateId)
    if (decision?.status !== 'approved' || decision.generationId === undefined) {
      throw releaseBlocked('release-decision-evidence-mismatch')
    }
    const resolved = await this.resolveEvidence(workspaceId, candidateId)
    if ('blocked' in resolved) throw releaseBlocked(resolved.blocked.reason)
    const { evidence } = resolved
    if (!decisionMatches(decision, evidence)) throw releaseBlocked('release-decision-evidence-mismatch')
    const generation = this.options.store.getGeneration(decision.generationId)
    if (generation === undefined
      || generation.workspaceId !== workspaceId
      || generation.compositionFingerprint !== evidence.evidenceHash
      || !generationContainsEvidence(generation, evidence)) {
      throw releaseBlocked('release-decision-evidence-mismatch')
    }
    await this.options.bundles.providerFor(generation)
    const active = this.options.store.getActiveGeneration(workspaceId)
    if (active?.id === generation.id) {
      return { previousId: generation.parentId, generation }
    }
    if (active?.id !== generation.parentId) {
      throw new Error('existing Skill release blocked: active-parent-mismatch')
    }
    if (automaticPolicy !== undefined && this.options.isPaused!(workspaceId)) {
      throw new AutomaticPromotionPausedError()
    }
    return this.options.store.promoteGeneration(workspaceId, generation.id, {
      authority: 'existing-skill-release',
      candidateId: evidence.candidate.id,
      releaseDecisionId: decision.id,
    })
  }

  private async resolveEvidence(
    workspaceId: string,
    candidateId: string,
  ): Promise<{ readonly evidence: ExactReleaseEvidence } | { readonly blocked: ExistingSkillReleaseEligibility & { status: 'blocked' } }> {
    const candidates = this.options.candidates.listExistingCandidates(workspaceId)
      .filter(candidate => candidate.id === candidateId && candidate.workspaceId === workspaceId)
    if (candidates.length !== 1) {
      return { blocked: blocked(candidateId, candidates.length === 0 ? 'candidate-not-found' : 'candidate-ambiguous') }
    }
    const candidate = candidates[0]!
    const [admissionScan, holdoutScan, retentionScan] = await Promise.all([
      this.options.admissions.scan(workspaceId),
      this.options.holdouts.scan(workspaceId),
      this.options.retentions.scan(workspaceId),
    ])
    if (admissionScan.configuredPolicyCount < 1 || admissionScan.warningCount !== 0) {
      return { blocked: blocked(candidateId, 'admission-evidence-invalid') }
    }
    const admissions = admissionScan.results.filter(value => value.candidateId === candidateId)
    if (admissions.length !== 1) return { blocked: blocked(candidateId, 'admission-evidence-invalid') }
    if (admissions[0]!.status !== 'qualified-for-holdout') {
      return { blocked: blocked(candidateId, 'admission-not-qualified') }
    }
    if (holdoutScan.configuredPolicyCount < 1 || holdoutScan.warningCount !== 0) {
      return { blocked: blocked(candidateId, 'holdout-evidence-invalid') }
    }
    const holdouts = holdoutScan.results.filter(value => value.candidateId === candidateId)
    if (holdouts.length !== 1) return { blocked: blocked(candidateId, 'holdout-evidence-invalid') }
    if (holdouts[0]!.status !== 'complete' || holdouts[0]!.verdict !== 'improved') {
      return { blocked: blocked(candidateId, 'holdout-not-improved') }
    }
    if (retentionScan.configuredPolicyCount < 1 || retentionScan.warningCount !== 0) {
      return { blocked: blocked(candidateId, 'retention-evidence-invalid') }
    }
    const retentions = retentionScan.results.filter(value => value.candidateId === candidateId)
    if (retentions.length !== 1) return { blocked: blocked(candidateId, 'retention-evidence-invalid') }
    if (retentions[0]!.status !== 'complete' || retentions[0]!.verdict !== 'retained') {
      return { blocked: blocked(candidateId, 'retention-not-retained') }
    }
    let lineage: ExistingSkillCandidateLineage
    try {
      lineage = createExistingSkillCandidateLineage(
        candidate,
        admissions[0]!,
        holdouts[0]!,
        retentions[0]!,
      )
    } catch {
      return { blocked: blocked(candidateId, 'retention-evidence-invalid') }
    }
    return { evidence: Object.freeze({
      candidate,
      admission: admissions[0]!,
      holdout: holdouts[0]!,
      retention: retentions[0]!,
      lineage,
      evidenceHash: sha256Json(lineage),
    }) }
  }

  private enqueue<T>(candidateId: string, action: () => Promise<T>): Promise<T> {
    const prior = this.actionTails.get(candidateId) ?? Promise.resolve()
    const result = prior.then(action, action)
    const tail = result.then(() => {}, () => {})
    this.actionTails.set(candidateId, tail)
    void tail.finally(() => {
      if (this.actionTails.get(candidateId) === tail) this.actionTails.delete(candidateId)
    })
    return result
  }
}

/**
 * Thin native Jobs adapter. Durable Candidates, evaluation results, release
 * decisions, and the Generation pointer remain the restart queue and state;
 * this class owns no scheduler database or alternate runtime.
 */
export class ExistingSkillAutomaticPromotionScheduler {
  private readonly release: Pick<ExistingSkillRelease, 'reconcileAutomatic'>
  private readonly workspaces: ReadonlySet<string>
  private readonly pending = new Set<string>()
  private readonly active = new Set<string>()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(
    release: Pick<ExistingSkillRelease, 'reconcileAutomatic'>,
    workspaceIds: readonly string[],
  ) {
    this.release = release
    this.workspaces = new Set(workspaceIds)
  }

  attachJobs(jobs: Pick<JobRegistry, 'start'>): () => void {
    if (this.jobs !== undefined) throw new Error('existing Skill automatic promotion Jobs seam is already attached')
    this.jobs = jobs
    for (const workspaceId of this.workspaces) this.observe(workspaceId)
    return () => {
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  observe(workspaceId: string): void {
    if (!this.workspaces.has(workspaceId)) return
    this.pending.add(workspaceId)
    this.schedule(workspaceId)
  }

  private schedule(workspaceId: string): void {
    const jobs = this.jobs
    if (jobs === undefined || !this.pending.has(workspaceId) || this.active.has(workspaceId)) return
    this.pending.delete(workspaceId)
    this.active.add(workspaceId)
    const controller = new AbortController()
    try {
      jobs.start({
        kind: 'evolution',
        label: 'existing Skill low-risk automatic promotion',
        outputLimitBytes: 2_048,
        run: () => {
          const task = this.release.reconcileAutomatic(workspaceId, { signal: controller.signal })
          return {
            cancel: (reason?: string) => controller.abort(
              new Error(reason ?? 'existing Skill automatic promotion cancelled'),
            ),
            done: task.then(scan => ({
              status: controller.signal.aborted ? 'killed' as const : 'completed' as const,
              detail: controller.signal.aborted
                ? errorDetail(controller.signal.reason)
                : `promoted:${scan.promotedCount};review-required:${scan.reviewRequiredCount};warnings:${scan.warningCount}`,
              ...controller.signal.aborted ? {} : { output: JSON.stringify({
                  configuredPolicyCount: scan.configuredPolicyCount,
                  scannedCandidateCount: scan.scannedCandidateCount,
                  promotedCount: scan.promotedCount,
                  reviewRequiredCount: scan.reviewRequiredCount,
                  warningCount: scan.warningCount,
                }) },
            }), (error: unknown) => ({
              status: controller.signal.aborted ? 'killed' as const : 'failed' as const,
              detail: errorDetail(controller.signal.aborted ? controller.signal.reason : error),
            })).finally(() => {
              this.active.delete(workspaceId)
              this.schedule(workspaceId)
            }),
          }
        },
      })
    } catch {
      this.active.delete(workspaceId)
      this.pending.add(workspaceId)
    }
  }
}

const decisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('existing-skill-release-decision-v1'),
  id: z.string().regex(HASH),
  candidateId: z.string().regex(HASH),
  workspaceId: z.uuid(),
  skillName: z.string().regex(PUBLIC_ID),
  status: z.enum(['approved', 'rejected']),
  actor: z.enum(['human', 'automatic-clear-instruction-v2']),
  automaticPolicyId: z.string().regex(PUBLIC_ID).optional(),
  decisionNote: z.string().min(1).max(MAX_NOTE_BYTES),
  decidedAt: z.iso.datetime({ offset: true }),
  evidenceHash: z.string().regex(HASH),
  admissionId: z.string().regex(HASH).optional(),
  holdoutEvaluationId: z.string().regex(HASH).optional(),
  retentionEvaluationId: z.string().regex(HASH).optional(),
  generationId: z.string().regex(HASH).optional(),
}).superRefine((decision, context) => {
  const evidenceIds = decision.admissionId !== undefined
    && decision.holdoutEvaluationId !== undefined
    && decision.retentionEvaluationId !== undefined
  if (decision.status === 'approved' && (!evidenceIds || decision.generationId === undefined)) {
    context.addIssue({ code: 'custom', message: 'approved existing Skill decision omits release evidence' })
  }
  if (decision.status === 'rejected'
    && (decision.admissionId !== undefined
      || decision.holdoutEvaluationId !== undefined
      || decision.retentionEvaluationId !== undefined
      || decision.generationId !== undefined)) {
    context.addIssue({ code: 'custom', message: 'rejected existing Skill decision carries release authority' })
  }
  if ((decision.actor === 'human') === (decision.automaticPolicyId !== undefined)) {
    context.addIssue({ code: 'custom', message: 'existing Skill automatic policy identity does not match its actor' })
  }
  if (decision.actor === 'automatic-clear-instruction-v2' && decision.status !== 'approved') {
    context.addIssue({ code: 'custom', message: 'automatic existing Skill decisions may only approve exact evidence' })
  }
})

const releaseDomainSpec = defineDomain({
  name: 'evoforge_existing_skill_release',
  version: 1,
  tables: {
    decisions: domainTable<string, ExistingSkillReleaseDecision>(decisionSchema),
  },
})

type ExistingSkillReleaseDomain = Domain<typeof releaseDomainSpec>

class DomainExistingSkillReleaseStore implements ExistingSkillReleaseStore {
  private readonly domain: ExistingSkillReleaseDomain
  private writeTail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>

  constructor(domain: ExistingSkillReleaseDomain) {
    this.domain = domain
  }

  get(candidateId: string): ExistingSkillReleaseDecision | undefined {
    const value = this.domain.table('decisions').get(candidateId)
    return value === undefined ? undefined : immutableCopy(value)
  }

  list(workspaceId?: string): ExistingSkillReleaseDecision[] {
    return [...this.domain.table('decisions').entries()]
      .map(([, value]) => value)
      .filter(value => workspaceId === undefined || value.workspaceId === workspaceId)
      .sort((left, right) => left.decidedAt.localeCompare(right.decidedAt) || left.id.localeCompare(right.id))
      .map(immutableCopy)
  }

  record(decision: ExistingSkillReleaseDecision): Promise<{
    readonly created: boolean
    readonly decision: ExistingSkillReleaseDecision
  }> {
    const result = this.writeTail.then(async () => {
      const exact = parseDecision(decision)
      const table = this.domain.table('decisions')
      const prior = table.get(exact.candidateId)
      if (prior !== undefined) {
        if (!decisionEquals(prior, exact)) throw new Error('existing Skill release decision is immutable')
        return { created: false, decision: immutableCopy(prior) }
      }
      await table.put(exact.candidateId, exact)
      return { created: true, decision: immutableCopy(exact) }
    })
    this.writeTail = result.then(() => {}, () => {})
    return result
  }

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(() => this.domain.close())
    return this.closing
  }
}

export async function openExistingSkillReleaseStore(
  facility: DomainFacility,
): Promise<ExistingSkillReleaseStore> {
  return new DomainExistingSkillReleaseStore(await facility.open(releaseDomainSpec))
}

function replaceExactParent(
  activeArtifacts: readonly SkillGenerationArtifact[],
  evidence: ExactReleaseEvidence,
): SkillGenerationArtifact[] {
  const sameName = activeArtifacts.filter(artifact => artifact.name === evidence.candidate.skillName)
  if (sameName.length > 1) throw new Error('existing Skill release blocked: active-parent-ambiguous')
  if (sameName.length === 1
    && (sameName[0]!.kind !== 'skill-bundle'
      || sameName[0]!.artifactDigest !== evidence.candidate.baseline.artifactDigest
      || sameName[0]!.treeHash !== evidence.candidate.baseline.treeHash)) {
    throw new Error('existing Skill release blocked: active-parent-mismatch')
  }
  return activeArtifacts.filter(artifact => artifact.name !== evidence.candidate.skillName)
}

function generationContainsEvidence(
  generation: CapabilityGeneration,
  evidence: ExactReleaseEvidence,
): boolean {
  const matches = generation.artifacts.filter(artifact => artifact.name === evidence.candidate.skillName)
  if (matches.length !== 1 || matches[0]!.kind !== 'skill-bundle') return false
  try {
    const lineage = parseExistingSkillCandidateLineage(matches[0]!.lineage)
    return canonicalJson(lineage) === canonicalJson(evidence.lineage)
      && matches[0]!.artifactDigest === evidence.candidate.version.artifactDigest
      && matches[0]!.treeHash === evidence.candidate.version.treeHash
  } catch {
    return false
  }
}

function requireArchive(candidate: ExistingSkillCandidate, archive: AssembledSkillBundleArchive): void {
  if (archive.format !== 'tar.gz'
    || archive.artifactDigest !== candidate.version.artifactDigest
    || archive.treeHash !== candidate.version.treeHash
    || archive.files.length !== candidate.package.fileCount
    || archive.totalBytes !== candidate.package.totalBytes
    ) {
    throw new Error('existing Skill release archive does not match its exact Candidate')
  }
}

function requirePublishedGeneration(generation: CapabilityGeneration, input: GenerationInput): void {
  const { id: _id, schemaVersion: _schemaVersion, ...content } = generation
  if (!HASH.test(generation.id)
    || generation.schemaVersion !== 2
    || canonicalJson(content) !== canonicalJson(input)) {
    throw new Error('existing Skill publisher returned a conflicting Generation')
  }
}

function exactFinishedAt(retention: ExistingSkillRetentionEvaluationRunView): number {
  const value = retention.finishedAt === undefined ? Number.NaN : Date.parse(retention.finishedAt)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('existing Skill retained evidence has no stable completion time')
  }
  return value
}

function exactEligibility(
  evidence: ExactReleaseEvidence,
  status: 'eligible' | 'approved',
  generationId?: string,
): ExistingSkillReleaseEligibility {
  return Object.freeze({
    status,
    reason: 'exact-existing-skill-evidence-retained' as const,
    candidateId: evidence.candidate.id,
    admissionId: evidence.admission.id,
    holdoutEvaluationId: evidence.holdout.id,
    retentionEvaluationId: evidence.retention.id,
    ...generationId === undefined ? {} : { generationId },
  })
}

function blocked(
  candidateId: string,
  reason: Exclude<ExistingSkillReleaseReason, 'exact-existing-skill-evidence-retained'>,
): ExistingSkillReleaseEligibility & { status: 'blocked' } {
  return Object.freeze({ status: 'blocked', reason, candidateId })
}

function releaseBlocked(reason: string): Error {
  return new Error(`existing Skill release blocked: ${reason}`)
}

function normalizeNote(note: string): string {
  const normalized = note.trim()
  if (normalized.length === 0 || Buffer.byteLength(normalized) > MAX_NOTE_BYTES) {
    throw new Error('existing Skill release decision note must be 1-2048 UTF-8 bytes')
  }
  return normalized
}

function createDecision(input: {
  readonly candidate: ExistingSkillCandidate
  readonly status: 'approved' | 'rejected'
  readonly note: string
  readonly decidedAt: string
  readonly evidenceHash: string
  readonly admissionId?: string
  readonly holdoutEvaluationId?: string
  readonly retentionEvaluationId?: string
  readonly generationId?: string
  readonly actor?: ExistingSkillReleaseDecision['actor']
  readonly automaticPolicyId?: string
}): ExistingSkillReleaseDecision {
  const content = {
    kind: 'existing-skill-release-decision-v1' as const,
    candidateId: input.candidate.id,
    workspaceId: input.candidate.workspaceId,
    skillName: input.candidate.skillName,
    status: input.status,
    actor: input.actor ?? 'human',
    ...input.automaticPolicyId === undefined ? {} : { automaticPolicyId: input.automaticPolicyId },
    decisionNote: input.note,
    decidedAt: input.decidedAt,
    evidenceHash: input.evidenceHash,
    ...input.admissionId === undefined ? {} : { admissionId: input.admissionId },
    ...input.holdoutEvaluationId === undefined ? {} : { holdoutEvaluationId: input.holdoutEvaluationId },
    ...input.retentionEvaluationId === undefined ? {} : { retentionEvaluationId: input.retentionEvaluationId },
    ...input.generationId === undefined ? {} : { generationId: input.generationId },
  }
  return parseDecision({ schemaVersion: 1, id: sha256Json(content), ...content })
}

function automaticScan(
  configuredPolicyCount: number,
  scannedCandidateCount: number,
  results: readonly ExistingSkillAutomaticPromotionResult[],
  warningCount = 0,
): ExistingSkillAutomaticPromotionScan {
  return Object.freeze({
    configuredPolicyCount,
    scannedCandidateCount,
    promotedCount: results.filter(result => result.status === 'promoted').length,
    reviewRequiredCount: results.filter(result => result.status === 'review-required').length,
    warningCount,
    results: Object.freeze([...results]),
  })
}

function automaticPaused(candidateId: string): ExistingSkillAutomaticPromotionResult {
  return Object.freeze({
    candidateId,
    status: 'paused',
    reason: 'workspace-paused',
  })
}

function automaticStatusScan(
  configuredPolicyCount: number,
  scannedCandidateCount: number,
  results: readonly ExistingSkillAutomaticPromotionStatus[],
  warningCount = 0,
): ExistingSkillAutomaticPromotionStatusScan {
  return Object.freeze({
    configuredPolicyCount,
    scannedCandidateCount,
    warningCount,
    results: Object.freeze([...results]),
  })
}

function decodeCanonicalUtf8(content: Buffer): string {
  const text = content.toString('utf8')
  if (!Buffer.from(text).equals(content) || text.includes('\0') || /\r(?!\n)/u.test(text)) {
    throw new Error('automatic existing Skill instruction is not canonical UTF-8 text')
  }
  return text
}

function automaticUsageDoesNotRegress(evidence: {
  readonly modelCalls?: { readonly baseline: number; readonly candidate: number }
  readonly usage?: {
    readonly baseline: Record<string, number | undefined>
    readonly candidate: Record<string, number | undefined>
  }
} | undefined): boolean {
  if (evidence === undefined) return false
  if (evidence.modelCalls === undefined && evidence.usage === undefined) return true
  if (evidence.modelCalls === undefined || evidence.usage === undefined) return false
  if (evidence.modelCalls.candidate > evidence.modelCalls.baseline) return false
  const noIncrease = ['inputTokens', 'outputTokens', 'cacheWriteTokens', 'reasoningTokens']
    .every(key => metricAtMost(evidence.usage!.candidate[key], evidence.usage!.baseline[key]))
  return noIncrease
    && metricAtLeast(evidence.usage.candidate.cacheReadTokens, evidence.usage.baseline.cacheReadTokens)
}

function metricAtMost(candidate: number | undefined, baseline: number | undefined): boolean {
  if (candidate === undefined || baseline === undefined) return candidate === baseline
  return candidate <= baseline
}

function metricAtLeast(candidate: number | undefined, baseline: number | undefined): boolean {
  if (candidate === undefined || baseline === undefined) return candidate === baseline
  return candidate >= baseline
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class AutomaticPromotionPausedError extends Error {
  constructor() {
    super('automatic existing Skill promotion paused')
  }
}

function parseDecision(value: unknown): ExistingSkillReleaseDecision {
  const decision = decisionSchema.parse(value)
  const { schemaVersion: _schemaVersion, id: _id, ...content } = decision
  if (decision.id !== sha256Json(content)) throw new Error('existing Skill release decision id is invalid')
  return immutableCopy(decision)
}

function decisionMatches(
  decision: ExistingSkillReleaseDecision,
  evidence: ExactReleaseEvidence,
): boolean {
  return decision.candidateId === evidence.candidate.id
    && decision.workspaceId === evidence.candidate.workspaceId
    && decision.skillName === evidence.candidate.skillName
    && decision.evidenceHash === evidence.evidenceHash
    && decision.admissionId === evidence.admission.id
    && decision.holdoutEvaluationId === evidence.holdout.id
    && decision.retentionEvaluationId === evidence.retention.id
    && (decision.status !== 'approved' || decision.generationId !== undefined)
}

function candidateOnlyEvidenceHash(candidate: ExistingSkillCandidate): string {
  return sha256Json({ candidateId: candidate.id, contentHash: candidate.contentHash })
}

function decisionEquals(left: ExistingSkillReleaseDecision, right: ExistingSkillReleaseDecision): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value !== 'object') throw new Error(`unsupported release value: ${typeof value}`)
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
