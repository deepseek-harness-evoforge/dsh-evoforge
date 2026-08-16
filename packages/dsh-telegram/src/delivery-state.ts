export type DeliveryStatus = 'prepared' | 'sending' | 'retrying' | 'delivered' | 'uncertain' | 'failed'

export interface DeliveryRecord {
  readonly id: string
  readonly schemaVersion: 1
  readonly sessionId: string
  readonly turn?: number | undefined
  readonly status: DeliveryStatus
  readonly attempts: number
  readonly updatedAt: number
  readonly nextAttemptAt?: number | undefined
  readonly telegramMessageId?: number | undefined
  readonly error?: string | undefined
}

export type SendFailure =
  | { readonly kind: 'transport' }
  | { readonly kind: 'invalid-response' }
  | {
      readonly kind: 'telegram-rejected'
      readonly errorCode: number
      readonly retryAfterSeconds?: number
    }

/** Persist this transition before calling Telegram. */
export function beginDelivery<T extends DeliveryRecord>(record: T, now: number): T {
  if (record.status !== 'prepared' && record.status !== 'retrying') {
    throw new Error(`cannot begin Telegram delivery from ${record.status}`)
  }
  return clean({
    ...record,
    status: 'sending',
    attempts: record.attempts + 1,
    updatedAt: exactTime(now),
  })
}

/** A process restart cannot know whether an in-flight request reached Telegram. */
export function recoverDelivery<T extends DeliveryRecord>(record: T, now: number): T {
  if (record.status !== 'sending') return record
  return clean({
    ...record,
    status: 'uncertain',
    updatedAt: exactTime(now),
    error: 'The prior send may have reached Telegram; automatic retry is disabled.',
  })
}

/** Retry only an explicit pre-acceptance rate-limit rejection. */
export function classifySendFailure<T extends DeliveryRecord>(
  failure: SendFailure,
  record: T,
  now: number,
  maxAttempts: number,
): T {
  if (record.status !== 'sending') throw new Error('send failure requires a sending record')
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive safe integer')
  }
  const updatedAt = exactTime(now)
  const retryAfter = failure.kind === 'telegram-rejected'
    && failure.errorCode === 429
    && Number.isSafeInteger(failure.retryAfterSeconds)
    && (failure.retryAfterSeconds as number) > 0
      ? failure.retryAfterSeconds as number
      : undefined
  if (retryAfter !== undefined && record.attempts < maxAttempts) {
    return clean({
      ...record,
      status: 'retrying',
      updatedAt,
      nextAttemptAt: updatedAt + retryAfter * 1_000,
      error: 'Telegram rate limited the request before accepting it.',
    })
  }
  if (retryAfter !== undefined) {
    return clean({
      ...record,
      status: 'failed',
      updatedAt,
      error: 'Telegram rate-limit retry bound was exhausted.',
    })
  }
  return clean({
    ...record,
    status: 'uncertain',
    updatedAt,
    error: 'Telegram did not provide proof that the message was not accepted; automatic retry is disabled.',
  })
}

function exactTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('delivery time must be a non-negative safe integer')
  return value
}

function clean<T extends DeliveryRecord>(record: T): T {
  const copy = { ...record }
  if (record.status !== 'retrying') Reflect.deleteProperty(copy, 'nextAttemptAt')
  if (record.status !== 'delivered') Reflect.deleteProperty(copy, 'telegramMessageId')
  return Object.freeze(copy)
}
