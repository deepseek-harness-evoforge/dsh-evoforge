export const name = 'evoforge-gateway-browser-bootstrap'
export const inject = ['evoforge.gateway']

/**
 * Real-browser fixture: seed only redacted Adapter observations into the
 * normally loaded, installed Gateway. It creates no Agent, Session, model
 * request, alternative Gateway, or product state.
 */
export function apply(ctx) {
  const gateway = ctx['evoforge.gateway']
  const observedAt = Date.now()
  gateway.registerTransport({
    adapter: 'feishu',
    accountId: 'feishu-browser-account',
    kind: 'official-feishu-websocket',
    routeIds: ['feishu-browser'],
    initial: { state: 'degraded', observedAt, lastErrorAt: observedAt },
  })
  gateway.registerTransport({
    adapter: 'telegram',
    accountId: 'telegram-browser-account',
    kind: 'telegram-long-poll',
    routeIds: ['telegram-browser'],
    initial: { state: 'ready', observedAt, connectedAt: observedAt },
  })
}
