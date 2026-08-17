import { describe, expect, it } from 'vitest'
import { selectApprovalCallback, selectInboundUpdate } from '../src/inbound.js'

const route = { chatId: 1001, userId: 2002 }

describe('Telegram inbound selection', () => {
  it('turns one exact private-chat text update into a deterministic DSH message', () => {
    expect(selectInboundUpdate({
      update_id: 77,
      message: {
        message_id: 9,
        chat: { id: 1001, type: 'private' },
        from: { id: 2002, is_bot: false },
        text: 'continue the native Goal',
      },
    }, route)).toEqual({
      kind: 'message',
      replyToMessageId: 9,
      text: 'continue the native Goal',
      updateId: 77,
    })
  })

  it('leaves slash-command admission to the shared native Router', () => {
    expect(selectInboundUpdate({
      update_id: 78,
      message: {
        message_id: 10,
        chat: { id: 1001, type: 'private' },
        from: { id: 2002, is_bot: false },
        text: '/goal status',
      },
    }, route)).toMatchObject({ kind: 'message', text: '/goal status', updateId: 78 })
  })

  it.each([
    { label: 'wrong chat', chat: { id: 9999, type: 'private' }, from: { id: 2002, is_bot: false } },
    { label: 'wrong user', chat: { id: 1001, type: 'private' }, from: { id: 9999, is_bot: false } },
    { label: 'group', chat: { id: 1001, type: 'group' }, from: { id: 2002, is_bot: false } },
    { label: 'bot sender', chat: { id: 1001, type: 'private' }, from: { id: 2002, is_bot: true } },
  ])('ignores $label without exposing route state', ({ chat, from }) => {
    expect(selectInboundUpdate({
      update_id: 79,
      message: { message_id: 11, chat, from, text: 'secret?' },
    }, route)).toEqual({ kind: 'ignored', updateId: 79 })
  })

  it('ignores media and empty text instead of inventing a model request', () => {
    expect(selectInboundUpdate({
      update_id: 80,
      message: {
        message_id: 12,
        chat: { id: 1001, type: 'private' },
        from: { id: 2002, is_bot: false },
      },
    }, route)).toEqual({ kind: 'ignored', updateId: 80 })
  })
})

describe('Telegram approval callback selection', () => {
  it.each([
    ['allow', 'allowed-once'],
    ['reject', 'rejected'],
  ] as const)('accepts one exact private callback action: %s', (action, outcome) => {
    expect(selectApprovalCallback({
      update_id: 91,
      callback_query: {
        id: 'callback-1',
        from: { id: 2002, is_bot: false },
        message: { message_id: 31, chat: { id: 1001, type: 'private' } },
        data: `dsh:a:nonce123:${action}`,
      },
    }, route)).toEqual({
      kind: 'approval-callback',
      callbackQueryId: 'callback-1',
      nonce: 'nonce123',
      outcome,
      updateId: 91,
    })
  })

  it.each([
    { label: 'wrong user', from: { id: 9999, is_bot: false }, data: 'dsh:a:n:allow' },
    { label: 'wrong chat', chat: { id: 9999, type: 'private' }, data: 'dsh:a:n:allow' },
    { label: 'group chat', chat: { id: 1001, type: 'group' }, data: 'dsh:a:n:allow' },
    { label: 'unknown action', chat: { id: 1001, type: 'private' }, data: 'dsh:a:n:always' },
    { label: 'oversized data', chat: { id: 1001, type: 'private' }, data: `dsh:a:${'x'.repeat(60)}:allow` },
  ])('ignores $label', ({ from = { id: 2002, is_bot: false }, chat = { id: 1001, type: 'private' }, data }) => {
    expect(selectApprovalCallback({
      update_id: 92,
      callback_query: {
        id: 'callback-2',
        from,
        message: { message_id: 32, chat },
        data,
      },
    }, route)).toEqual({ kind: 'ignored', updateId: 92 })
  })
})
