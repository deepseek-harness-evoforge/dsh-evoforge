import { isAbsolute } from 'node:path'
import type { EvolutionStore } from './generation-store.ts'
import type { FeedbackSignalStore } from './feedback-signal-monitor.ts'
import type {
  FeedbackShadowExactTargetConfig,
  FeedbackShadowLauncher,
  FeedbackShadowLaunchReceipt,
} from './feedback-shadow-launcher.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const MAX_TARGETS = 20

export interface AutomaticFeedbackShadowTarget extends FeedbackShadowExactTargetConfig {}

export interface AutomaticFeedbackShadowTargetReference {
  readonly target: string
  readonly casePackHash: string
}

export interface AutomaticFeedbackShadowOptions {
  readonly evolution: Pick<EvolutionStore, 'getGeneration'>
  readonly shadow: Pick<FeedbackShadowLauncher, 'available' | 'launchAutomaticExact'>
  readonly signals: Pick<FeedbackSignalStore, 'list'>
  readonly targets: AutomaticFeedbackShadowTarget[]
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

  constructor(options: AutomaticFeedbackShadowOptions) {
    assertAutomaticFeedbackShadowTargets(options.targets)
    this.options = options
  }

  async scanOnce(): Promise<AutomaticFeedbackShadowResult> {
    const launched: AutomaticFeedbackShadowResult['launched'] = []
    const warnings: string[] = []
    if (!this.options.shadow.available()) return { launched, warnings }
    const signals = this.options.signals.list()
    const currentSignals = new Set(signals.map(signal => signal.id))
    for (const signalId of this.attemptedSignals) {
      if (!currentSignals.has(signalId)) this.attemptedSignals.delete(signalId)
    }
    for (const signal of signals) {
      if (this.attemptedSignals.has(signal.id) || signal.generationId === undefined) continue
      const generation = this.options.evolution.getGeneration(signal.generationId)
      if (generation === undefined) continue
      const skillNames = new Set(generation.artifacts.map(artifact => artifact.name))
      const matches = this.options.targets.filter(target => skillNames.has(target.skill))
      if (matches.length === 0) continue
      if (matches.length > 1) {
        this.attemptedSignals.add(signal.id)
        warnings.push(
          'explicit feedback matches multiple automatic Shadow Targets; choose one explicitly',
        )
        break
      }
      const target = matches[0]!
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
  if (targets.some(target => target.id.trim() === '' || target.skill.trim() === '')
    || new Set(targets.map(target => target.id)).size !== targets.length) {
    throw new Error('automatic Feedback Shadow target identities must be unique and non-empty')
  }
  if (new Set(targets.map(target => target.skill)).size !== targets.length) {
    throw new Error('automatic Feedback Shadow permits exactly one target per Skill')
  }
}
