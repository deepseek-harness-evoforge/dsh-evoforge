import { dirname, isAbsolute, resolve } from 'node:path'
import type {
  AutomaticEvolutionBudget,
  AutomaticEvolutionBudgetSnapshot,
  AutomaticEvolutionBudgetTarget,
} from './automatic-evolution-budget.ts'
import type { EvaluatorDraftInbox, EvaluatorDraftReceipt } from './evaluator-draft-inbox.ts'
import type { EvolutionStore } from './generation-store.ts'
import type { FeedbackSignalStore } from './feedback-signal-monitor.ts'
import {
  automaticEvolutionInflightStatus,
  type AutomaticEvolutionInflightSource,
  type AutomaticEvolutionInflightStatus,
} from './automatic-evolution-inflight.ts'

const MAX_TARGETS = 20

export interface AutomaticEvaluatorDraftTarget {
  readonly id: string
  readonly workspaceId: string
  readonly skill: string
  readonly root: string
  readonly maxAttemptsPerUtcDay: number
}

export interface AutomaticEvaluatorDraftTargetReference {
  readonly target: string
  readonly maxAttemptsPerUtcDay?: number
}

export interface AutomaticEvaluatorBudgetView extends AutomaticEvolutionBudgetSnapshot {
  readonly status: 'ready' | 'unknown'
}

export interface AutomaticEvaluatorBudgetStatus {
  readonly targets: AutomaticEvaluatorBudgetView[]
  readonly warningCount: number
}

export interface AutomaticEvaluatorDraftResult {
  readonly authored: Array<{
    readonly signalId: string
    readonly targetId: string
    readonly draftStatus: EvaluatorDraftReceipt['draftStatus']
  }>
  readonly warnings: string[]
}

interface AutomaticEvaluatorDraftOptions {
  readonly evolution: Pick<EvolutionStore, 'getGeneration'>
  readonly evaluator: Pick<EvaluatorDraftInbox, 'available' | 'author'>
  readonly signals: Pick<FeedbackSignalStore, 'list'>
  readonly targets: AutomaticEvaluatorDraftTarget[]
  readonly inflight: readonly AutomaticEvolutionInflightSource[]
  readonly budget: Pick<AutomaticEvolutionBudget, 'reserve' | 'inspect'>
  readonly now?: () => number
}

/** Turn one unambiguous explicit correction into an inactive evaluator Draft per scan. */
export class AutomaticEvaluatorDraftService {
  private readonly options: AutomaticEvaluatorDraftOptions
  private readonly attemptedSignals = new Set<string>()
  private readonly deferredUntil = new Map<string, number>()
  private readonly inflightDeferrals = new Map<string, Exclude<AutomaticEvolutionInflightStatus, 'clear'>>()
  private readonly now: () => number

  constructor(options: AutomaticEvaluatorDraftOptions) {
    assertAutomaticEvaluatorDraftTargets(options.targets)
    this.options = options
    this.now = options.now ?? Date.now
  }

  async scanOnce(workspaceId: string): Promise<AutomaticEvaluatorDraftResult> {
    const authored: AutomaticEvaluatorDraftResult['authored'] = []
    const warnings: string[] = []
    const blockedTargets = new Set<string>()
    if (!this.options.evaluator.available()) return { authored, warnings }
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
          'explicit feedback matches multiple automatic Evaluator Targets; choose one explicitly',
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
        reservation = await this.options.budget.reserve(budgetTarget(target), signal.id)
      } catch {
        this.attemptedSignals.add(signal.id)
        warnings.push(`automatic evolution budget is unavailable for Evaluator Target ${target.id}`)
        break
      }
      if (!reservation.allowed) {
        if (reservation.retryAt === undefined || reservation.retryAt <= now) {
          this.attemptedSignals.add(signal.id)
          warnings.push(`automatic evolution budget is unavailable for Evaluator Target ${target.id}`)
          break
        }
        this.deferredUntil.set(signal.id, reservation.retryAt)
        warnings.push(
          `automatic evolution budget exhausted for Evaluator Target ${target.id} until the next UTC day`,
        )
        break
      }
      this.attemptedSignals.add(signal.id)
      try {
        const receipt = await this.options.evaluator.author(target.workspaceId, signal.id, target.id)
        authored.push({
          signalId: signal.id,
          targetId: target.id,
          draftStatus: receipt.draftStatus,
        })
      } catch {
        warnings.push('Automatic Evaluator Draft did not reach a durable authoring receipt')
      }
      break
    }
    return { authored, warnings }
  }

  async budgetStatus(workspaceId?: string): Promise<AutomaticEvaluatorBudgetStatus> {
    const targets: AutomaticEvaluatorBudgetView[] = []
    let warningCount = 0
    for (const target of this.options.targets) {
      if (workspaceId !== undefined && target.workspaceId !== workspaceId) continue
      try {
        targets.push({
          ...await this.options.budget.inspect(budgetTarget(target)),
          status: 'ready',
        })
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

export function assertAutomaticEvaluatorDraftTargets(
  targets: AutomaticEvaluatorDraftTarget[],
): void {
  if (targets.length === 0 || targets.length > MAX_TARGETS) {
    throw new Error(`Automatic Evaluator Draft requires 1-${MAX_TARGETS} exact targets`)
  }
  if (targets.some(target => !isAbsolute(target.root))) {
    throw new Error('Automatic Evaluator Draft roots must be absolute')
  }
  if (targets.some(target => dirname(resolve(target.root)) === resolve(target.root))) {
    throw new Error('Automatic Evaluator Draft roots must not be filesystem roots')
  }
  if (targets.some(target => !Number.isInteger(target.maxAttemptsPerUtcDay)
    || target.maxAttemptsPerUtcDay < 1
    || target.maxAttemptsPerUtcDay > 20)) {
    throw new Error('Automatic Evaluator Draft daily attempt limits must be integers between 1 and 20')
  }
  if (targets.some(target => target.id.trim() === '' || target.skill.trim() === '')
    || new Set(targets.map(target => target.id)).size !== targets.length
    || new Set(targets.map(target => targetKey(target.workspaceId, target.skill))).size !== targets.length
    || new Set(targets.map(target => resolve(target.root))).size !== targets.length) {
    throw new Error('Automatic Evaluator Draft permits exactly one target per Workspace and Skill with unique ids and roots')
  }
}

export function assertAutomaticEvaluatorDraftSeparation(
  targets: readonly AutomaticEvaluatorDraftTarget[],
  automaticShadowSkills: ReadonlySet<string>,
): void {
  if (targets.some(target => automaticShadowSkills.has(targetKey(target.workspaceId, target.skill)))) {
    throw new Error(
      'one Skill cannot enable both Automatic Feedback Shadow and Automatic Evaluator Draft',
    )
  }
}

function budgetTarget(target: AutomaticEvaluatorDraftTarget): AutomaticEvolutionBudgetTarget {
  return {
    id: target.id,
    workspaceId: target.workspaceId,
    skill: target.skill,
    runRoot: target.root,
    maxAttemptsPerUtcDay: target.maxAttemptsPerUtcDay,
  }
}

function targetKey(workspaceId: string, skill: string): string {
  return `${workspaceId}\0${skill}`
}
