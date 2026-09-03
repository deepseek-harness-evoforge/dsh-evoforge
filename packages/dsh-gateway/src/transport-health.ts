import type { ResolvedGatewayRoute, ResolvedGatewayRoutes } from './routing.js'

export type GatewayTransportState = 'connecting' | 'ready' | 'degraded' | 'stopping'

export interface GatewayTransportObservation {
  readonly state: GatewayTransportState
  readonly observedAt: number
  readonly connectedAt?: number
  /** Last inbound platform event observed by the Adapter, distinct from generic activity. */
  readonly lastInboundAt?: number
  readonly lastActivityAt?: number
  readonly lastErrorAt?: number
}

export interface GatewayTransportConfig {
  readonly adapter: string
  readonly accountId: string
  readonly kind: string
  readonly routeIds: readonly string[]
  /** Project future exact routes approved by this Gateway for the same account. */
  readonly pairedRoutes?: boolean
  readonly initial: GatewayTransportObservation
}

export interface GatewayTransportHealthItem extends GatewayTransportObservation {
  readonly adapter: string
  readonly kind: string
  readonly routeIds: readonly string[]
}

export interface GatewayTransportHealth {
  readonly registrations: number
  readonly connecting: number
  readonly ready: number
  readonly degraded: number
  readonly stopping: number
  readonly items: readonly GatewayTransportHealthItem[]
}

export interface GatewayTransportRegistration {
  report(observation: GatewayTransportObservation): void
  dispose(): void
}

interface RegisteredTransport {
  readonly key: string
  readonly adapter: string
  readonly accountId: string
  readonly kind: string
  readonly routeIds: readonly string[]
  readonly pairedRoutes: boolean
  observation: GatewayTransportObservation
}

/**
 * In-memory, redacted transport observations. Adapter protocol state remains
 * Adapter-owned; this registry only validates ownership and projects facts.
 */
export class GatewayTransportRegistry {
  private readonly registrations = new Map<string, RegisteredTransport>()
  private stopped = false

  constructor(
    private readonly routes: ResolvedGatewayRoutes,
    private readonly pairedRoute: (id: string) => ResolvedGatewayRoute | undefined = () => undefined,
  ) {}

  register(config: GatewayTransportConfig): GatewayTransportRegistration {
    if (this.stopped) throw new Error('Gateway transport registry is stopping')
    const ownedRoutes = exactTransportRoutes(this.routes, config)
    const kind = exactKind(config.kind)
    const key = registrationKey(config.adapter, config.accountId)
    if (this.registrations.has(key)) {
      throw new Error(`Gateway transport '${config.adapter}/${config.accountId}' is already registered`)
    }
    const registration: RegisteredTransport = {
      key,
      adapter: config.adapter,
      accountId: config.accountId,
      kind,
      routeIds: Object.freeze(ownedRoutes.map(route => route.id)),
      pairedRoutes: config.pairedRoutes === true,
      observation: normalizeObservation(config.initial),
    }
    this.registrations.set(key, registration)
    let disposed = false
    return Object.freeze({
      report: (observation: GatewayTransportObservation) => {
        if (disposed || this.registrations.get(key) !== registration) {
          throw new Error('Gateway transport registration is disposed')
        }
        const next = normalizeObservation(observation)
        if (next.observedAt < registration.observation.observedAt) {
          throw new Error('Gateway transport observation time cannot move backwards')
        }
        registration.observation = next
      },
      dispose: () => {
        if (disposed) return
        disposed = true
        if (this.registrations.get(key) === registration) this.registrations.delete(key)
      },
    })
  }

  health(
    selectedRouteIds: ReadonlySet<string>,
    includeUnboundPaired = false,
  ): GatewayTransportHealth {
    const counts = { connecting: 0, ready: 0, degraded: 0, stopping: 0 }
    const items: GatewayTransportHealthItem[] = []
    for (const registration of this.registrations.values()) {
      const routeIds = [...selectedRouteIds].filter((id) => {
        if (registration.routeIds.includes(id)) return true
        if (!registration.pairedRoutes) return false
        const paired = this.pairedRoute(id)
        return paired?.adapter === registration.adapter && paired.accountId === registration.accountId
      })
      if (routeIds.length === 0 && !(includeUnboundPaired && registration.pairedRoutes)) continue
      counts[registration.observation.state] += 1
      items.push(Object.freeze({
        adapter: registration.adapter,
        kind: registration.kind,
        routeIds: Object.freeze(routeIds),
        ...registration.observation,
      }))
    }
    items.sort((left, right) => left.adapter.localeCompare(right.adapter)
      || left.kind.localeCompare(right.kind)
      || left.routeIds[0]!.localeCompare(right.routeIds[0]!))
    return Object.freeze({
      registrations: items.length,
      ...counts,
      items: Object.freeze(items),
    })
  }

  stop(): void {
    this.stopped = true
    this.registrations.clear()
  }
}

function exactTransportRoutes(
  routes: ResolvedGatewayRoutes,
  config: GatewayTransportConfig,
): readonly ResolvedGatewayRoute[] {
  if (!Array.isArray(config.routeIds) || config.routeIds.length > 100
    || (config.routeIds.length === 0 && config.pairedRoutes !== true)) {
    throw new Error('Gateway transport must register exact route ids or opt into paired routes')
  }
  const seen = new Set<string>()
  return config.routeIds.map((id) => {
    if (seen.has(id)) throw new Error(`Gateway transport route '${id}' is duplicated`)
    seen.add(id)
    const route = routes.byId.get(id)
    if (route === undefined) throw new Error(`Gateway transport route '${id}' is unknown`)
    if (route.adapter !== config.adapter || route.accountId !== config.accountId) {
      throw new Error(`Gateway transport '${config.adapter}/${config.accountId}' does not own route '${id}'`)
    }
    return route
  })
}

function normalizeObservation(input: GatewayTransportObservation): GatewayTransportObservation {
  if (!['connecting', 'ready', 'degraded', 'stopping'].includes(input.state)) {
    throw new Error('Gateway transport state is invalid')
  }
  exactTime(input.observedAt, 'observation time')
  for (const [label, value] of [
    ['connected time', input.connectedAt],
    ['last inbound event time', input.lastInboundAt],
    ['last activity time', input.lastActivityAt],
    ['last error time', input.lastErrorAt],
  ] as const) {
    if (value === undefined) continue
    exactTime(value, label)
    if (value > input.observedAt) throw new Error(`Gateway transport ${label} must not be after observation time`)
  }
  return Object.freeze({
    state: input.state,
    observedAt: input.observedAt,
    ...(input.connectedAt === undefined ? {} : { connectedAt: input.connectedAt }),
    ...(input.lastInboundAt === undefined ? {} : { lastInboundAt: input.lastInboundAt }),
    ...(input.lastActivityAt === undefined ? {} : { lastActivityAt: input.lastActivityAt }),
    ...(input.lastErrorAt === undefined ? {} : { lastErrorAt: input.lastErrorAt }),
  })
}

function exactTime(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Gateway transport ${label} must be a non-negative safe integer`)
  }
}

function exactKind(value: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(value)) {
    throw new Error('Gateway transport kind has an invalid shape')
  }
  return value
}

function registrationKey(adapter: string, accountId: string): string {
  return `${adapter}\0${accountId}`
}
