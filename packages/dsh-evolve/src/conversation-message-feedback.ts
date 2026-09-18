import type { Context } from '@deepseek-ai/cordis'
import type { MessageFeedbackItem } from '@deepseek-ai/dsh-message-feedback'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { deriveEventMessage, isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { z } from 'zod'
import { digest, projectCorrectionInput, type CorrectionInput, type CorrectionRecord, type CorrectionLedger } from './conversation-correction-intake.ts'
import type { DurableFeedbackAttribution, DurableFeedbackStoredSession } from './durable-feedback-attribution.ts'
import { runWithLifecycleDeadline } from './lifecycle-deadline.ts'
import { NATIVE_WORKSPACE_ID_PATTERN, workspaceIdForCwd } from './workspace-identity.ts'

const INT = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const HASH = z.string().regex(/^[a-f0-9]{64}$/u)
const ID = z.string().min(1).max(256)
const MAX_EVENTS = 20_000
const itemSchema = z.strictObject({
  messageId: ID, rating: z.enum(['positive', 'negative']), note: z.string().optional(),
  category: z.string().max(256).optional(), version: ID, createdAt: INT, updatedAt: INT,
}).refine(item => item.updatedAt >= item.createdAt)

/** No raw note, invented second turn, model interpretation or authoring permission. */
export const explicitFeedbackSourceSchema = z.strictObject({
  kind: z.literal('message-feedback-v1'), workspaceId: z.string().regex(NATIVE_WORKSPACE_ID_PATTERN), sessionId: ID,
  turn: INT.positive(), userSeq: INT, assistantSeq: INT, turnEndSeq: INT, feedbackSeq: INT,
  messageId: ID, feedbackVersion: ID, feedbackUpdatedAt: INT,
  itemDigest: HASH, prefixDigest: HASH, inputDigest: HASH, modelIdentityDigest: HASH,
}).superRefine((source, ctx) => {
  const seqs = [source.userSeq, source.assistantSeq, source.turnEndSeq, source.feedbackSeq]
  if (seqs.some((seq, index) => seq >= MAX_EVENTS || index > 0 && seq <= seqs[index - 1]!)) {
    ctx.addIssue({ code: 'custom', message: 'message feedback source is not in causal order' })
  }
})
export type ExplicitFeedbackSource = z.infer<typeof explicitFeedbackSourceSchema>
export interface ExplicitFeedbackInput {
  readonly source: ExplicitFeedbackSource
  readonly route: CorrectionInput['route']
  readonly messages: Pick<CorrectionInput['messages'], 'request' | 'answer' | 'correction'>
}
export interface ExplicitFeedbackOrigin {
  readonly kind: 'message-feedback'
  readonly id: string
  readonly source: ExplicitFeedbackSource
}
export type ConversationDraftInput = CorrectionInput | ExplicitFeedbackInput
export type ConversationDraftOrigin = CorrectionRecord | ExplicitFeedbackOrigin
export function isExplicitFeedbackOrigin(origin: ConversationDraftOrigin): origin is ExplicitFeedbackOrigin {
  return 'kind' in origin && origin.kind === 'message-feedback'
}
export function explicitFeedbackId(source: Pick<ExplicitFeedbackSource, 'sessionId' | 'messageId'>): string {
  // Editing/deleting/recreating the same feedback must not mint another attempt or independent sample.
  return digest({ kind: 'message-feedback-draft-source-v1', sessionId: source.sessionId, messageId: source.messageId })
}
export function explicitFeedbackOrigin(input: ExplicitFeedbackInput): ExplicitFeedbackOrigin {
  const source = explicitFeedbackSourceSchema.parse(input.source)
  return { kind: 'message-feedback', id: explicitFeedbackId(source), source }
}
export function draftOriginAnswerSeq(origin: ConversationDraftOrigin): number {
  return isExplicitFeedbackOrigin(origin) ? origin.source.assistantSeq : origin.source.previousAssistantSeq
}

/** One narrow, explicit source cohort. The caller must prove the native Workspace and list barrier. */
export function projectMessageFeedbackInputs(stored: DurableFeedbackStoredSession, workspaceId: string,
  sessionId: string, listed: readonly MessageFeedbackItem[]): ExplicitFeedbackInput[] {
  if (String(stored.meta.id) !== sessionId || stored.meta.version !== 3 || stored.fromSeq !== 0
    || stored.events.length > MAX_EVENTS || stored.events.some((event, index) => event.seq !== index)
    || stored.events.some(event => isReplacementSurfaceEvent(event) || event.type.startsWith('compaction/'))) return []
  const current = new Map<string, { item: z.infer<typeof itemSchema>; seq: number }>()
  for (const event of stored.events) {
    if (event.type === 'feedback/message-put' && String(event.data.sessionId) === sessionId) {
      const parsed = itemSchema.safeParse(event.data.item)
      if (!parsed.success) return []
      current.set(parsed.data.messageId, { item: parsed.data, seq: event.seq })
    } else if (event.type === 'feedback/message-delete' && String(event.data.sessionId) === sessionId) {
      current.delete(String(event.data.messageId))
    }
  }
  const expected = z.array(itemSchema).max(MAX_EVENTS).safeParse(listed)
  if (!expected.success || expected.data.length !== current.size || new Set(expected.data.map(item => item.messageId)).size !== current.size
    || expected.data.some(item => digest(item) !== digest(current.get(item.messageId)?.item))) return []
  const inputs: ExplicitFeedbackInput[] = []
  for (const { item, seq: feedbackSeq } of current.values()) {
    if (item.rating !== 'negative' || item.note === undefined || item.note.trim().length === 0) continue
    const targets = stored.events.filter(event => event.type === 'assistant/message' && isAppendSurfaceEvent(event)
      && String(deriveEventMessage(event)?.id) === item.messageId)
    if (targets.length !== 1) continue
    const answer = targets[0]!
    if (answer.type !== 'assistant/message' || answer.seq >= feedbackSeq) continue
    const start = [...stored.events].reverse().find(event => event.type === 'turn/start' && event.seq < answer.seq && event.data.turn === answer.data.turn)
    const end = stored.events.find(event => event.type === 'turn/end' && event.seq > answer.seq && event.data.turn === answer.data.turn)
    if (start?.type !== 'turn/start' || start.seq < stored.inheritedEventCount || end?.type !== 'turn/end'
      || end.data.reason.kind !== 'completed' || end.seq >= feedbackSeq) continue
    const turn = stored.events.filter(event => event.seq > start.seq && event.seq < end.seq)
    const users = turn.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
    const user = users[0]
    if (users.length !== 1 || user?.type !== 'user/message' || !isAppendSurfaceEvent(user) || user.seq >= answer.seq
      || user.data.content.some(block => block.type !== 'text')
      || turn.some(event => event.type === 'assistant/message' && event.seq > answer.seq)
      || answer.data.message.content.some(block => block.type === 'tool-call')) continue
    const header = [...stored.events].reverse().find(event => event.type === 'request/header' && event.seq < answer.seq)
    if (header?.type !== 'request/header') continue
    const config = header.data.header.config
    if (typeof config.provider !== 'string' || config.provider.length === 0 || config.provider.length > 512
      || typeof config.model !== 'string' || config.model.length === 0 || config.model.length > 512) continue
    const route = { provider: config.provider, model: config.model }
    const messages = { request: textBlocks(user.data.content), answer: textBlocks(answer.data.message.content), correction: item.note }
    if (messages.request.trim().length === 0 || messages.answer.trim().length === 0 || Buffer.byteLength(JSON.stringify(messages)) > 24_000) continue
    const source = explicitFeedbackSourceSchema.parse({ kind: 'message-feedback-v1', workspaceId, sessionId, turn: end.data.turn,
      userSeq: user.seq, assistantSeq: answer.seq, turnEndSeq: end.seq, feedbackSeq, messageId: item.messageId,
      feedbackVersion: item.version, feedbackUpdatedAt: item.updatedAt, itemDigest: digest(item),
      prefixDigest: digest({ meta: stored.meta, inheritedEventCount: stored.inheritedEventCount, events: stored.events.slice(0, feedbackSeq + 1) }),
      inputDigest: digest({ messages, route }), modelIdentityDigest: digest(route) })
    inputs.push({ source, route, messages })
  }
  return inputs.sort((a, b) => b.source.feedbackUpdatedAt - a.source.feedbackUpdatedAt || b.source.feedbackSeq - a.source.feedbackSeq)
}

/** Joins the native feedback queue, then verifies the durable prefix against its current view. */
export async function readMessageFeedbackInputs(ctx: Context, reader: DurableFeedbackAttribution,
  workspaceId: string, sessionId: string): Promise<{ inputs: ExplicitFeedbackInput[]; cwd: string | undefined }> {
  const listed = await runWithLifecycleDeadline(ctx, () => ctx.messageFeedback.list({ sessionId: sessionId as SessionId }), {
    timeoutMs: 30_000, label: 'dsh-evolve.conversationDraft.feedbackBarrier', timeoutMessage: 'Message feedback source unavailable',
  })
  if (!listed.ok) throw new Error('message feedback source Session unavailable')
  const stored = await reader.readStoredSession(sessionId, MAX_EVENTS + 1)
  if (await workspaceIdForCwd(ctx, stored.meta.cwd) !== workspaceId) throw new Error('message feedback source Workspace changed')
  return { inputs: projectMessageFeedbackInputs(stored, workspaceId, sessionId, listed.value.items), cwd: stored.meta.cwd }
}

/** Both draft authoring and trial execution use the same current, durable source resolver. */
export async function resolveConversationDraftOrigin(ctx: Context, reader: DurableFeedbackAttribution,
  corrections: CorrectionLedger, origin: ConversationDraftOrigin): Promise<{ input: ConversationDraftInput; cwd: string | undefined } | undefined> {
  const { workspaceId, sessionId } = origin.source
  if (isExplicitFeedbackOrigin(origin)) {
    if (origin.id !== explicitFeedbackId(origin.source)) return undefined
    const fresh = await readMessageFeedbackInputs(ctx, reader, workspaceId, sessionId)
    const input = fresh.inputs.find(input => digest(input.source) === digest(origin.source))
    return input === undefined ? undefined : { input, cwd: fresh.cwd }
  }
  if (origin.phase !== 'classified' || origin.interpretation?.kind !== 'correction') return undefined
  const stored = await reader.readStoredSession(sessionId, origin.source.turnEndSeq + 1)
  if (await workspaceIdForCwd(ctx, stored.meta.cwd) !== workspaceId) return undefined
  const current = corrections.records(workspaceId).find(record => record.id === origin.id)
  const input = projectCorrectionInput(stored, workspaceId, sessionId, origin.source.turnEndSeq)
  return current === undefined || digest(current) !== digest(origin) || input === undefined || digest(input.source) !== digest(origin.source)
    ? undefined : { input, cwd: stored.meta.cwd }
}

function textBlocks(blocks: readonly { readonly type: string }[]): string {
  return blocks.flatMap(block => block.type === 'text' && typeof (block as { text?: unknown }).text === 'string'
    ? [(block as { type: string; text: string }).text] : []).join('\n')
}
