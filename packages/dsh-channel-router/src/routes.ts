export interface ChannelEndpoint {
  readonly adapter: string
  readonly accountId: string
  readonly conversationId: string
  readonly threadId?: string
  readonly userId: string
}

export interface ChannelRouteConfig extends ChannelEndpoint {
  readonly id: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly agentPreset: string
  /** Native DSH model route used for create and every cold resume. */
  readonly provider: string
  readonly model: string
  readonly maxTokens?: number
}

export interface ResolvedChannelRoute extends ChannelRouteConfig {
  readonly endpointKey: string
}

export interface ResolvedChannelRoutes {
  readonly byId: ReadonlyMap<string, ResolvedChannelRoute>
  readonly routes: readonly ResolvedChannelRoute[]
  match(endpoint: ChannelEndpoint): ResolvedChannelRoute | undefined
}

const ROUTE_ID = /^[a-z][a-z0-9_-]{0,63}$/u
const ADAPTER_ID = /^[a-z][a-z0-9_-]{0,31}$/u
const MAX_ROUTES = 100

/** Validate the complete static routing table before any Adapter can receive traffic. */
export function resolveChannelRoutes(input: readonly ChannelRouteConfig[]): ResolvedChannelRoutes {
  if (input.length > MAX_ROUTES) throw new Error(`channel router supports at most ${MAX_ROUTES} routes`)
  const byId = new Map<string, ResolvedChannelRoute>()
  const byEndpoint = new Map<string, ResolvedChannelRoute>()
  const sessionOwners = new Map<string, {
    workspaceId: string
    agentPreset: string
    provider: string
    model: string
    maxTokens?: number
  }>()
  const routes: ResolvedChannelRoute[] = []
  for (const candidate of input) {
    const route = normalizeRoute(candidate)
    if (byId.has(route.id)) throw new Error(`channel route id '${route.id}' is duplicated`)
    if (byEndpoint.has(route.endpointKey)) {
      throw new Error(`channel routes '${byEndpoint.get(route.endpointKey)!.id}' and '${route.id}' claim the same external endpoint`)
    }
    const owner = sessionOwners.get(route.sessionId)
    if (owner !== undefined && owner.workspaceId !== route.workspaceId) {
      throw new Error(`channel session '${route.sessionId}' cannot cross Workspaces '${owner.workspaceId}' and '${route.workspaceId}'`)
    }
    if (owner !== undefined && owner.agentPreset !== route.agentPreset) {
      throw new Error(`channel session '${route.sessionId}' cannot use multiple Agent presets`)
    }
    if (owner !== undefined && (owner.provider !== route.provider || owner.model !== route.model
      || owner.maxTokens !== route.maxTokens)) {
      throw new Error(`channel session '${route.sessionId}' cannot use multiple model routes`)
    }
    sessionOwners.set(route.sessionId, {
      workspaceId: route.workspaceId,
      agentPreset: route.agentPreset,
      provider: route.provider,
      model: route.model,
      ...(route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens }),
    })
    byId.set(route.id, route)
    byEndpoint.set(route.endpointKey, route)
    routes.push(route)
  }
  return Object.freeze({
    byId,
    routes: Object.freeze(routes),
    match: (endpoint: ChannelEndpoint) => byEndpoint.get(endpointKey(normalizeEndpoint(endpoint))),
  })
}

export function endpointKey(endpoint: ChannelEndpoint): string {
  return JSON.stringify([
    endpoint.adapter,
    endpoint.accountId,
    endpoint.conversationId,
    endpoint.threadId ?? null,
    endpoint.userId,
  ])
}

function normalizeRoute(input: ChannelRouteConfig): ResolvedChannelRoute {
  const endpoint = normalizeEndpoint(input)
  const id = exactId(input.id, 'route id', ROUTE_ID)
  const workspaceId = exactText(input.workspaceId, 'workspaceId', 512)
  const sessionId = exactText(input.sessionId, 'sessionId', 512)
  const agentPreset = exactText(input.agentPreset, 'agentPreset', 128)
  const provider = exactText(input.provider, 'provider', 128)
  const model = exactText(input.model, 'model', 256)
  const maxTokens = input.maxTokens
  if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens < 1)) {
    throw new Error('channel maxTokens must be a positive safe integer')
  }
  return Object.freeze({
    id,
    ...endpoint,
    workspaceId,
    sessionId,
    agentPreset,
    provider,
    model,
    ...(maxTokens === undefined ? {} : { maxTokens }),
    endpointKey: endpointKey(endpoint),
  })
}

function normalizeEndpoint(input: ChannelEndpoint): ChannelEndpoint {
  const adapter = exactId(input.adapter, 'adapter', ADAPTER_ID)
  const accountId = exactText(input.accountId, 'accountId', 256)
  const conversationId = exactText(input.conversationId, 'conversationId', 512)
  const userId = exactText(input.userId, 'userId', 512)
  const threadId = input.threadId === undefined
    ? undefined
    : exactText(input.threadId, 'threadId', 512)
  return Object.freeze({
    adapter,
    accountId,
    conversationId,
    ...(threadId === undefined ? {} : { threadId }),
    userId,
  })
}

function exactId(value: string, label: string, pattern: RegExp): string {
  const exact = exactText(value, label, 64)
  if (!pattern.test(exact)) throw new Error(`channel ${label} has an invalid shape`)
  return exact
}

function exactText(value: string, label: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value) || Buffer.byteLength(value) > maxBytes) {
    throw new Error(`channel ${label} must be non-empty, trimmed, control-free, and at most ${maxBytes} bytes`)
  }
  return value
}
