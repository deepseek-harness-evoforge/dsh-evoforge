import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { AutoPromotionPolicy } from './auto-promotion.ts'
import { sha256 } from './hash.ts'
import type { RetentionEvidenceGate } from './retention-evidence-index.ts'
import type { RetentionOptions, RetentionResult } from './retention.ts'
import type { ReviewInbox } from './review-inbox.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const TARGET_ID = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/
const MAX_TARGETS = 20

export interface AutomaticRetentionTargetConfig {
  readonly id: string
  readonly skill: string
  readonly casePackDir: string
  readonly casePackHash: string
  readonly runRoot: string
}

export interface AutomaticRetentionResult {
  readonly evaluated: Array<{
    candidateId: string
    targetId: string
    status: RetentionResult['status']
  }>
  readonly warnings: string[]
}

export interface AutomaticRetentionOptions {
  readonly evidence: RetentionEvidenceGate
  readonly inbox: Pick<ReviewInbox, 'scanAll'>
  readonly preflight: Pick<AutoPromotionPolicy, 'evaluate'>
  readonly runner: (options: RetentionOptions) => Promise<RetentionResult>
  readonly targets: AutomaticRetentionTargetConfig[]
}

/** Native Job cancellation suppresses a fresh automatic attempt for this DSH process. */
export class AutomaticRetentionCancelled extends Error {
  override readonly name = 'AutomaticRetentionCancelled'
}

/** Run one configured prior-capability check before the existing automatic release policy. */
export class AutomaticRetentionService {
  private readonly options: AutomaticRetentionOptions
  private readonly targetsBySkill: ReadonlyMap<string, AutomaticRetentionTargetConfig>
  private readonly reportedWarnings = new Map<string, string>()
  private readonly suppressedCandidates = new Set<string>()

  constructor(options: AutomaticRetentionOptions) {
    assertAutomaticRetentionTargets(options.targets)
    this.options = options
    this.targetsBySkill = new Map(options.targets.map(target => [target.skill, target]))
  }

  async scanOnce(signal: AbortSignal): Promise<AutomaticRetentionResult> {
    const scan = await this.options.inbox.scanAll()
    const warnings = [...scan.warnings]
    const evaluated: AutomaticRetentionResult['evaluated'] = []
    for (const candidate of scan.candidates) {
      signal.throwIfAborted()
      if (this.suppressedCandidates.has(candidate.id)) continue
      if (candidate.status === 'rejected'
        || candidate.activatedAt !== undefined
        || (candidate.status === 'approved' && candidate.decisionActor !== 'auto-clear-instruction-v1')) {
        continue
      }
      const target = this.targetsBySkill.get(candidate.skillName)
      if (target === undefined) {
        this.reportedWarnings.delete(candidate.id)
        continue
      }
      const preflight = await this.options.preflight.evaluate(candidate)
      if (!preflight.eligible) {
        this.reportedWarnings.delete(candidate.id)
        continue
      }
      const evidence = await this.options.evidence.evaluate(candidate)
      if (evidence.status !== 'missing' || evidence.warnings.length > 0) {
        this.reportedWarnings.delete(candidate.id)
        continue
      }
      const runRoot = await realpath(target.runRoot)
      const launchId = sha256(JSON.stringify({
        candidateId: candidate.id,
        casePackHash: target.casePackHash,
        targetId: target.id,
      }))
      const outputDir = join(runRoot, launchId)
      if (await pathExists(outputDir)) {
        this.report(
          candidate.id,
          'automatic Retention has an existing non-terminal output; human review is required',
          warnings,
        )
        break
      }
      let result: RetentionResult
      try {
        result = await this.options.runner({
          casePackDir: target.casePackDir,
          expectedCasePackHash: target.casePackHash,
          outputDir,
          signal,
          sourceRunDir: candidate.outputDir,
        })
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error
        if (error instanceof AutomaticRetentionCancelled) {
          this.suppressedCandidates.add(candidate.id)
          this.report(
            candidate.id,
            'automatic Retention was cancelled and is suppressed for this process',
            warnings,
          )
          break
        }
        this.report(
          candidate.id,
          'automatic Retention execution did not reach a terminal report',
          warnings,
        )
        break
      }
      evaluated.push({ candidateId: candidate.id, targetId: target.id, status: result.status })
      this.reportedWarnings.delete(candidate.id)
      break
    }
    return { evaluated, warnings }
  }

  private report(key: string, message: string, warnings: string[]): void {
    if (this.reportedWarnings.get(key) === message) return
    this.reportedWarnings.set(key, message)
    warnings.push(message)
  }
}

/** Reject ambiguous or mutable automatic cost policy before native Jobs is composed. */
export function assertAutomaticRetentionTargets(targets: AutomaticRetentionTargetConfig[]): void {
  if (targets.length === 0 || targets.length > MAX_TARGETS) {
    throw new Error(`automatic Retention requires 1-${MAX_TARGETS} targets`)
  }
  if (targets.some(target => !CONTENT_ID.test(target.casePackHash))) {
    throw new Error('automatic Retention Case Pack hashes must be exact')
  }
  if (targets.some(target => !isAbsolute(target.casePackDir) || !isAbsolute(target.runRoot))) {
    throw new Error('automatic Retention paths must be absolute')
  }
  if (targets.some(target => !TARGET_ID.test(target.id))
    || new Set(targets.map(target => target.id)).size !== targets.length) {
    throw new Error('automatic Retention target ids must be stable public ids')
  }
  if (targets.some(target => target.skill.trim() === '')) {
    throw new Error('automatic Retention target Skills must not be empty')
  }
  if (new Set(targets.map(target => target.skill)).size !== targets.length) {
    throw new Error('automatic Retention permits exactly one target per Skill')
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
