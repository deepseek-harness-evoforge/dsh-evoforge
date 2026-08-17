import { isAbsolute } from 'node:path'
import type {
  AutomaticEvolutionBudget,
  AutomaticEvolutionBudgetSnapshot,
} from './automatic-evolution-budget.ts'
import type { EvolutionStore } from './generation-store.ts'
import type { FeedbackSignalStore } from './feedback-signal-monitor.ts'
import type {
  FeedbackShadowExactTargetConfig,
  FeedbackShadowLauncher,
  FeedbackShadowLaunchReceipt,
} from './feedback-shadow-launcher.ts'
import {
  automaticEvolutionInflightStatus,
  type AutomaticEvolutionInflightSource,
  type AutomaticEvolutionInflightStatus,
} from './automatic-evolution-inflight.ts'
import { isWorkspaceId } from './workspace-identity.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const MAX_TARGETS = 20
export const DEFAULT_PENDING_REVIEW_AGE_HOURS = 7 * 24

export interface AutomaticFeedbackShadowTarget extends FeedbackShadowExactTargetConfig {
  readonly maxAttemptsPerUtcDay: number
  readonly maxPendingReviewAgeHours: number
}

export interface AutomaticFeedbackShadowTargetReference {
  readonly target: string
  readonly casePackHash: string
  readonly maxAttemptsPerUtcDay?: number
  readonly maxPendingReviewAgeHours?: number
}

export interface AutomaticFeedbackShadowOptions {
  readonly evolution: Pick<EvolutionStore, 'getGeneration'>
  readonly shadow: Pick<FeedbackShadowLauncher, 'available' | 'launchAutomaticExact'>
  readonly signals: Pick<FeedbackSignalStore, 'list'>
  readonly targets: AutomaticFeedbackShadowTarget[]
  readonly inflight: readonly AutomaticEvolutionInflightSource[]
  readonly budget: Pick<AutomaticEvolutionBudget, 'reserve' | 'inspect'>
  readonly now?: () => number
}

export interface AutomaticFeedbackBudgetView extends AutomaticEvolutionBudgetSnapshot {
  readonly status: 'ready' | 'unknown'
}

export interface AutomaticFeedbackBudgetStatus {
  readonly targets: AutomaticFeedbackBudgetView[]
  readonly warningCount: number
}

export interface AutomaticFeedbackShadowResult {
  readonly launched: Array<{
    signalId: string
    targetId: string
    runStatus: FeedbackShadowLaunchReceipt['runStatus']
  }>
  readonly warnings: string[]
}

/** Convert one unambiguous explicit correction into the existing exact Shadow path per scan. */
export class AutomaticFeedbackShadowService {
  private readonly options: AutomaticFeedbackShadowOptions
  private readonly attemptedSignals = new Set<string>()
  private readonly deferredUntil = new Map<string, number>()
  private readonly inflightDeferrals = new Map<string, Exclude<AutomaticEvolutionInflightStatus, 'clear'>>()
  private readonly now: () => number

  constructor(options: AutomaticFeedbackShadowOptions) {
    assertAutomaticFeedbackShadowTargets(options.targets)
    this.options = options
    this.now = options.now ?? Date.now
  }

  async scanOnce(workspaceId: string): Promise<AutomaticFeedbackShadowResult> {
    const launched: AutomaticFeedbackShadowResult['launched'] = []
    const warnings: string[] = []
    const blockedTargets = new Set<string>()
    if (!this.options.shadow.available()) return { launched, warnings }
    const signals = this.options.signals.list(workspaceId)
    const currentSignals = new Set(signals.map(signal => signal.id))
    for (const signalId of this.attemptedSignals) {
      if (!currentSignals.has(signalId)) this.attemptedSignals.delete(signalId)
    }
    for (const signalId of this.deferredUntil.keys()) {
      if (!currentSignals.has(signalId)) this.deferredUntil.delete(signalId)
    }
    const now = this.now()
    for (const signal of signals) {
      if (this.attemptedSignals.has(signal.id) || signal.generationId === undefined) continue
      const deferredUntil = this.deferredUntil.get(signal.id)
      if (deferredUntil !== undefined && now < deferredUntil) continue
      this.deferredUntil.delete(signal.id)
      const generation = this.options.evolution.getGeneration(signal.generationId)
      if (generation === undefined || generation.workspaceId !== signal.workspaceId) continue
      const skillNames = new Set(generation.artifacts.map(artifact => artifact.name))
      const matches = this.options.targets.filter(target => target.workspaceId === workspaceId
        && target.workspaceId === signal.workspaceId
        && skillNames.has(target.skill))
      if (matches.length === 0) continue
      if (matches.length > 1) {
        this.attemptedSignals.add(signal.id)
        warnings.push(
          'explicit feedback matches multiple automatic Shadow Targets; choose one explicitly',
        )
        break
      }
      const target = matches[0]!
      const scopedSkill = targetKey(target.workspaceId, target.skill)
      if (blockedTargets.has(scopedSkill)) continue
      const inflight = await automaticEvolutionInflightStatus(
        target.workspaceId,
        target.skill,
        signal.id,
        this.options.inflight,
      )
      if (inflight !== 'clear') {
        blockedTargets.add(scopedSkill)
        const previous = this.inflightDeferrals.get(scopedSkill)
        this.inflightDeferrals.set(scopedSkill, inflight)
        if (previous !== inflight) warnings.push(inflightWarning(target.skill, inflight))
        continue
      }
      this.inflightDeferrals.delete(scopedSkill)
      let reservation
      try {
        reservation = await this.options.budget.reserve(target, signal.id)
      } catch {
        this.attemptedSignals.add(signal.id)
        warnings.push(`automatic evolution budget is unavailable for Target ${target.id}`)
        break
      }
      if (!reservation.allowed) {
        if (reservation.retryAt === undefined || reservation.retryAt <= now) {
          this.attemptedSignals.add(signal.id)
          warnings.push(`automatic evolution budget is unavailable for Target ${target.id}`)
          break
        }
        this.deferredUntil.set(signal.id, reservation.retryAt)
        warnings.push(
          `automatic evolution budget exhausted for Target ${target.id} until the next UTC day`,
        )
        break
      }
      this.attemptedSignals.add(signal.id)
      try {
        const receipt = await this.options.shadow.launchAutomaticExact(signal.id, target)
        launched.push({ signalId: signal.id, targetId: target.id, runStatus: receipt.runStatus })
      } catch {
        warnings.push('automatic Feedback Shadow did not reach a durable launch receipt')
      }
      break
    }
    return { launched, warnings }
  }

  async budgetStatus(workspaceId?: string): Promise<AutomaticFeedbackBudgetStatus> {
    const targets: AutomaticFeedbackBudgetView[] = []
    let warningCount = 0
    for (const target of this.options.targets) {
      if (workspaceId !== undefined && target.workspaceId !== workspaceId) continue
      try {
        targets.push({ ...await this.options.budget.inspect(target), status: 'ready' })
      } catch {
        warningCount += 1
        targets.push({
          targetId: target.id,
          workspaceId: target.workspaceId,
          skillName: target.skill,
          utcDay: new Date(this.now()).toISOString().slice(0, 10),
          used: 0,
          limit: target.maxAttemptsPerUtcDay,
          remaining: 0,
          status: 'unknown',
        })
      }
    }
    return { targets, warningCount }
  }
}

function inflightWarning(
  skillName: string,
  status: Exclude<AutomaticEvolutionInflightStatus, 'clear'>,
): string {
  return status === 'busy'
    ? `automatic evolution deferred for Skill ${skillName} while prior work is unresolved`
    : `automatic evolution deferred because prior-work state is unavailable for Skill ${skillName}`
}

export function assertAutomaticFeedbackShadowTargets(
  targets: AutomaticFeedbackShadowTarget[],
): void {
  if (targets.length === 0 || targets.length > MAX_TARGETS) {
    throw new Error(`automatic Feedback Shadow requires 1-${MAX_TARGETS} exact targets`)
  }
  if (targets.some(target => !CONTENT_ID.test(target.casePackHash))) {
    throw new Error('automatic Feedback Shadow Case Pack hashes must be exact')
  }
  if (targets.some(target => !isAbsolute(target.casePackDir) || !isAbsolute(target.runRoot))) {
    throw new Error('automatic Feedback Shadow paths must be absolute')
  }
  if (targets.some(target => !Number.isInteger(target.maxAttemptsPerUtcDay)
    || target.maxAttemptsPerUtcDay < 1
    || target.maxAttemptsPerUtcDay > 20)) {
    throw new Error('automatic Feedback Shadow daily attempt limits must be integers between 1 and 20')
  }
  if (targets.some(target => !Number.isInteger(target.maxPendingReviewAgeHours)
      || target.maxPendingReviewAgeHours < 1
      || target.maxPendingReviewAgeHours > 2_160)) {
    throw new Error('automatic Feedback Shadow pending review ages must be integer hours between 1 and 2160')
  }
  if (targets.some(target => !isWorkspaceId(target.workspaceId)
      || target.id.trim() === '' || target.skill.trim() === '')
    || new Set(targets.map(target => target.id)).size !== targets.length) {
    throw new Error('automatic Feedback Shadow target identities must be unique and non-empty')
  }
  if (new Set(targets.map(target => targetKey(target.workspaceId, target.skill))).size !== targets.length) {
    throw new Error('automatic Feedback Shadow permits exactly one target per Workspace and Skill')
  }
}

function targetKey(workspaceId: string, skill: string): string {
  return `${workspaceId}\0${skill}`
}
