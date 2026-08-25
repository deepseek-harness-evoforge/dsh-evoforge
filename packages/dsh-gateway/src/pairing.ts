import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  endpointKey,
  resolveGatewayRoutes,
  type GatewayEndpoint,
  type ResolvedGatewayRoute,
} from './routing.js'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 10
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{10}$/u

const endpointSchema = z.strictObject({
  adapter: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/u),
  accountId: z.string().trim().min(1).max(256),
  conversationId: z.string().trim().min(1).max(512),
  threadId: z.string().trim().min(1).max(512).optional(),
  userId: z.string().trim().min(1).max(512),
})

const targetSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),
  workspaceId: z.string().trim().min(1).max(512),
  sessionId: z.string().trim().min(1).max(512),
  agentPreset: z.string().trim().min(1).max(128),
  provider: z.string().trim().min(1).max(128),
  model: z.string().trim().min(1).max(256),
  maxTokens: z.number().int().positive().optional(),
})

const pendingSchema = z.strictObject({
  kind: z.literal('pending'),
  requestId: z.string().regex(/^[a-f0-9]{32}$/u),
  schemaVersion: z.literal(1),
  endpoint: endpointSchema,
  salt: z.string().regex(/^[a-f0-9]{32}$/u),
  codeHash: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
})

const routeSchema = z.strictObject({
  id: z.string(),
  adapter: z.string(),
  accountId: z.string(),
  conversationId: z.string(),
  threadId: z.string().optional(),
  userId: z.string(),
  workspaceId: z.string(),
  sessionId: z.string(),
  agentPreset: z.string(),
  provider: z.string(),
  model: z.string(),
  maxTokens: z.number().int().positive().optional(),
  endpointKey: z.string(),
})

const grantSchema = z.strictObject({
  kind: z.literal('grant'),
  grantId: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaVersion: z.literal(1),
  requestId: z.string().regex(/^[a-f0-9]{32}$/u),
  route: routeSchema,
  approvedAt: z.number().int().nonnegative(),
})

const bindingSchema = z.discriminatedUnion('kind', [pendingSchema, grantSchema])

const pairingDomainSpec = defineDomain({
  name: 'evoforge_gateway_pairing',
  version: 1,
  global: { schema: z.strictObject({}), initial: {} },
  tables: {
    bindings: domainTable<string, GatewayPairingBinding>(bindingSchema),
  },
})

type PairingDomain = Domain<typeof pairingDomainSpec>
export type GatewayPairingRequest = z.infer<typeof pendingSchema>
export type GatewayTrustGrant = z.infer<typeof grantSchema>
type GatewayPairingBinding = z.infer<typeof bindingSchema>
export interface GatewayPairingTarget {
  readonly id: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly agentPreset: string
  readonly provider: string
  readonly model: string
  readonly maxTokens?: number
}

export type GatewayPairingOffer =
  | { readonly kind: 'offered'; readonly code: string; readonly expiresAt: number }
  | { readonly kind: 'already-trusted'; readonly route: ResolvedGatewayRoute }
  | { readonly kind: 'suppressed'; readonly reason: 'pending' | 'capacity' }

export interface GatewayPairingApprovalInput {
  readonly adapter: string
  /** Optional account scope; omitted Host approvals search the named Adapter and reject ambiguity. */
  readonly accountId?: string
  readonly code: string
  readonly target: GatewayPairingTarget
  readonly now: number
}

export interface GatewayPairingApproval {
  readonly grantId: string
  readonly route: ResolvedGatewayRoute
}

export interface GatewayPairingAuthorityOptions {
  readonly codeTtlMs: number
  readonly maxPendingPerAccount: number
}

/** Gateway-owned authorization and exact native route binding for unknown DMs. */
export interface GatewayPairingAuthority {
  offer(endpoint: GatewayEndpoint, now?: number): Promise<GatewayPairingOffer>
  approve(input: GatewayPairingApprovalInput): Promise<GatewayPairingApproval>
  match(endpoint: GatewayEndpoint): ResolvedGatewayRoute | undefined
  route(id: string): ResolvedGatewayRoute | undefined
  routes(): readonly ResolvedGatewayRoute[]
  close(): Promise<void>
}

class DomainGatewayPairingAuthority implements GatewayPairingAuthority {
  private tail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>

  constructor(
    private readonly domain: PairingDomain,
    private readonly options: GatewayPairingAuthorityOptions,
  ) {}

  offer(rawEndpoint: GatewayEndpoint, now = Date.now()): Promise<GatewayPairingOffer> {
    return this.write(async () => {
      exactTime(now)
      const endpoint = normalizeEndpoint(rawEndpoint)
      const trusted = this.match(endpoint)
      if (trusted !== undefined) return Object.freeze({ kind: 'already-trusted', route: trusted })
      await this.removeExpired(now)
      const bindings = this.domain.table('bindings')
      const key = endpointKey(endpoint)
      if (bindings.get(key)?.kind === 'pending') {
        return Object.freeze({ kind: 'suppressed', reason: 'pending' })
      }
      const accountPending = [...bindings.entries()].filter(([, binding]) =>
        binding.kind === 'pending'
        && binding.endpoint.adapter === endpoint.adapter
        && binding.endpoint.accountId === endpoint.accountId)
      if (accountPending.length >= this.options.maxPendingPerAccount) {
        return Object.freeze({ kind: 'suppressed', reason: 'capacity' })
      }
      const code = pairingCode()
      const salt = randomBytes(16)
      const expiresAt = now + this.options.codeTtlMs
      const request = pendingSchema.parse({
        kind: 'pending',
        requestId: randomBytes(16).toString('hex'),
        schemaVersion: 1,
        endpoint,
        salt: salt.toString('hex'),
        codeHash: hashCode(code, salt),
        createdAt: now,
        expiresAt,
      })
      await bindings.put(key, request)
      return Object.freeze({ kind: 'offered', code, expiresAt })
    })
  }

  approve(input: GatewayPairingApprovalInput): Promise<GatewayPairingApproval> {
    return this.write(async () => {
      exactTime(input.now)
      const adapter = endpointSchema.shape.adapter.parse(input.adapter)
      const accountId = input.accountId === undefined
        ? undefined
        : endpointSchema.shape.accountId.parse(input.accountId)
      const code = input.code.trim().toUpperCase()
      if (!CODE_PATTERN.test(code)) throw invalidCode()
      const target = normalizeTarget(input.target)
      await this.removeExpired(input.now)
      const bindings = this.domain.table('bindings')
      let matchedKey: string | undefined
      let matched: GatewayPairingRequest | undefined
      for (const [key, request] of bindings.entries()) {
        if (request.kind !== 'pending') continue
        if (request.endpoint.adapter !== adapter
          || (accountId !== undefined && request.endpoint.accountId !== accountId)) continue
        const digest = hashCode(code, Buffer.from(request.salt, 'hex'))
        if (timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(request.codeHash, 'hex'))) {
          if (matched !== undefined) throw new Error('gateway pairing code is ambiguous across Adapter accounts')
          matchedKey = key
          matched = request
        }
      }
      if (matchedKey === undefined || matched === undefined) throw invalidCode()
      const route = resolveGatewayRoutes([{
        ...target,
        adapter: matched.endpoint.adapter,
        accountId: matched.endpoint.accountId,
        conversationId: matched.endpoint.conversationId,
        userId: matched.endpoint.userId,
        ...(matched.endpoint.threadId === undefined ? {} : { threadId: matched.endpoint.threadId }),
      }]).routes[0]!
      const conflicting = [...bindings.entries()].find(([, binding]) => binding.kind === 'grant'
        && binding.route.id === route.id && binding.route.endpointKey !== route.endpointKey)
      if (conflicting !== undefined) {
        throw new Error(`gateway pairing route id '${route.id}' is already bound to another endpoint`)
      }
      const grantId = createHash('sha256')
        .update(`${matched.requestId}\0${route.endpointKey}\0${input.now}`)
        .digest('hex')
      const grant = grantSchema.parse({
        kind: 'grant',
        grantId,
        schemaVersion: 1,
        requestId: matched.requestId,
        route,
        approvedAt: input.now,
      })
      await bindings.update(matchedKey, (current) => {
        if (current.kind !== 'pending' || current.requestId !== matched.requestId
          || current.expiresAt <= input.now) throw invalidCode()
        return grant
      })
      return Object.freeze({ grantId, route })
    })
  }

  match(rawEndpoint: GatewayEndpoint): ResolvedGatewayRoute | undefined {
    const endpoint = normalizeEndpoint(rawEndpoint)
    const grant = this.domain.table('bindings').get(endpointKey(endpoint))
    if (grant?.kind !== 'grant') return undefined
    return normalizePersistedRoute(grant.route)
  }

  route(id: string): ResolvedGatewayRoute | undefined {
    return this.routes().find(route => route.id === id)
  }

  routes(): readonly ResolvedGatewayRoute[] {
    const routes = [...this.domain.table('bindings').entries()]
      .filter((entry): entry is [string, GatewayTrustGrant] => entry[1].kind === 'grant')
      .map(([, grant]) => normalizePersistedRoute(grant.route))
      .sort((left, right) => left.id.localeCompare(right.id))
    return Object.freeze(routes)
  }

  close(): Promise<void> {
    this.closing ??= this.tail.then(() => this.domain.close())
    return this.closing
  }

  private removeExpired(now: number): Promise<void> {
    return Promise.all([...this.domain.table('bindings').entries()]
      .filter(([, binding]) => binding.kind === 'pending' && binding.expiresAt <= now)
      .map(([key]) => this.domain.table('bindings').delete(key))).then(() => undefined)
  }

  private write<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new Error('gateway pairing authority is closing'))
    const result = this.tail.then(operation)
    this.tail = result.then(() => {}, () => {})
    return result
  }
}

export async function openGatewayPairingAuthority(
  facility: DomainFacility,
  options: GatewayPairingAuthorityOptions,
): Promise<GatewayPairingAuthority> {
  if (!Number.isSafeInteger(options.codeTtlMs) || options.codeTtlMs < 60_000 || options.codeTtlMs > 3_600_000) {
    throw new Error('gateway pairing codeTtlMs must be between 1 minute and 1 hour')
  }
  if (!Number.isSafeInteger(options.maxPendingPerAccount)
    || options.maxPendingPerAccount < 1 || options.maxPendingPerAccount > 20) {
    throw new Error('gateway pairing maxPendingPerAccount must be between 1 and 20')
  }
  return new DomainGatewayPairingAuthority(await facility.open(pairingDomainSpec), Object.freeze({ ...options }))
}

function pairingCode(): string {
  let code = ''
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  }
  return code
}

function hashCode(code: string, salt: Uint8Array): string {
  return createHash('sha256').update(salt).update(code, 'utf8').digest('hex')
}

function exactTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('gateway pairing time must be a non-negative safe integer')
}

function invalidCode(): Error {
  return new Error('gateway pairing code is invalid, expired, or already used')
}

function normalizeEndpoint(input: GatewayEndpoint): GatewayEndpoint {
  const parsed = endpointSchema.parse(input)
  return Object.freeze({
    adapter: parsed.adapter,
    accountId: parsed.accountId,
    conversationId: parsed.conversationId,
    userId: parsed.userId,
    ...(parsed.threadId === undefined ? {} : { threadId: parsed.threadId }),
  })
}

function normalizeTarget(input: GatewayPairingTarget): GatewayPairingTarget {
  const parsed = targetSchema.parse(input)
  return Object.freeze({
    id: parsed.id,
    workspaceId: parsed.workspaceId,
    sessionId: parsed.sessionId,
    agentPreset: parsed.agentPreset,
    provider: parsed.provider,
    model: parsed.model,
    ...(parsed.maxTokens === undefined ? {} : { maxTokens: parsed.maxTokens }),
  })
}

function normalizePersistedRoute(input: z.infer<typeof routeSchema>): ResolvedGatewayRoute {
  return resolveGatewayRoutes([{
    id: input.id,
    adapter: input.adapter,
    accountId: input.accountId,
    conversationId: input.conversationId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    agentPreset: input.agentPreset,
    provider: input.provider,
    model: input.model,
    ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
    ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
  }]).routes[0]!
}
