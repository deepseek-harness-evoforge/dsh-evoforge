import { describe, expect, it } from 'vitest'
import {
  beginDelivery,
  classifySendFailure,
  recoverDelivery,
  type DeliveryRecord,
} from '../src/delivery-state.js'

const prepared: DeliveryRecord = {
  id: 'session-1:turn-3',
  schemaVersion: 1,
  sessionId: 'session-1',
  turn: 3,
  status: 'prepared',
  attempts: 0,
  updatedAt: 100,
}

describe('Telegram delivery state', () => {
  it('writes sending intent before the external call', () => {
    expect(beginDelivery(prepared, 200)).toEqual({
      ...prepared,
      status: 'sending',
      attempts: 1,
      updatedAt: 200,
    })
  })

  it('turns a crash-recovered sending record into uncertain without retry', () => {
    expect(recoverDelivery({ ...prepared, status: 'sending', attempts: 1 }, 300)).toEqual({
      ...prepared,
      status: 'uncertain',
      attempts: 1,
      updatedAt: 300,
      error: 'The prior send may have reached Telegram; automatic retry is disabled.',
    })
  })

  it('retries only a definite Telegram rate-limit rejection within the bound', () => {
    expect(classifySendFailure({ kind: 'telegram-rejected', errorCode: 429, retryAfterSeconds: 7 }, {
      ...prepared,
      status: 'sending',
      attempts: 1,
    }, 1_000, 3)).toEqual({
      ...prepared,
      status: 'retrying',
      attempts: 1,
      updatedAt: 1_000,
      nextAttemptAt: 8_000,
      error: 'Telegram rate limited the request before accepting it.',
    })
  })

  it.each([
    { kind: 'transport' as const },
    { kind: 'invalid-response' as const },
    { kind: 'telegram-rejected' as const, errorCode: 500 },
  ])('holds $kind failures as uncertain', (failure) => {
    const result = classifySendFailure(failure, {
      ...prepared,
      status: 'sending',
      attempts: 1,
    }, 2_000, 3)
    expect(result).toMatchObject({ status: 'uncertain', attempts: 1 })
    expect(result).not.toHaveProperty('nextAttemptAt')
  })

  it('does not retry a rate limit after the configured attempt bound', () => {
    expect(classifySendFailure({ kind: 'telegram-rejected', errorCode: 429, retryAfterSeconds: 2 }, {
      ...prepared,
      status: 'sending',
      attempts: 3,
    }, 3_000, 3)).toMatchObject({ status: 'failed', attempts: 3 })
  })
})
