import { createHash } from 'node:crypto'

/** Stable secret-free identity shared by proposer and governance provider seams. */
export function boundedModelProviderIdentity(baseUrl: string, model: string): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/u, '')
  const normalizedModel = model.trim()
  if (normalizedBaseUrl === ''
    || normalizedModel === ''
    || Buffer.byteLength(normalizedBaseUrl) > 1_024
    || Buffer.byteLength(normalizedModel) > 512) {
    throw new Error('bounded model provider identity is invalid')
  }
  return createHash('sha256').update(JSON.stringify({
    kind: 'bounded-model-provider-v1',
    baseUrl: normalizedBaseUrl,
    model: normalizedModel,
  })).digest('hex')
}
