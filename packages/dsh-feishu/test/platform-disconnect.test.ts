import { expect, it, vi } from 'vitest'
const channel = vi.hoisted(() => ({
  disconnect: vi.fn(async () => {}),
  rawWsClient: { close: vi.fn() },
}))
vi.mock('@larksuiteoapi/node-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@larksuiteoapi/node-sdk')>(),
  createLarkChannel: () => channel,
}))
import { createOfficialFeishuPairingPlatform } from '../src/platform.js'

it('closes an SDK socket even when channel disconnect returns before the first handshake', async () => {
  const platform = createOfficialFeishuPairingPlatform({ appId: 'fake', appSecret: 'fake', handshakeTimeoutMs: 1_000 })
  await platform.disconnect()
  expect(channel.rawWsClient.close).toHaveBeenCalledWith({ force: true })
})
