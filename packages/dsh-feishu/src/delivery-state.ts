export type FeishuDeliveryStatus = 'prepared' | 'sending' | 'retrying' | 'delivered' | 'uncertain' | 'failed'

export interface FeishuDeliveryState {
  readonly status: FeishuDeliveryStatus
  readonly attempts: number
  readonly updatedAt: number
  readonly nextAttemptAt?: number | undefined
  readonly feishuMessageId?: string | undefined
  readonly error?: string | undefined
}

export type FeishuSendFailure =
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'rejected'; readonly code: string }
  | { readonly kind: 'transport' }
  | { readonly kind: 'invalid-response' }

export function beginFeishuDelivery<T extends FeishuDeliveryState>(record: T, now: number): T {
  if (record.status !== 'prepared' && record.status !== 'retrying') {
    throw new Error(`cannot begin Feishu delivery from ${record.status}`)
  }
  return clean({ ...record, status: 'sending', attempts: record.attempts + 1, updatedAt: exactTime(now) })
}

/** A crashed in-flight call may have reached Feishu, so automatic replay is unsafe. */
export function recoverFeishuDelivery<T extends FeishuDeliveryState>(record: T, now: number): T {
  if (record.status !== 'sending') return record
  return clean({
    ...record,
    status: 'uncertain',
    updatedAt: exactTime(now),
    error: 'The prior send may have reached Feishu; automatic retry is disabled.',
  })
}

/** Retry only a proven pre-acceptance rate limit; every ambiguous failure becomes uncertain. */
export function classifyFeishuSendFailure<T extends FeishuDeliveryState>(
  failure: FeishuSendFailure,
  record: T,
  now: number,
  maxAttempts: number,
  maxRetryAfterMs: number,
): T {
  if (record.status !== 'sending') throw new Error('Feishu send failure requires a sending record')
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be positive')
  if (!Number.isSafeInteger(maxRetryAfterMs) || maxRetryAfterMs < 1) throw new Error('maxRetryAfterMs must be positive')
  const updatedAt = exactTime(now)
  if (failure.kind === 'rate-limited') {
    const retryAfterMs = failure.retryAfterMs
    if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 1 || retryAfterMs > maxRetryAfterMs) {
      return clean({
        ...record,
        status: 'failed',
        updatedAt,
        error: 'Feishu rate-limit delay was invalid or exceeded the configured safety bound.',
      })
    }
    if (record.attempts < maxAttempts) {
      return clean({
        ...record,
        status: 'retrying',
        updatedAt,
        nextAttemptAt: updatedAt + retryAfterMs,
        error: 'Feishu rejected the request with a pre-acceptance rate limit.',
      })
    }
    return clean({
      ...record,
      status: 'failed',
      updatedAt,
      error: 'Feishu rate-limit retry bound was exhausted.',
    })
  }
  if (failure.kind === 'rejected') {
    return clean({
      ...record,
      status: 'failed',
      updatedAt,
      error: `Feishu rejected the message before acceptance (${failure.code}).`,
    })
  }
  return clean({
    ...record,
    status: 'uncertain',
    updatedAt,
    error: 'Feishu did not prove whether the message was accepted; automatic retry is disabled.',
  })
}

function exactTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('delivery time must be non-negative')
  return value
}

function clean<T extends FeishuDeliveryState>(record: T): T {
  const copy = { ...record }
  if (record.status !== 'retrying') Reflect.deleteProperty(copy, 'nextAttemptAt')
  if (record.status !== 'delivered') Reflect.deleteProperty(copy, 'feishuMessageId')
  return Object.freeze(copy)
}
