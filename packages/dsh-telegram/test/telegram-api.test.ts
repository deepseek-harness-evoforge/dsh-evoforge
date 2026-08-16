import { describe, expect, it, vi } from 'vitest'
import { TelegramApi } from '../src/telegram-api.js'

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

describe('Telegram Bot API boundary', () => {
  it('long-polls only message and callback_query updates from the exact offset', async () => {
    const fetch = vi.fn<Fetch>(async () => new Response(JSON.stringify({
      ok: true,
      result: [{ update_id: 9, message: { message_id: 1 } }],
    }), { status: 200 }))
    const api = new TelegramApi({ token: 'test-token', apiBase: 'https://telegram.invalid', fetch })

    await expect(api.getUpdates(9, 25, new AbortController().signal)).resolves.toEqual([
      { update_id: 9, message: { message_id: 1 } },
    ])
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://telegram.invalid/bottest-token/getUpdates')
    expect(init).toMatchObject({ method: 'POST', signal: expect.any(AbortSignal) })
    expect(JSON.parse(String(init?.body))).toEqual({
      allowed_updates: ['message', 'callback_query'],
      limit: 100,
      offset: 9,
      timeout: 25,
    })
  })

  it('sends one plain bounded message without paid broadcast or parse mode', async () => {
    const fetch = vi.fn<Fetch>(async () => new Response(JSON.stringify({
      ok: true,
      result: { message_id: 44 },
    }), { status: 200 }))
    const api = new TelegramApi({ token: 'test-token', apiBase: 'https://telegram.invalid', fetch })

    await expect(api.sendText({
      chatId: 1001,
      text: 'done',
      replyToMessageId: 8,
    }, new AbortController().signal)).resolves.toEqual({ ok: true, messageId: 44 })
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body))
    expect(body).toEqual({
      chat_id: 1001,
      reply_parameters: { allow_sending_without_reply: true, message_id: 8 },
      text: 'done',
    })
    expect(body).not.toHaveProperty('allow_paid_broadcast')
    expect(body).not.toHaveProperty('parse_mode')
  })

  it('returns a definite bounded retry only for an explicit 429 response', async () => {
    const fetch = vi.fn<Fetch>(async () => new Response(JSON.stringify({
      ok: false,
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 6 },
    }), { status: 429 }))
    const api = new TelegramApi({ token: 'secret-never-report', apiBase: 'https://telegram.invalid', fetch })

    await expect(api.sendText({ chatId: 1001, text: 'done' }, new AbortController().signal))
      .resolves.toEqual({
        ok: false,
        failure: { kind: 'telegram-rejected', errorCode: 429, retryAfterSeconds: 6 },
      })
  })

  it('classifies transport and malformed results as uncertain without exposing the token', async () => {
    const transport = new TelegramApi({
      token: 'secret-never-report',
      apiBase: 'https://telegram.invalid',
      fetch: vi.fn<Fetch>(async () => { throw new Error('network failed') }),
    })
    const malformed = new TelegramApi({
      token: 'secret-never-report',
      apiBase: 'https://telegram.invalid',
      fetch: vi.fn<Fetch>(async () => new Response('{', { status: 200 })),
    })

    const first = await transport.sendText({ chatId: 1001, text: 'done' }, new AbortController().signal)
    const second = await malformed.sendText({ chatId: 1001, text: 'done' }, new AbortController().signal)
    expect(first).toEqual({ ok: false, failure: { kind: 'transport' } })
    expect(second).toEqual({ ok: false, failure: { kind: 'invalid-response' } })
    expect(JSON.stringify([first, second])).not.toContain('secret-never-report')
  })

  it('answers an approval callback even when no toast text is needed', async () => {
    const fetch = vi.fn<Fetch>(async () => new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }))
    const api = new TelegramApi({ token: 'test-token', apiBase: 'https://telegram.invalid', fetch })

    await expect(api.answerCallback('callback-1', new AbortController().signal)).resolves.toBe(true)
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ callback_query_id: 'callback-1' })
  })
})
