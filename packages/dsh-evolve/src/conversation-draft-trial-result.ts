import { isDeepStrictEqual } from 'node:util'
import { escapeText, renderSkillContent } from '@deepseek-ai/dsh-skill'
import { digest } from './conversation-correction-intake.ts'
import { matchesDraftCase } from './conversation-skill-draft.ts'
import { CONVERSATION_TRIAL_PROVIDER, type ConversationDraftTrialLegInput, type runConversationDraftTrialLeg } from './conversation-draft-trial-native.ts'
import type { ConversationDraftTrialComparison, ConversationDraftTrialRecord, ConversationDraftTrialResult } from './conversation-draft-trial-store.ts'
import { trialJudgeCalibrated, trialLegPassed } from './conversation-draft-trial-store.ts'
import { checkFileWorkflowAnswer, checkFileWorkflowDelivery, FILE_WORKFLOW_ROOT_TOKEN, fileWorkflowRoot, type FileWorkflowCase } from './conversation-file-workflow.ts'
import { createHash } from 'node:crypto'

type Draft = NonNullable<ConversationDraftTrialLegInput['draft']>
type NativeLeg = Awaited<ReturnType<typeof runConversationDraftTrialLeg>>
type Assertions = Parameters<typeof matchesDraftCase>[1]

/** Deterministic checks, not a model judge or a claim that proposed expectations are factual gold. */
export function projectConversationDraftTrialResult(native: NativeLeg, test: Assertions | FileWorkflowCase, draft?: Draft): ConversationDraftTrialResult {
  const fileTest = 'files' in test ? test : undefined
  const ends = native.events.filter(event => event.type === 'turn/end')
  const assistants = native.events.filter(event => event.type === 'assistant/message')
  const toolResults = native.events.filter(event => event.type === 'tool/result')
  const calls = native.events.filter(event => event.type === 'tool/call')
  const last = assistants.at(-1)
  const toolErrors = toolResults.filter(event => event.data.error !== undefined
    || event.data.message.content.some(block => block.type === 'tool-result' && block.isError === true)).length
  const answer = last?.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
  const completed = ends.length === 1 && ends[0]?.data.turn === 1 && ends[0]?.data.reason.kind === 'completed'
    && last !== undefined && answer.trim().length > 0 && answer.length <= 32_000
    && assistants.every(event => event.data.interrupted !== true)
    && native.events.every(event => event.type !== 'assistant/attempt')
    && (fileTest !== undefined || toolErrors === 0)
  if (fileTest !== undefined && native.fileEvidence === undefined) throw new Error('file trial did not return artifact evidence')
  const fileChecks = fileTest === undefined ? undefined : checkFileWorkflowAnswer(fileTest, native.fileEvidence!.outputs[0]?.content)
  const deliveryPassed = checkFileWorkflowDelivery(native.fileEvidence)
  let skillLoaded = false
  if (draft !== undefined) {
    const prefix = `---\nname: ${draft.name}\ndescription: ${JSON.stringify(draft.description)}\n---\n\n`
    if (draft.markdown.startsWith(prefix)) {
      const expected = renderSkillContent({ name: draft.name, provider: CONVERSATION_TRIAL_PROVIDER, content: draft.markdown.slice(prefix.length) })
      skillLoaded = calls.some(call => {
        if (call.data.name !== 'skill') return false
        try { if (!isDeepStrictEqual(JSON.parse(call.data.arguments), { name: draft.name })) return false } catch { return false }
        const results = toolResults.filter(event => event.data.message.content.some(block => block.type === 'tool-result' && block.toolCallId === call.data.callId))
        if (results.length !== 1 || results[0]!.seq <= call.seq) return false
        return results[0]!.data.message.content.some(block => block.type === 'tool-result' && block.toolCallId === call.data.callId
          && block.isError !== true && isDeepStrictEqual(block.content, [{ type: 'text', text: expected }]))
      })
    }
  }
  const usages = assistants.flatMap(event => event.data.usage === undefined ? [] : [event.data.usage])
  const usageMissingCount = Math.max(0, native.dispatchMarkers - usages.length)
  return {
    status: completed ? 'completed' : 'incomplete', answer: answer.slice(0, 32_000),
    passed: completed && (fileChecks === undefined ? matchesDraftCase(answer, test as Assertions) : fileChecks.passed && deliveryPassed), skillLoaded,
    ...(fileChecks === undefined ? {} : { fileEvidence: native.fileEvidence!, fileResult: { deliveryPassed, toolErrors,
      checks: fileChecks.checks.map(check => ({ field: check.field, passed: check.passed,
        ...(check.expected === undefined ? {} : { expectedJson: JSON.stringify(check.expected) }),
        ...(check.actual === undefined ? {} : { actualJson: JSON.stringify(check.actual) }) })) } }),
    elapsedMs: native.elapsedMs, requestCount: native.requestSnapshots.length, eventDigest: digest(native.events),
    requestDigests: native.requestSnapshots.map(snapshot => digest(JSON.parse(snapshot))),
    ...(native.requestSnapshots[0] === undefined ? {} : { firstRequest: native.requestSnapshots[0] }),
    inputTokens: usages.reduce((n, usage) => n + usage.inputTokens, 0),
    outputTokens: usages.reduce((n, usage) => n + usage.outputTokens, 0), usageMissingCount,
    ...(usages.length === 0 || usageMissingCount !== 0 || usages.some(usage => usage.cacheReadTokens === undefined) ? {}
      : { cacheReadTokens: usages.reduce((n, usage) => n + (usage.cacheReadTokens ?? 0), 0) }),
    ...(usages.length === 0 || usageMissingCount !== 0 || usages.some(usage => usage.cacheWriteTokens === undefined) ? {}
      : { cacheWriteTokens: usages.reduce((n, usage) => n + (usage.cacheWriteTokens ?? 0), 0) }),
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Narrow decoder for the audited native tool-skill initial catalog. It checks
// all rendered bytes before removing the declared experimental delta. A new
// upstream framing or a custom catalog is incomparable, not silently ignored.
function catalogText(entries: readonly { name: string; description: string }[]): string {
  return ['<system-reminder>',
    'A skill is a reusable set of task-specific instructions. The following skills are available in this session:', '',
    '<available_skills>', ...entries.map(entry => `- \`${entry.name}\`: ${escapeText(entry.description)}`), '</available_skills>', '',
    "If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.",
    'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.',
    '</system-reminder>'].join('\n')
}

function normalizedRequest(serialized: string, draft: Draft, variant: 'baseline' | 'draft', fileRoot?: string): unknown {
  const request: unknown = JSON.parse(serialized)
  if (!object(request) || !Array.isArray(request.messages)) throw new Error('missing native request messages')
  delete request.sessionId // model-hidden transport identity, unlike every prompt byte below
  let catalogs = 0, removed = 0, fileTasks = 0
  request.messages = request.messages.flatMap((raw: unknown) => {
    if (!object(raw)) throw new Error('invalid native message')
    const message = { ...raw }
    delete message.id // native message identity, not model-visible content
    if (fileRoot !== undefined && object(message.source) && message.source.kind === 'plugin' && message.source.plugin === 'dsh-evolve') {
      if (message.role !== 'user' || !Array.isArray(message.content) || message.content.length !== 1
        || !object(message.content[0]) || message.content[0].type !== 'text' || typeof message.content[0].text !== 'string'
        || !message.content[0].text.includes(`${fileRoot}/`) || message.content[0].text.includes(FILE_WORKFLOW_ROOT_TOKEN)) throw new Error('file trial task binding changed')
      fileTasks++
      message.content = [{ type: 'text', text: message.content[0].text.replaceAll(fileRoot, FILE_WORKFLOW_ROOT_TOKEN) }]
    }
    if (!object(message.source) || message.source.kind !== 'skill-catalog') return [message]
    catalogs++
    const source = message.source
    if (message.role !== 'user' || Object.keys(message).sort().join(',') !== 'content,role,source'
      || Object.keys(source).sort().join(',') !== 'entries,form,kind' || source.form !== 'catalog' || !Array.isArray(source.entries)) {
      throw new Error('unsupported native catalog shape')
    }
    const entries = source.entries.map((entry: unknown) => {
      if (!object(entry) || Object.keys(entry).sort().join(',') !== 'description,name'
        || typeof entry.name !== 'string' || typeof entry.description !== 'string') throw new Error('invalid catalog entry')
      return { name: entry.name, description: entry.description }
    })
    if (!isDeepStrictEqual(message.content, [{ type: 'text', text: catalogText(entries) }])) throw new Error('native catalog bytes changed')
    const matches = entries.filter(entry => entry.name === draft.name)
    if (variant === 'baseline' && matches.length > 0 || matches.length > 1) throw new Error('draft already present in baseline')
    if (variant === 'draft' && matches.length === 1) {
      const normalized = draft.description.replace(/\s+/gu, ' ').trim()
      const expected = normalized.length <= 500 ? normalized : `${normalized.slice(0, 497)}...`
      if (matches[0]!.description !== expected) throw new Error('draft catalog description changed')
      removed++
      const retained = entries.filter(entry => entry.name !== draft.name)
      if (retained.length === 0) return []
      message.source = { ...source, entries: retained }
      message.content = [{ type: 'text', text: catalogText(retained) }]
    }
    return [message]
  })
  if (catalogs > 1 || variant === 'draft' && removed !== 1 || fileRoot !== undefined && fileTasks !== 1) throw new Error('missing or duplicate experimental catalog or task')
  return request
}

export function sameTrialInitialComposition(baseline: string | undefined, candidate: string | undefined, draft: Draft,
  files?: { readonly baselineRoot: string; readonly draftRoot: string }): boolean {
  if (baseline === undefined || candidate === undefined) return false
  try { return isDeepStrictEqual(normalizedRequest(baseline, draft, 'baseline', files?.baselineRoot), normalizedRequest(candidate, draft, 'draft', files?.draftRoot)) }
  catch { return false }
}

export function compareConversationDraftTrial(record: ConversationDraftTrialRecord, draft: Draft): ConversationDraftTrialComparison {
  let baselinePassed = 0, draftPassed = 0, improved = 0, regressed = 0, comparablePairs = 0, loadedDraftLegs = 0
  let allCompleted = true, attributable = true
  if (record.judge !== undefined && (!trialJudgeCalibrated(record) || record.judge.requests.length !== 20
    || record.judge.requests.some(request => request.decision === undefined || request.decision.verdict === 'uncertain'))) allCompleted = false
  for (let i = 0; i < 8; i += 2) {
    const pair = record.legs.slice(i, i + 2)
    const baselineLeg = pair.find(leg => leg.variant === 'baseline')!, draftLeg = pair.find(leg => leg.variant === 'draft')!
    const baseline = baselineLeg.result, candidate = draftLeg.result
    if (!baseline || !candidate || baseline.status !== 'completed' || candidate.status !== 'completed') allCompleted = false
    const baselinePass = trialLegPassed(record, pair.find(leg => leg.variant === 'baseline')!.index)
    const candidatePass = trialLegPassed(record, pair.find(leg => leg.variant === 'draft')!.index)
    if (baselinePass) baselinePassed++
    if (candidatePass) draftPassed++
    if (candidate?.skillLoaded) loadedDraftLegs++
    const files = record.fileEvaluation === undefined ? undefined : {
      baselineRoot: fileWorkflowRoot(record.id, baselineLeg.index), draftRoot: fileWorkflowRoot(record.id, draftLeg.index),
    }
    const fileComparable = files === undefined || baseline?.fileEvidence?.root === files.baselineRoot
      && candidate?.fileEvidence?.root === files.draftRoot
      && isDeepStrictEqual(baseline.fileEvidence.inputs.map(({ path, hash }) => ({ path, hash })), candidate.fileEvidence.inputs.map(({ path, hash }) => ({ path, hash })))
    if (fileComparable && sameTrialInitialComposition(baseline?.firstRequest, candidate?.firstRequest, draft, files)) comparablePairs++
    if (baseline && candidate && !baselinePass && candidatePass) {
      improved++
      if (!candidate.skillLoaded) attributable = false
    }
    if (baselinePass && candidate && !candidatePass) regressed++
  }
  const outcome = !allCompleted || comparablePairs !== 4 ? 'inconclusive'
    : regressed > 0 ? 'regression'
      : improved > 0 ? attributable ? 'improvement-observed' : 'inconclusive' : 'no-improvement'
  return { baselinePassed, draftPassed, improved, regressed, comparablePairs, loadedDraftLegs, outcome }
}

/** Recompute file facts from the sealed task and actual bytes; never trust UI verdicts. */
export function fileTrialResultMatches(record: ConversationDraftTrialRecord, index: number, test: FileWorkflowCase): boolean {
  const leg = record.legs[index], result = leg?.result
  if (record.fileEvaluation === undefined || leg?.caseId !== test.id || leg.partition !== test.partition
    || leg.inputDigest !== digest(test.input) || result?.fileEvidence === undefined || result.fileResult === undefined
    || result.fileEvidence.root !== fileWorkflowRoot(record.id, index)) return false
  const evidence = result.fileEvidence
  if (!isDeepStrictEqual(evidence.inputs.map(({ path, hash }) => ({ path, hash })), test.files.map(file => ({
    path: file.path, hash: createHash('sha256').update(file.content).digest('hex'),
  })))) return false
  const checked = checkFileWorkflowAnswer(test, evidence.outputs[0]?.content)
  const checks = checked.checks.map(check => ({ field: check.field, passed: check.passed,
    ...(check.expected === undefined ? {} : { expectedJson: JSON.stringify(check.expected) }),
    ...(check.actual === undefined ? {} : { actualJson: JSON.stringify(check.actual) }) }))
  const deliveryPassed = checkFileWorkflowDelivery(evidence)
  return isDeepStrictEqual(checks, result.fileResult.checks) && result.fileResult.deliveryPassed === deliveryPassed
    && result.passed === (result.status === 'completed' && checked.passed && deliveryPassed)
}
