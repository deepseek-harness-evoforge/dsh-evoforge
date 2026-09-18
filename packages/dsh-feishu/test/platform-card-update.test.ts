import { beforeEach, describe, expect, it, vi } from 'vitest'

const patch = vi.hoisted(() => vi.fn())
vi.mock('@larksuiteoapi/node-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@larksuiteoapi/node-sdk')>(),
  createLarkChannel: () => ({ rawClient: { im: { v1: { message: { patch } } } } }),
}))
import { createOfficialFeishuPairingPlatform } from '../src/platform.js'

const platform = () => createOfficialFeishuPairingPlatform({
  appId: 'fake', appSecret: 'fake', handshakeTimeoutMs: 1_000,
})
const card = { schema: '2.0', config: { update_multi: true }, body: { elements: [] } }
beforeEach(() => { patch.mockReset().mockResolvedValue({ code: 0 }) })

describe('official approval card update', () => {
  it('replaces only the exact existing message once', async () => {
    await platform().updateCard!('om_exact', card, new AbortController().signal)
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      path: { message_id: 'om_exact' }, data: { content: JSON.stringify(card) },
    })
  })
  it.each([{ code: 230001, msg: 'private platform details' }, {}])
  ('rejects non-success responses without leaking platform details or retrying', async response => {
    patch.mockResolvedValue(response)
    await expect(platform().updateCard!('om_exact', card, new AbortController().signal))
      .rejects.toThrow('Feishu card update was not confirmed')
    expect(patch).toHaveBeenCalledTimes(1)
  })
  it('does not patch after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(platform().updateCard!('om_exact', card, controller.signal)).rejects.toThrow()
    expect(patch).not.toHaveBeenCalled()
  })
  it('does not retry transport failures', async () => {
    patch.mockRejectedValue(new Error('private network details'))
    await expect(platform().updateCard!('om_exact', card, new AbortController().signal))
      .rejects.toThrow('Feishu card update was not confirmed')
    expect(patch).toHaveBeenCalledTimes(1)
  })
  it('does not confirm a late response after lifecycle cancellation', async () => {
    let finish!: (value: { code: number }) => void
    patch.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const controller = new AbortController()
    const pending = platform().updateCard!('om_exact', card, controller.signal)
    controller.abort()
    finish({ code: 0 })
    await expect(pending).rejects.toThrow('Feishu card update was not confirmed')
    expect(patch).toHaveBeenCalledTimes(1)
  })
})
