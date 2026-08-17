import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CandidatePublisher } from './candidate-publisher.ts'
import { projectCandidateImpact } from './candidate-impact.ts'
import type { EvolutionStore } from './generation-store.ts'
import type { GitSkillSource } from './git-skill-source.ts'
import { hashTree } from './hash.ts'
import type { ReviewCandidate, ReviewInbox } from './review-inbox.ts'
import type { RetentionEvidenceGate } from './retention-evidence-index.ts'
import { isWorkspaceId } from './workspace-identity.ts'

export const AUTO_PROMOTION_ACTOR = 'auto-clear-instruction-v1' as const
const MAX_APPEND_BYTES = 2_048
const allowedLimitations = new Set([
  'P0A.3 uses a keyless scripted model through one real assembled DSH path on macOS',
])

export interface AutoPromotionPolicyResult {
  eligible: boolean
  policyVersion: typeof AUTO_PROMOTION_ACTOR
  reasons: string[]
}

export interface AutoPromotionTarget {
  readonly workspaceId: string
  readonly skill: string
}

/** A deliberately narrow, deterministic policy for instruction-only clear wins. */
export class AutoPromotionPolicy {
  private readonly source: GitSkillSource
  private readonly store: EvolutionStore
  private readonly allowedTargets: ReadonlySet<string>
  private readonly retention: RetentionEvidenceGate | undefined

  constructor(
    source: GitSkillSource,
    store: EvolutionStore,
    allowedTargets: AutoPromotionTarget[],
    retention?: RetentionEvidenceGate,
  ) {
    const normalized = allowedTargets.map(target => ({
      workspaceId: target.workspaceId,
      skill: target.skill.trim(),
    }))
    const keys = normalized.map(target => targetKey(target.workspaceId, target.skill))
    if (normalized.length === 0
      || normalized.some(target => !isWorkspaceId(target.workspaceId) || target.skill === '')
      || new Set(keys).size !== keys.length) {
      throw new Error('automatic promotion requires unique native Workspace and Skill targets')
    }
    this.source = source
    this.store = store
    this.allowedTargets = new Set(keys)
    this.retention = retention
  }

  skills(workspaceId: string): string[] {
    if (!isWorkspaceId(workspaceId)) return []
    const prefix = `${workspaceId}\0`
    return [...this.allowedTargets]
      .filter(key => key.startsWith(prefix))
      .map(key => key.slice(prefix.length))
      .sort()
  }

  async evaluate(candidate: ReviewCandidate): Promise<AutoPromotionPolicyResult> {
    const reasons: string[] = []
    let retentionPassed = false
    if (!this.allowedTargets.has(targetKey(candidate.workspaceId, candidate.skillName))) {
      reasons.push('Workspace and Skill are not in the automatic allowlist')
    }
    if (candidate.recommendation !== 'promote') reasons.push('Shadow recommendation is not promote')
    if (!candidate.compositionStable) reasons.push('non-target composition is not explicitly stable')
    if (candidate.cost.trialCount < 4) reasons.push('fewer than four sealed Trial executions')
    if (candidate.cases.length === 0
      || !candidate.cases.some(item => item.baseline === 'fail' && item.candidate === 'pass')) {
      reasons.push('no sealed baseline-fail to Candidate-pass improvement')
    }
    if (candidate.cases.some(item => item.candidate !== 'pass'
      || item.totalChecks === 0 || item.passedChecks !== item.totalChecks)) {
      reasons.push('Candidate has a failing or incomplete retained check')
    }
    if (candidate.limitations.some(item => !allowedLimitations.has(item))) {
      reasons.push('evidence contains a limitation outside the automatic policy')
    }
    if (this.retention !== undefined) {
      try {
        const retention = await this.retention.evaluate(candidate)
        retentionPassed = retention.status === 'retained' && retention.warnings.length === 0
        if (retention.status !== 'retained') reasons.push(...retention.reasons)
        if (retention.warnings.length > 0) reasons.push(...retention.warnings)
      } catch {
        reasons.push('exact Retention evidence verification failed')
      }
    }
    if (candidate.changedFiles.length !== 1 || candidate.changedFiles[0] !== 'SKILL.md'
      || candidate.proposal.files.length !== 1 || candidate.proposal.files[0]?.path !== 'SKILL.md') {
      reasons.push('automatic policy permits only one SKILL.md change')
      return rejected(reasons)
    }

    try {
      const active = this.store.getActiveGeneration(candidate.workspaceId)
      const prior = active?.artifacts.find(artifact => artifact.name === candidate.skillName)
      if (active !== undefined && prior === undefined) {
        reasons.push('active Generation has no exact baseline artifact for the Skill')
        return rejected(reasons)
      }
      const base = await this.source.resolveArtifact(candidate.skillName, prior)
      if (await hashTree(base.resourceBase) !== candidate.baseTreeHash) {
        reasons.push('reviewed baseline no longer matches the exact Git Skill tree')
        return rejected(reasons)
      }
      const baseline = await readFile(join(base.resourceBase, 'SKILL.md'), 'utf8')
      const proposed = candidate.proposal.files[0].content
      if (!proposed.startsWith(baseline) || proposed.length === baseline.length) {
        reasons.push('SKILL.md change is not a non-empty append')
        return rejected(reasons)
      }
      const appended = proposed.slice(baseline.length)
      if (Buffer.byteLength(appended) > MAX_APPEND_BYTES) {
        reasons.push(`instruction append exceeds ${MAX_APPEND_BYTES} bytes`)
      }
      if (projectCandidateImpact(baseline, candidate.proposal.files).indicators.length > 0) {
        reasons.push('instruction append mentions a protected action, tool, permission, or external effect')
      }
    } catch (error) {
      reasons.push(`exact baseline verification failed: ${errorMessage(error)}`)
    }

    if (reasons.length > 0) return rejected(reasons)
    return {
      eligible: true,
      policyVersion: AUTO_PROMOTION_ACTOR,
      reasons: [retentionPassed
        ? 'sealed clear win; append-only instruction and exact prior capability retained'
        : 'sealed clear win; append-only instruction change has no protected-effect terms'],
    }
  }
}

function targetKey(workspaceId: string, skillName: string): string {
  return `${workspaceId}\0${skillName}`
}

export interface AutoPromotionServiceOptions {
  inbox: ReviewInbox
  policy: Pick<AutoPromotionPolicy, 'evaluate'>
  publisher: CandidatePublisher
  store: EvolutionStore
}

/** Recoverable resident bridge from policy-qualified evidence to future-session activation. */
export class AutoPromotionService {
  private readonly options: AutoPromotionServiceOptions
  private readonly reportedWarnings = new Map<string, string>()

  constructor(options: AutoPromotionServiceOptions) {
    this.options = options
  }

  async scanOnce(workspaceId: string): Promise<{ promoted: string[]; warnings: string[] }> {
    const scan = await this.options.inbox.scanAll()
    const warnings: string[] = []
    for (const warning of scan.warnings) this.report('inbox', warning, warnings)
    const promoted: string[] = []
    for (const candidate of scan.candidates) {
      if (candidate.workspaceId !== workspaceId) continue
      if (candidate.status === 'rejected'
        || candidate.activatedAt !== undefined
        || (candidate.status === 'approved' && candidate.decisionActor !== AUTO_PROMOTION_ACTOR)) {
        continue
      }
      try {
        const decision = await this.options.policy.evaluate(candidate)
        if (!decision.eligible) continue
        let generationId = candidate.generationId
        if (candidate.status === 'pending') {
          const approved = await this.options.inbox.approve(
            candidate.id,
            `Automatic policy ${decision.policyVersion}: ${decision.reasons.join('; ')}`,
            value => this.options.publisher.publish(value, { policyVersion: AUTO_PROMOTION_ACTOR }),
            { actor: AUTO_PROMOTION_ACTOR },
          )
          generationId = approved.generationId
        }
        if (generationId === undefined) throw new Error('automatic approval has no Generation id')
        await this.options.store.promoteGeneration(candidate.workspaceId, generationId)
        await this.options.inbox.markAutomaticActivated(candidate.id, generationId)
        promoted.push(generationId)
        this.reportedWarnings.delete(candidate.id)
      } catch (error) {
        this.report(candidate.id, errorMessage(error), warnings)
      }
    }
    return { promoted, warnings }
  }

  private report(key: string, message: string, warnings: string[]): void {
    const bounded = message.replaceAll(/[\r\n]+/g, ' ').slice(0, 500)
    if (this.reportedWarnings.get(key) === bounded) return
    this.reportedWarnings.set(key, bounded)
    warnings.push(bounded)
  }
}

function rejected(reasons: string[]): AutoPromotionPolicyResult {
  return { eligible: false, policyVersion: AUTO_PROMOTION_ACTOR, reasons }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
