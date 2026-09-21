import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { digest, type CorrectionLedger } from './conversation-correction-intake.ts'
import { draftInputDigest, type ConversationDraftRecord, type ConversationDraftStore } from './conversation-skill-draft.ts'
import { compareConversationDraftTrial, fileTrialResultMatches } from './conversation-draft-trial-result.ts'
import { trialJudgeCalibrated, trialLegPassed, type ConversationDraftTrialRecord, type ConversationDraftTrialStore } from './conversation-draft-trial-store.ts'
import { DurableFeedbackAttribution } from './durable-feedback-attribution.ts'
import { explicitFeedbackId, resolveConversationDraftOrigin, type ConversationDraftOrigin } from './conversation-message-feedback.ts'
import type { EvolutionStore } from './generation-store.ts'
import type { GenerationBundleRepository } from './generation-bundle-repository.ts'
import { assembleConversationSkillArchive, parseConversationSkillLineage, type ConversationTrialBaseline } from './conversation-skill-lineage.ts'
import type { ConversationSkillReleaseReason, ConversationSkillReleaseEligibility } from './control-types.ts'
export type { ConversationSkillReleaseReason, ConversationSkillReleaseEligibility } from './control-types.ts'
interface Modules {
  readonly corrections: CorrectionLedger
  readonly drafts: Pick<ConversationDraftStore, 'records' | 'policy'>
  readonly trials: Pick<ConversationDraftTrialStore, 'records' | 'policy'>
  readonly store: EvolutionStore
  readonly bundles: Pick<GenerationBundleRepository, 'providerFor'>
}

export function conversationTrialBaseline(store: Pick<EvolutionStore, 'getActiveGeneration' | 'listGenerationSelectionEvents'>,
  workspaceId: string): ConversationTrialBaseline {
  const generation = store.getActiveGeneration(workspaceId)
  return { selectionSequence: store.listGenerationSelectionEvents(workspaceId).at(-1)?.sequence ?? 0,
    ...(generation === undefined ? {} : { generationId: generation.id }) }
}

/**
 * Human-confirmed release of one independently checked conversation Skill.
 * Reuses the existing Generation store, binder and exact rollback semantics;
 * never changes a draft, reevaluates an answer, or calls a model.
 */
export class ConversationSkillRelease {
  private closing = false
  private readonly operations = new Set<Promise<unknown>>()
  constructor(private readonly ctx: Context, private readonly modules: Modules) {}

  async eligibility(workspaceId: string, trialId: string): Promise<ConversationSkillReleaseEligibility> {
    return this.track(async () => (await this.check(workspaceId, trialId)).view)
  }

  async enable(workspaceId: string, trialId: string, expectedContentHash: string, expectedSelectionSequence: number) {
    return this.track(async () => {
      if (!Number.isSafeInteger(expectedSelectionSequence) || expectedSelectionSequence < 0) throw new Error('invalid conversation Skill review sequence')
      const checked = await this.check(workspaceId, trialId)
      if (checked.view.contentHash !== expectedContentHash) throw new Error('conversation Skill content changed since review')
      if (checked.view.status === 'active') {
        const generation = this.modules.store.getGeneration(checked.view.generationId!)!
        return { previousId: generation.parentId, generation }
      }
      if (checked.view.status !== 'eligible' || checked.source === undefined || checked.trial === undefined) {
        throw new Error(`conversation Skill release blocked: ${checked.view.reason}`)
      }
      if (checked.view.selectionSequence !== expectedSelectionSequence) throw new Error('conversation Skill selection changed since review')
      const { source, trial } = checked
      const draft = source.draft!
      const baseline = trial.baseline!
      const active = this.modules.store.getActiveGeneration(workspaceId)
      const bundle = await assembleConversationSkillArchive([
        { path: 'SKILL.md', mode: '100644', content: Buffer.from(draft.markdown) },
      ], draft.contentHash)
      const lineage = parseConversationSkillLineage({
        kind: 'conversation-skill-lineage-v1', workspaceId, skillName: draft.name,
        draftId: source.id, trialId, sourceDigest: source.sourceDigest, governanceDigest: source.governanceDigest,
        trialDigest: digest(trial), draftContentHash: draft.contentHash,
        contentHash: bundle.artifactDigest, candidateTreeHash: bundle.treeHash, baseline, releaseAuthority: 'none',
      })
      const input = { workspaceId, ...(active === undefined ? {} : { parentId: active.id }),
        createdAt: trial.reservedAt, evaluatorVersion: trial.fileEvaluation?.version ?? trial.judge!.version,
        policyVersion: trial.fileEvaluation === undefined ? 'conversation-independent-human-review-v1' : 'conversation-independent-file-review-v1',
        compositionFingerprint: digest(trial.legs.map(leg => leg.result!.requestDigests[0])),
        artifacts: [...(active?.artifacts ?? []), {
          kind: 'skill-bundle' as const, name: draft.name, artifactDigest: bundle.artifactDigest,
          treeHash: bundle.treeHash, contentBase64: bundle.content.toString('base64'), lineage,
        }],
      }
      await this.modules.bundles.providerFor({ ...input, id: '0'.repeat(64), schemaVersion: 2 })
      await this.requireUnchanged(workspaceId, source, trial, expectedSelectionSequence)
      const published = await this.modules.store.publishGeneration(input)
      // A publication is inactive. Recheck the native source after its durable write.
      await this.requireUnchanged(workspaceId, source, trial, expectedSelectionSequence)
      return this.modules.store.promoteGeneration(workspaceId, published.generation.id, {
        authority: 'conversation-independent-review', trialId, draftId: source.id,
        expectedSelectionSequence,
      })
    })
  }

  async disable(workspaceId: string, expectedGenerationId: string) {
    return this.track(async () => {
      const active = this.modules.store.getActiveGeneration(workspaceId)
      if (active?.id !== expectedGenerationId) throw new Error('active Generation changed since rollback review')
      if (!active.artifacts.some(artifact => artifact.kind === 'skill-bundle'
        && artifact.lineage.kind === 'conversation-skill-lineage-v1'
        && artifact.lineage.baseline.generationId === active.parentId)) throw new Error('not a conversation Skill Generation')
      if (this.closing) throw new Error('conversation Skill release unavailable')
      return this.modules.store.rollbackGeneration(workspaceId, expectedGenerationId, { authority: 'explicit-human' })
    })
  }

  async close(): Promise<void> {
    this.closing = true
    await Promise.allSettled([...this.operations])
  }

  private async requireUnchanged(workspaceId: string, source: ConversationDraftRecord, trial: ConversationDraftTrialRecord, expectedSelectionSequence: number) {
    const checked = await this.check(workspaceId, trial.id)
    if (this.closing || checked.view.status !== 'eligible' || digest(checked.source) !== digest(source)
      || digest(checked.trial) !== digest(trial)) throw new Error(`conversation Skill release blocked: ${checked.view.reason ?? 'evidence-changed'}`)
    if (checked.view.selectionSequence !== expectedSelectionSequence) throw new Error('conversation Skill selection changed since review')
  }

  private async check(workspaceId: string, trialId: string): Promise<{
    view: ConversationSkillReleaseEligibility; source?: ConversationDraftRecord; trial?: ConversationDraftTrialRecord;
  }> {
    let source: ConversationDraftRecord | undefined
    const blocked = (reason: ConversationSkillReleaseReason) => ({ view: { trialId, status: 'blocked' as const, reason,
      ...(source?.draft === undefined ? {} : { draftId: source.id, contentHash: source.draft.contentHash }) } })
    if (this.closing) return blocked('runtime-unavailable')
    const { drafts, trials, store } = this.modules
    const trial = trials.records(workspaceId).find(record => record.id === trialId)
    if (trial === undefined) return blocked('trial-not-found')
    source = drafts.records(workspaceId).find(record => record.id === trial.draftId)
    if (source?.phase !== 'draft' || source.draft === undefined || (source.governance ?? source.fileWorkflow) === undefined
      || digest(source) !== trial.draftSnapshotDigest || source.draft.contentHash !== trial.contentHash
      || digest(source.governance ?? source.fileWorkflow) !== trial.governanceDigest) return blocked('draft-changed')
    const active = store.getActiveGeneration(workspaceId)
    const currentBaseline = conversationTrialBaseline(store, workspaceId)
    if (active?.artifacts.some(artifact => artifact.kind === 'skill-bundle'
      && artifact.lineage.kind === 'conversation-skill-lineage-v1' && artifact.lineage.trialId === trialId
      && artifact.lineage.trialDigest === digest(trial) && artifact.lineage.draftContentHash === source!.draft!.contentHash)) {
      const rollbackAvailable = active.artifacts.some(artifact => artifact.kind === 'skill-bundle'
        && artifact.lineage.kind === 'conversation-skill-lineage-v1' && artifact.lineage.trialId === trialId
        && artifact.lineage.baseline.generationId === active.parentId)
      return { view: { trialId, draftId: source.id, contentHash: source.draft.contentHash, status: 'active', generationId: active.id,
        selectionSequence: currentBaseline.selectionSequence, rollbackAvailable, skill: { name: source.draft.name, markdown: source.draft.markdown } } }
    }
    if (drafts.policy(workspaceId) === undefined || trials.policy(workspaceId) === undefined) return blocked('policy-unavailable')
    const independentlyChecked = trial.fileEvaluation === undefined
      ? trial.judge !== undefined && trialJudgeCalibrated(trial) && trial.judge.requests.length === 20
      : source.fileWorkflow !== undefined && trial.judge === undefined && trial.legs.every((leg, index) => {
        const test = source!.fileWorkflow!.cases.find(test => test.id === leg.caseId)
        return test !== undefined && fileTrialResultMatches(trial, index, test)
      })
    if (trial.phase !== 'completed' || !independentlyChecked) return blocked('independent-evaluation-required')
    if (trial.baseline === undefined) return blocked('baseline-unsealed')
    if (trial.baseline.generationId !== currentBaseline.generationId) return blocked('baseline-changed')
    const comparison = compareConversationDraftTrial(trial, source.draft)
    if (!isDeepStrictEqual(comparison, trial.comparison) || comparison.outcome !== 'improvement-observed'
      || comparison.draftPassed !== 4 || comparison.regressed !== 0
      || trial.legs.some(leg => leg.partition === 'holdout' && leg.variant === 'draft' && !leg.result?.skillLoaded)) {
      return blocked('improvement-not-proven')
    }
    if (trial.legs.some(leg => leg.partition === 'retention' && !trialLegPassed(trial, leg.index))) return blocked('retention-not-proven')
    if (active?.artifacts.some(artifact => artifact.name === source!.draft!.name)) return blocked('skill-name-conflict')
    if (!await this.sourceAvailable(source, trial)) return blocked('source-unavailable')
    if (this.closing || !isDeepStrictEqual(currentBaseline, conversationTrialBaseline(store, workspaceId))) return blocked('baseline-changed')
    if (drafts.policy(workspaceId) === undefined || trials.policy(workspaceId) === undefined) return blocked('policy-unavailable')
    return { source, trial, view: { trialId, draftId: source.id, contentHash: source.draft.contentHash, status: 'eligible',
      selectionSequence: currentBaseline.selectionSequence, skill: { name: source.draft.name, markdown: source.draft.markdown } } }
  }

  private async sourceAvailable(source: ConversationDraftRecord, trial: ConversationDraftTrialRecord): Promise<boolean> {
    try {
      if (!this.ctx.get('sessionPersistence') || !this.ctx.get('skills')) return false
      const feedback = source.messageFeedbackSource
      if (feedback !== undefined && this.modules.drafts.policy(source.workspaceId)?.explicitFeedbackSessionIds?.includes(feedback.sessionId) !== true) return false
      const origin: ConversationDraftOrigin | undefined = feedback === undefined
        ? this.modules.corrections.records(source.workspaceId).find(record => record.id === source.correctionId)
        : { kind: 'message-feedback', id: explicitFeedbackId(feedback), source: feedback }
      if (origin === undefined || origin.id !== source.correctionId || digest(origin.source) !== source.sourceDigest) return false
      const reader = new DurableFeedbackAttribution(this.ctx.sessionPersistence, { lifecycle: this.ctx })
      const resolved = await resolveConversationDraftOrigin(this.ctx, reader, this.modules.corrections, origin)
      if (this.closing || resolved?.cwd === undefined || draftInputDigest(resolved.input, source.testPreparation) !== source.inputDigest
        || resolved.input.route.provider !== trial.provider || resolved.input.route.model !== trial.model) return false
      const skills = await this.ctx.skills.list({ cwd: resolved.cwd })
      return !this.closing && !skills.some(skill => skill.name === source.draft!.name)
    } catch { return false }
  }

  private track<T>(run: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('conversation Skill release unavailable'))
    const operation = run()
    this.operations.add(operation)
    void operation.finally(() => this.operations.delete(operation)).catch(() => {})
    return operation
  }
}
