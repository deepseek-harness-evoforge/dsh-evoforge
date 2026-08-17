import { describe, expect, it } from 'vitest'
import {
  beginFeishuDelivery,
  classifyFeishuSendFailure,
  recoverFeishuDelivery,
  type FeishuDeliveryState,
} from '../src/delivery-state.js'

const prepared: FeishuDeliveryState = { status: 'prepared', attempts: 0, updatedAt: 100 }

describe('Feishu delivery state', () => {
  it('persists sending intent before the external effect', () => {
    expect(beginFeishuDelivery(prepared, 200)).toEqual({ status: 'sending', attempts: 1, updatedAt: 200 })
  })

  it('recovers an interrupted send as uncertain without replay', () => {
    expect(recoverFeishuDelivery({ status: 'sending', attempts: 1, updatedAt: 200 }, 300))
      .toMatchObject({ status: 'uncertain', attempts: 1, error: expect.stringContaining('automatic retry is disabled') })
  })

  it('retries only a bounded proven rate-limit rejection', () => {
    expect(classifyFeishuSendFailure(
      { kind: 'rate-limited', retryAfterMs: 2_000 },
      { status: 'sending', attempts: 1, updatedAt: 200 },
      1_000,
      3,
      300_000,
    )).toEqual({
      status: 'retrying',
      attempts: 1,
      updatedAt: 1_000,
      nextAttemptAt: 3_000,
      error: 'Feishu rejected the request with a pre-acceptance rate limit.',
    })
  })

  it.each([
    { kind: 'transport' as const },
    { kind: 'invalid-response' as const },
  ])('holds $kind failures as uncertain', (failure) => {
    expect(classifyFeishuSendFailure(
      failure,
      { status: 'sending', attempts: 1, updatedAt: 200 },
      1_000,
      3,
      300_000,
    )).toMatchObject({ status: 'uncertain', attempts: 1 })
  })

  it('fails a rejected message or an unsafe rate-limit delay without retry', () => {
    const sending = { status: 'sending' as const, attempts: 1, updatedAt: 200 }
    expect(classifyFeishuSendFailure(
      { kind: 'rejected', code: 'permission_denied' }, sending, 1_000, 3, 300_000,
    )).toMatchObject({ status: 'failed' })
    expect(classifyFeishuSendFailure(
      { kind: 'rate-limited', retryAfterMs: 300_001 }, sending, 1_000, 3, 300_000,
    )).toMatchObject({ status: 'failed' })
  })
})
