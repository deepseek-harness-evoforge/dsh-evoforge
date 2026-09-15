import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { gatewayFileDestinationDigest, resolveGatewayRoutes, type DshGateway, type GatewayTextAdapterConfig } from 'dsh-evoforge-gateway'
import { resolveFeishuPairingConfig } from '../src/config.js'
import type { FeishuPlatform } from '../src/platform.js'
import { FeishuRuntime } from '../src/runtime.js'

const data = Buffer.from('approved file bytes')
const file = { name: 'result.txt', bytes: data.length, attachmentId: `sha256:${createHash('sha256').update(data).digest('hex')}` }
const route = resolveGatewayRoutes([{
  id: 'route-a', adapter: 'feishu', accountId: 'app-a', conversationId: 'chat-a', userId: 'user-a',
  workspaceId: 'workspace-a', sessionId: 'session-a', agentPreset: 'standard', provider: 'mock', model: 'mock',
}]).routes[0]!

async function harness(enabled: boolean, files = true) {
  const ctx = new Context()
  let currentRoute: typeof route | undefined = route
  const attachments = files ? {
    saveFileStream: vi.fn(),
    readFileStream: vi.fn(async function* () { yield data }),
  } : {}
  ctx.provide('attachments', attachments as never)
  let registration: GatewayTextAdapterConfig | undefined
  const gateway = {
    route: () => currentRoute,
    registerTransport: () => ({ report() {}, dispose() {} }),
    registerTextAdapter: (value: GatewayTextAdapterConfig) => {
      registration = value
      return { dispose: async () => {} }
    },
  } as unknown as DshGateway
  const platform: FeishuPlatform = {
    onMessage: () => () => {}, onApprovalAction: () => () => {}, onError: () => () => {},
    connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}),
    sendText: vi.fn(async () => ({ messageId: 'text' })), sendCard: vi.fn(async () => ({ messageId: 'card' })),
    sendFile: vi.fn(async () => ({ messageId: 'file-message' })), downloadMessageResource: vi.fn(),
  }
  const config = await resolveFeishuPairingConfig({ mode: 'pairing', routeIds: [], fileDeliveryEnabled: enabled }, {
    resolve: async name => ({ value: name === 'DSH_FEISHU_APP_ID' ? 'app-a' : 'test-secret', source: 'test' }),
  })
  const runtime = new FeishuRuntime(ctx, config, gateway, platform)
  return { ctx, runtime, platform, attachments,
    registration: () => registration,
    changeRoute: (value: typeof currentRoute) => { currentRoute = value },
  }
}

describe('Feishu runtime native file handler', () => {
  it('requires native file support before enabling external delivery', async () => {
    const h = await harness(true, false)
    try {
      await expect(h.runtime.start()).rejects.toThrow(/native file/u)
      expect(h.platform.connect).not.toHaveBeenCalled()
    } finally { await h.runtime.dispose(); await h.ctx.fiber.dispose() }
  })

  it('does not register a file handler when file delivery is disabled', async () => {
    const h = await harness(false, false)
    try { await h.runtime.start(); expect(h.registration()?.sendFile).toBeUndefined() }
    finally { await h.runtime.dispose(); await h.ctx.fiber.dispose() }
  })

  it.each(['valid', 'corrupt', 'revoked'] as const)('verifies approved bytes and the live destination before upload: %s', async mode => {
    const h = await harness(true)
    const attachments = h.attachments as { readFileStream: ReturnType<typeof vi.fn> }
    attachments.readFileStream.mockImplementation(async function* () {
      if (mode === 'revoked') h.changeRoute(undefined)
      yield mode === 'corrupt' ? Buffer.alloc(data.length) : data
    })
    try {
      await h.runtime.start()
      const send = h.registration()?.sendFile
      expect(send).toBeTypeOf('function')
      const result = await send!({ routeId: route.id, file, destinationDigest: gatewayFileDestinationDigest(route) }, new AbortController().signal)
      expect(result.kind).toBe(mode === 'valid' ? 'delivered' : 'rejected')
      if (mode === 'valid') {
        expect(h.platform.sendFile).toHaveBeenCalledWith('chat-a', {
          name: file.name, data, sha256: file.attachmentId.slice(7),
        }, undefined, expect.any(AbortSignal))
      } else expect(h.platform.sendFile).not.toHaveBeenCalled()
    } finally { await h.runtime.dispose(); await h.ctx.fiber.dispose() }
  })
})
