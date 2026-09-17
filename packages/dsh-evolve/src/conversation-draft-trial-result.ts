import { isDeepStrictEqual } from 'node:util'
import { escapeText, renderSkillContent } from '@deepseek-ai/dsh-skill'
import { digest } from './conversation-correction-intake.ts'
import { matchesDraftCase } from './conversation-skill-draft.ts'
import { CONVERSATION_TRIAL_PROVIDER, type ConversationDraftTrialLegInput, type runConversationDraftTrialLeg } from './conversation-draft-trial-native.ts'
import type { ConversationDraftTrialComparison, ConversationDraftTrialRecord, ConversationDraftTrialResult } from './conversation-draft-trial-store.ts'

type Draft = NonNullable<ConversationDraftTrialLegInput['draft']>
type NativeLeg = Awaited<ReturnType<typeof runConversationDraftTrialLeg>>
type Assertions = Parameters<typeof matchesDraftCase>[1]

/** Deterministic checks, not a model judge or a claim that proposed expectations are factual gold. */
export function projectConversationDraftTrialResult(native: NativeLeg, test: Assertions, draft?: Draft): ConversationDraftTrialResult {
  const ends = native.events.filter(event => event.type === 'turn/end')
  const assistants = native.events.filter(event => event.type === 'assistant/message')
  const toolResults = native.events.filter(event => event.type === 'tool/result')
  const calls = native.events.filter(event => event.type === 'tool/call')
  const last = assistants.at(-1)
  const answer = last?.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
  const completed = ends.length === 1 && ends[0]?.data.turn === 1 && ends[0]?.data.reason.kind === 'completed'
    && last !== undefined && answer.trim().length > 0 && answer.length <= 32_000
    && assistants.every(event => event.data.interrupted !== true)
    && native.events.every(event => event.type !== 'assistant/attempt')
    && toolResults.every(event => event.data.error === undefined
      && event.data.message.content.every(block => block.type !== 'tool-result' || block.isError !== true))
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
    passed: completed && matchesDraftCase(answer, test), skillLoaded,
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

function normalizedRequest(serialized: string, draft: Draft, variant: 'baseline' | 'draft'): unknown {
  const request: unknown = JSON.parse(serialized)
  if (!object(request) || !Array.isArray(request.messages)) throw new Error('missing native request messages')
  delete request.sessionId // model-hidden transport identity, unlike every prompt byte below
  let catalogs = 0, removed = 0
  request.messages = request.messages.flatMap((raw: unknown) => {
    if (!object(raw)) throw new Error('invalid native message')
    const message = { ...raw }
    delete message.id // native message identity, not model-visible content
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
  if (catalogs > 1 || variant === 'draft' && removed !== 1) throw new Error('missing or duplicate experimental catalog')
  return request
}

export function sameTrialInitialComposition(baseline: string | undefined, candidate: string | undefined, draft: Draft): boolean {
  if (baseline === undefined || candidate === undefined) return false
  try { return isDeepStrictEqual(normalizedRequest(baseline, draft, 'baseline'), normalizedRequest(candidate, draft, 'draft')) }
  catch { return false }
}

export function compareConversationDraftTrial(record: ConversationDraftTrialRecord, draft: Draft): ConversationDraftTrialComparison {
  let baselinePassed = 0, draftPassed = 0, improved = 0, regressed = 0, comparablePairs = 0, loadedDraftLegs = 0
  let allCompleted = true, attributable = true
  for (let i = 0; i < 8; i += 2) {
    const pair = record.legs.slice(i, i + 2)
    const baseline = pair.find(leg => leg.variant === 'baseline')?.result
    const candidate = pair.find(leg => leg.variant === 'draft')?.result
    if (!baseline || !candidate || baseline.status !== 'completed' || candidate.status !== 'completed') allCompleted = false
    if (baseline?.passed) baselinePassed++
    if (candidate?.passed) draftPassed++
    if (candidate?.skillLoaded) loadedDraftLegs++
    if (sameTrialInitialComposition(baseline?.firstRequest, candidate?.firstRequest, draft)) comparablePairs++
    if (baseline && candidate && !baseline.passed && candidate.passed) {
      improved++
      if (!candidate.skillLoaded) attributable = false
    }
    if (baseline?.passed && candidate && !candidate.passed) regressed++
  }
  const outcome = !allCompleted || comparablePairs !== 4 ? 'inconclusive'
    : regressed > 0 ? 'regression'
      : improved > 0 ? attributable ? 'improvement-observed' : 'inconclusive' : 'no-improvement'
  return { baselinePassed, draftPassed, improved, regressed, comparablePairs, loadedDraftLegs, outcome }
}
