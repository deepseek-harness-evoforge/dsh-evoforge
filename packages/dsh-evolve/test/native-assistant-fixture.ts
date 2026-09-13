import { MessageId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'

/** Write the same settled message through the actual native format's grammar. */
export function appendNativeAssistantFixture(
  session: Session,
  data: Omit<SessionEvent<'assistant/message'>['data'], 'stream'>,
  chunks: readonly StreamChunk[],
): void {
  const format = Number(session.header.version)
  if (format === 0) {
    const sourceEventSeqs = chunks.map(chunk => {
      // Retired vocabulary is used only on an actual alpha.5 Session.
      const event: unknown = Reflect.apply(session.append, session, [
        'assistant/chunk', { turn: data.turn, step: data.step, chunk },
      ])
      if (event === null || typeof event !== 'object' || !('seq' in event)
        || typeof event.seq !== 'number') throw new Error('invalid native v0 chunk receipt')
      return SessionSeq(event.seq)
    })
    Reflect.apply(session.append, session, [
      'assistant/message', data, { surfaceOp: 'append', sourceEventSeqs },
    ])
  } else if (format === 3) {
    const embedded = {
      ...data,
      stream: chunks.map(chunk => ({ type: 'chunk' as const, time: Date.now(), chunk })),
    }
    session.append('assistant/message', embedded, { surfaceOp: 'append' })
  } else {
    throw new Error(`unsupported native fixture format ${format}`)
  }
}

/** Current AgentLoop installs its System head before admitting request input. */
export function appendNativeSystemHeadFixture(session: Session, text = ''): void {
  const format = Number(session.header.version)
  if (format === 0) return
  if (format !== 3) throw new Error(`unsupported native fixture format ${format}`)
  Reflect.apply(session.append, session, ['system/message', {
    turn: 1,
    step: 1,
    message: {
      id: MessageId('fixture-system-head'),
      role: 'system',
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
      content: text.length === 0 ? [] : [{ type: 'text', text }],
    },
  }, { surfaceOp: 'append' }])
}
