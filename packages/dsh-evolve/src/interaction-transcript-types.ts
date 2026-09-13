import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-tools'
import type { ContentBlock, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import type {
  SessionEventMap,
  SessionHeader,
  SessionSeq,
  SurfaceOp,
} from '@deepseek-ai/dsh-session'

/** Historical input, never a declaration of events writable by the live Host. */
export type TranscriptHeader = Omit<SessionHeader, 'version'> & { readonly version: number }

interface LegacyDispatchStart {
  rootCallId: ToolCallId
  parentCallId: ToolCallId
  subCallId: ToolCallId
  name: string
  arguments: unknown
}

type TranscriptEventMap = Omit<SessionEventMap, 'assistant/message'> & {
  'assistant/message': Omit<SessionEventMap['assistant/message'], 'stream'> & { stream?: unknown }
  'assistant/chunk': { turn: number; step: number; chunk: StreamChunk }
  'tool/code-dispatch-start': LegacyDispatchStart
  'tool/code-dispatch': LegacyDispatchStart & { isError: boolean; content: ContentBlock[] }
}

type TranscriptSurfaceOp = SurfaceOp | { op: 'replace'; start: SessionSeq; end: SessionSeq }

/**
 * Explicit read vocabulary for the v0/v3 dialect validators. The union is not
 * itself proof of validity: unknown fields and mixed formats still abstain.
 * Do not augment the native SessionEventMap with retired event names.
 */
export type TranscriptEvent<Type extends keyof TranscriptEventMap = keyof TranscriptEventMap> = {
  [Key in keyof TranscriptEventMap]: {
    type: Key
    seq: SessionSeq
    time: number
    data: TranscriptEventMap[Key]
    ignorable?: true
    surfaceOp?: TranscriptSurfaceOp
    sourceEventSeqs?: SessionSeq[]
  }
}[Type]

export function isTranscriptAppend(event: TranscriptEvent): boolean {
  return isMessageEvent(event) && event.surfaceOp === 'append'
}

export function isTranscriptReplacement(event: TranscriptEvent): boolean {
  return isMessageEvent(event) && event.surfaceOp !== undefined && event.surfaceOp !== 'append'
}

function isMessageEvent(event: TranscriptEvent): boolean {
  return event.type === 'user/message' || event.type === 'assistant/message'
    || event.type === 'tool/result' || String(event.type) === 'system/message'
}
