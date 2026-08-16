import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeliveryOutcome, DeliveryOutcomeStore } from './delivery-outcome-monitor.ts'
import type { CapabilityGeneration, EvolutionStore } from './generation-store.ts'
import type { ReviewCandidate, ReviewInbox } from './review-inbox.ts'
import { writeDurableJson } from './shadow-run-state.ts'
import { AUTO_PROMOTION_ACTOR } from './auto-promotion.ts'

const hashPattern = /^[a-f0-9]{64}$/

export interface CanaryComparison {
  calibrationPassed: boolean
  parentPassed: boolean
  candidatePassed: boolean
  report: unknown
}

export type CanaryComparisonRunner = (
  input: {
    candidate: ReviewCandidate
    generation: CapabilityGeneration
    outcome: DeliveryOutcome
    signal: AbortSignal
  },
) => Promise<CanaryComparison>

export interface CanaryScanResult {
  kept: Array<{ outcomeId: string; generationId: string }>
  reviewed: Array<{ outcomeId: string; generationId: string; reason: string }>
  rolledBack: Array<{ outcomeId: string; previousId: string; activeId?: string }>
  warnings: string[]
}

interface CounterfactualCanaryOptions {
  inbox: Pick<ReviewInbox, 'scanAll'>
  outcomes: Pick<DeliveryOutcomeStore, 'list'>
  runner: CanaryComparisonRunner
  store: Pick<EvolutionStore, 'getActiveGeneration' | 'getGeneration' | 'rollbackGeneration'>
}

interface CanaryState {
  schemaVersion: 1
  outcomeId: string
  generationId: string
  parentId?: string
  phase: 'trial-running' | 'rollback-pending' | 'complete'
  decision?: 'keep' | 'review' | 'rollback'
  reason?: string
  comparison?: CanaryComparison
  previousId?: string
  activeId?: string
}

/**
 * Turn failed real-task triggers into a sealed retained-case release decision.
 * Callers only scan; matching, durability, retry fencing, and pointer safety stay inside.
 */
export class CounterfactualCanary {
  private readonly options: CounterfactualCanaryOptions
  private scanTail: Promise<CanaryScanResult> | undefined

  constructor(options: CounterfactualCanaryOptions) {
    this.options = options
  }

  scanOnce(signal: AbortSignal): Promise<CanaryScanResult> {
    if (this.scanTail !== undefined) return this.scanTail
    const task = this.scan(signal)
    const wrapped = task.finally(() => {
      if (this.scanTail === wrapped) this.scanTail = undefined
    })
    this.scanTail = wrapped
    return wrapped
  }

  private async scan(signal: AbortSignal): Promise<CanaryScanResult> {
    const result: CanaryScanResult = { kept: [], reviewed: [], rolledBack: [], warnings: [] }
    const reviews = await this.options.inbox.scanAll()
    result.warnings.push(...reviews.warnings.map(bounded))
    const candidates = new Map(reviews.candidates
      .filter(candidate => candidate.status === 'approved'
        && candidate.decisionActor === AUTO_PROMOTION_ACTOR
        && candidate.activatedAt !== undefined
        && candidate.generationId !== undefined)
      .map(candidate => [candidate.generationId!, candidate]))

    for (const outcome of this.options.outcomes.list()) {
      signal.throwIfAborted()
      if (outcome.status !== 'failed' || outcome.generationId === undefined) continue
      const candidate = candidates.get(outcome.generationId)
      if (candidate === undefined) continue
      if (!hashPattern.test(outcome.id)) {
        result.warnings.push(`invalid Delivery Outcome id '${bounded(outcome.id)}'`)
        continue
      }
      try {
        await this.process(candidate, outcome, signal, result)
      } catch (error) {
        if (signal.aborted) throw signal.reason
        result.warnings.push(bounded(errorMessage(error)))
      }
    }
    return result
  }

  private async process(
    candidate: ReviewCandidate,
    outcome: DeliveryOutcome,
    signal: AbortSignal,
    result: CanaryScanResult,
  ): Promise<void> {
    const generation = this.options.store.getGeneration(outcome.generationId!)
    if (generation === undefined || generation.policyVersion !== AUTO_PROMOTION_ACTOR) return
    const directory = join(candidate.outputDir, 'canary', generation.id)
    const statePath = join(directory, 'state.json')
    const existing = await loadState(statePath)
    if (existing !== undefined && existing.generationId !== generation.id) {
      throw new Error('canary state identity does not match its durable path')
    }
    if (existing?.phase === 'complete') return
    if (existing !== undefined && existing.outcomeId !== outcome.id) {
      throw new Error('canary recovery requires its original Delivery Outcome')
    }
    if (existing?.phase === 'rollback-pending') {
      await this.finishRollback(existing, outcome, statePath, result)
      return
    }
    if (this.options.store.getActiveGeneration()?.id !== generation.id) return

    await mkdir(directory, { recursive: true })
    const running: CanaryState = {
      schemaVersion: 1,
      outcomeId: outcome.id,
      generationId: generation.id,
      ...(generation.parentId === undefined ? {} : { parentId: generation.parentId }),
      phase: 'trial-running',
    }
    await writeDurableJson(statePath, running)
    let comparison: CanaryComparison
    try {
      comparison = await this.options.runner({ candidate, generation, outcome, signal })
    } catch (error) {
      if (signal.aborted) throw signal.reason
      const reason = `sealed canary incomplete: ${bounded(errorMessage(error))}`
      await writeDurableJson(statePath, {
        ...running,
        phase: 'complete',
        decision: 'review',
        reason,
      })
      result.reviewed.push({ outcomeId: outcome.id, generationId: generation.id, reason })
      return
    }
    signal.throwIfAborted()

    if (comparison.calibrationPassed && comparison.parentPassed && !comparison.candidatePassed) {
      const pending: CanaryState = {
        ...running,
        phase: 'rollback-pending',
        decision: 'rollback',
        reason: 'sealed parent passed while active Candidate failed',
        comparison,
      }
      await writeDurableJson(statePath, pending)
      await this.finishRollback(pending, outcome, statePath, result)
      return
    }

    const decision = comparison.calibrationPassed && comparison.candidatePassed ? 'keep' : 'review'
    const reason = decision === 'keep'
      ? 'active Candidate still passes the sealed canary'
      : !comparison.calibrationPassed
        ? 'sealed canary calibration failed'
        : 'parent and Candidate do not prove an attributable regression'
    await writeDurableJson(statePath, {
      ...running,
      phase: 'complete',
      decision,
      reason,
      comparison,
    })
    if (decision === 'keep') result.kept.push({ outcomeId: outcome.id, generationId: generation.id })
    else result.reviewed.push({ outcomeId: outcome.id, generationId: generation.id, reason })
  }

  private async finishRollback(
    state: CanaryState,
    outcome: DeliveryOutcome,
    statePath: string,
    result: CanaryScanResult,
  ): Promise<void> {
    const active = this.options.store.getActiveGeneration()
    if (active?.id !== state.generationId) {
      if (active?.id === state.parentId || (active === undefined && state.parentId === undefined)) {
        await writeDurableJson(statePath, {
          ...state,
          phase: 'complete',
          previousId: state.generationId,
          ...(active === undefined ? {} : { activeId: active.id }),
        })
        result.rolledBack.push({
          outcomeId: outcome.id,
          previousId: state.generationId,
          ...(active === undefined ? {} : { activeId: active.id }),
        })
        return
      }
      const reason = 'active Generation changed before canary rollback'
      await writeDurableJson(statePath, { ...state, phase: 'complete', decision: 'review', reason })
      result.reviewed.push({ outcomeId: outcome.id, generationId: state.generationId, reason })
      return
    }

    const rollback = await this.options.store.rollbackGeneration()
    if (rollback.previousId !== state.generationId || rollback.generation?.id !== state.parentId) {
      throw new Error('Generation rollback did not reach the sealed parent')
    }
    await writeDurableJson(statePath, {
      ...state,
      phase: 'complete',
      previousId: rollback.previousId,
      ...(rollback.generation === undefined ? {} : { activeId: rollback.generation.id }),
    })
    result.rolledBack.push({
      outcomeId: outcome.id,
      previousId: rollback.previousId,
      ...(rollback.generation === undefined ? {} : { activeId: rollback.generation.id }),
    })
  }
}

async function loadState(path: string): Promise<CanaryState | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!isRecord(value)
      || value.schemaVersion !== 1
      || !hashPattern.test(String(value.outcomeId))
      || !hashPattern.test(String(value.generationId))
      || !['trial-running', 'rollback-pending', 'complete'].includes(String(value.phase))) {
      throw new Error('canary state has an invalid shape')
    }
    return value as unknown as CanaryState
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function bounded(value: string): string {
  return value.replaceAll(/[\r\n]+/g, ' ').slice(0, 500)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
