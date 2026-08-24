import { createHash } from 'node:crypto'
import { dirname, isAbsolute, resolve } from 'node:path'
import { boundedModelProviderIdentity } from '../../../packages/dsh-evolve/src/model-provider-identity.ts'

export const BENCHMARK_ID = 'rp1-internal-skill-evolution-epoch-1'
export const PAID_PROVIDER_APPROVAL = 'I_APPROVE_PAID_REAL_PROVIDER_EVALUATION'

const requiredNames = [
  'DSH_EVOLVE_MODEL_PROVIDER_ID',
  'DSH_EVOLVE_MODEL_BASE_URL',
  'DSH_EVOLVE_MODEL_NAME',
  'DSH_EVOLVE_MODEL_API_KEY',
  'DSH_EVOLVE_GOVERNANCE_MODEL_PROVIDER_ID',
  'DSH_EVOLVE_GOVERNANCE_MODEL_BASE_URL',
  'DSH_EVOLVE_GOVERNANCE_MODEL_NAME',
  'DSH_EVOLVE_GOVERNANCE_MODEL_API_KEY',
  'DSH_EVOLVE_DSH_SOURCE_DIR',
  'DSH_EVOLVE_REAL_PROVIDER_RUN_ROOT',
] as const

type RequiredName = typeof requiredNames[number]

export interface RealProviderExecutionConfig {
  readonly proposer: RealProviderEndpoint
  readonly governance: RealProviderEndpoint
  readonly dshSourceDir: string
  readonly runRoot: string
}

interface RealProviderEndpoint {
  readonly providerId: string
  readonly baseUrl: string
  readonly model: string
  readonly apiKey: string
  readonly modelIdentity: string
  readonly authority: string
}

interface PublicProviderIdentity {
  readonly providerId: string
  readonly model: string
  readonly authorityHash: string
  readonly modelIdentity: string
}

export type RealProviderAcceptanceResolution =
  | {
      readonly status: 'not-run' | 'failed'
      readonly exitCode: 1 | 2
      readonly report: {
        readonly schemaVersion: 1
        readonly benchmarkId: typeof BENCHMARK_ID
        readonly status: 'not-run' | 'failed'
        readonly reasons: readonly string[]
      }
    }
  | {
      readonly status: 'ready'
      readonly report: {
        readonly schemaVersion: 1
        readonly benchmarkId: typeof BENCHMARK_ID
        readonly status: 'ready'
        readonly proposer: PublicProviderIdentity
        readonly governance: PublicProviderIdentity
      }
      readonly execution: RealProviderExecutionConfig
      readonly exitCode?: undefined
    }

/**
 * Resolve the one RP-1 invocation. Approval is checked before any provider or
 * credential value is read; only the private execution object retains secrets.
 */
export function resolveRealProviderAcceptance(
  environment: NodeJS.ProcessEnv,
): RealProviderAcceptanceResolution {
  if (environment.DSH_EVOLVE_REAL_PROVIDER_APPROVED !== PAID_PROVIDER_APPROVAL) {
    return stopped('not-run', 2, ['paid-provider-execution-not-authorized'])
  }

  const missing = requiredNames.filter(name => !hasExactValue(environment[name]))
  if (missing.length > 0) {
    return stopped('not-run', 2, missing.map(name => `missing:${name}`))
  }

  let proposer: RealProviderEndpoint
  let governance: RealProviderEndpoint
  let dshSourceDir: string
  let runRoot: string
  try {
    proposer = endpoint(environment, {
      providerId: 'DSH_EVOLVE_MODEL_PROVIDER_ID',
      baseUrl: 'DSH_EVOLVE_MODEL_BASE_URL',
      model: 'DSH_EVOLVE_MODEL_NAME',
      apiKey: 'DSH_EVOLVE_MODEL_API_KEY',
    })
    governance = endpoint(environment, {
      providerId: 'DSH_EVOLVE_GOVERNANCE_MODEL_PROVIDER_ID',
      baseUrl: 'DSH_EVOLVE_GOVERNANCE_MODEL_BASE_URL',
      model: 'DSH_EVOLVE_GOVERNANCE_MODEL_NAME',
      apiKey: 'DSH_EVOLVE_GOVERNANCE_MODEL_API_KEY',
    })
    dshSourceDir = exactAbsolutePath(environment.DSH_EVOLVE_DSH_SOURCE_DIR!, 'DSH_EVOLVE_DSH_SOURCE_DIR')
    runRoot = exactAbsolutePath(
      environment.DSH_EVOLVE_REAL_PROVIDER_RUN_ROOT!,
      'DSH_EVOLVE_REAL_PROVIDER_RUN_ROOT',
    )
  } catch (error) {
    return stopped('failed', 1, [boundedReason(error)])
  }

  if (proposer.providerId === governance.providerId) {
    return stopped('failed', 1, ['providers-not-independent:declared-identity'])
  }
  if (proposer.authority === governance.authority) {
    return stopped('failed', 1, ['providers-not-independent:authority'])
  }
  if (proposer.apiKey === governance.apiKey) {
    return stopped('failed', 1, ['providers-not-independent:credential'])
  }
  if (proposer.modelIdentity === governance.modelIdentity) {
    return stopped('failed', 1, ['providers-not-independent:production-model-identity'])
  }
  if (containsPath(dshSourceDir, runRoot) || containsPath(runRoot, dshSourceDir)) {
    return stopped('failed', 1, ['invalid:acceptance-roots-overlap'])
  }

  return Object.freeze({
    status: 'ready',
    report: Object.freeze({
      schemaVersion: 1,
      benchmarkId: BENCHMARK_ID,
      status: 'ready',
      proposer: publicIdentity(proposer),
      governance: publicIdentity(governance),
    }),
    execution: Object.freeze({ proposer, governance, dshSourceDir, runRoot }),
  })
}

function endpoint(
  environment: NodeJS.ProcessEnv,
  names: {
    readonly providerId: RequiredName
    readonly baseUrl: RequiredName
    readonly model: RequiredName
    readonly apiKey: RequiredName
  },
): RealProviderEndpoint {
  const providerId = exact(environment[names.providerId]!, names.providerId)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(providerId)) {
    throw new Error(`invalid:${names.providerId}`)
  }
  const baseUrl = normalizedBaseUrl(exact(environment[names.baseUrl]!, names.baseUrl), names.baseUrl)
  const model = exact(environment[names.model]!, names.model, 512)
  const apiKey = exactSecret(environment[names.apiKey]!, names.apiKey)
  return Object.freeze({
    providerId,
    baseUrl,
    model,
    apiKey,
    modelIdentity: boundedModelProviderIdentity(baseUrl, model),
    authority: new URL(baseUrl).origin.toLowerCase(),
  })
}

function normalizedBaseUrl(value: string, name: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`invalid:${name}`)
  }
  if (parsed.protocol !== 'https:'
    || parsed.hostname === '127.0.0.1'
    || parsed.hostname === 'localhost'
    || parsed.hostname === '::1'
    || parsed.hostname === '[::1]'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.search !== ''
    || parsed.hash !== '') {
    throw new Error(`invalid:${name}`)
  }
  return value.replace(/\/+$/u, '')
}

function exactAbsolutePath(value: string, name: string): string {
  const exactValue = exact(value, name, 4_096)
  if (!isAbsolute(exactValue)) throw new Error(`invalid:${name}`)
  const canonical = resolve(exactValue)
  if (canonical !== exactValue || dirname(canonical) === canonical) throw new Error(`invalid:${name}`)
  return canonical
}

function exact(value: string, name: string, maxBytes = 1_024): string {
  if (!hasExactValue(value)
    || Buffer.byteLength(value) > maxBytes
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`invalid:${name}`)
  }
  return value
}

function exactSecret(value: string, name: string): string {
  return exact(value, name, 16 * 1_024)
}

function hasExactValue(value: string | undefined): value is string {
  return value !== undefined && value !== '' && value.trim() === value
}

function publicIdentity(endpoint: RealProviderEndpoint): PublicProviderIdentity {
  return Object.freeze({
    providerId: endpoint.providerId,
    model: endpoint.model,
    authorityHash: sha256(endpoint.authority),
    modelIdentity: endpoint.modelIdentity,
  })
}

function stopped(
  status: 'not-run' | 'failed',
  exitCode: 1 | 2,
  reasons: readonly string[],
): Extract<RealProviderAcceptanceResolution, { status: 'not-run' | 'failed' }> {
  return Object.freeze({
    status,
    exitCode,
    report: Object.freeze({
      schemaVersion: 1,
      benchmarkId: BENCHMARK_ID,
      status,
      reasons: Object.freeze([...reasons]),
    }),
  })
}

function containsPath(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`)
}

function boundedReason(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replace(/[\r\n]+/gu, ' ').slice(0, 256) || 'invalid:unknown'
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
