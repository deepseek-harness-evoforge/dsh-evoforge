import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const channel = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@larksuiteoapi/node-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@larksuiteoapi/node-sdk')>(),
  createLarkChannel: () => channel,
}))
import { createOfficialFeishuPairingPlatform } from '../src/platform.js'

function platform() {
  return createOfficialFeishuPairingPlatform({ appId: 'fake', appSecret: 'fake', handshakeTimeoutMs: 1_000 })
}
function snapshot() {
  const data = Buffer.from('apples=3\noranges=4\n')
  return { name: '验收.txt', data, sha256: createHash('sha256').update(data).digest('hex') }
}

beforeEach(() => {
  channel.send.mockReset()
  channel.send.mockResolvedValue({ messageId: 'message-file' })
})

describe('official file snapshot transport', () => {
  it('sends exact verified bytes and reply destination without a filesystem source', async () => {
    const file = snapshot()
    const result = await platform().sendFile!('chat-test', file,
      { replyTo: 'message-parent', replyInThread: true }, new AbortController().signal)
    expect(result).toEqual({ messageId: 'message-file' })
    expect(channel.send).toHaveBeenCalledExactlyOnceWith('chat-test',
      { file: { source: file.data, fileName: '验收.txt' } },
      { replyTo: 'message-parent', replyInThread: true })
    expect(channel.send.mock.calls[0]![1].file.source).not.toBe(file.data)
  })

  it.each(['../private.txt', '/private.txt', 'a\\b.txt', 'a\n.txt', '', ' . ', '.'])
  ('rejects unsafe filename %j before upload', async name => {
    await expect(platform().sendFile!('chat-test', { ...snapshot(), name }, undefined,
      new AbortController().signal)).rejects.toThrow(/file snapshot/u)
    expect(channel.send).not.toHaveBeenCalled()
  })

  it('rejects content changes, empty files and oversized files before upload', async () => {
    for (const file of [
      { ...snapshot(), sha256: '0'.repeat(64) },
      { ...snapshot(), data: Buffer.alloc(0) },
      { ...snapshot(), data: Buffer.alloc(30_000_001) },
    ]) {
      await expect(platform().sendFile!('chat-test', file, undefined,
        new AbortController().signal)).rejects.toThrow(/file snapshot/u)
    }
    expect(channel.send).not.toHaveBeenCalled()
  })

  it('does not upload after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(platform().sendFile!('chat-test', snapshot(), undefined, controller.signal)).rejects.toThrow()
    expect(channel.send).not.toHaveBeenCalled()
  })

  it('does not retry an ambiguous SDK failure', async () => {
    channel.send.mockRejectedValue(new Error('connection lost after upload'))
    await expect(platform().sendFile!('chat-test', snapshot(), undefined,
      new AbortController().signal)).rejects.toThrow()
    expect(channel.send).toHaveBeenCalledTimes(1)
  })

  it('keeps upload bytes unchanged when the caller mutates its buffer', async () => {
    const file = snapshot()
    const expected = Buffer.from(file.data)
    let finish!: (value: { messageId: string }) => void
    channel.send.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = platform().sendFile!('chat-test', file, undefined, new AbortController().signal)
    file.data.fill(0)
    expect(channel.send.mock.calls[0]![1].file.source).toEqual(expected)
    finish({ messageId: 'message-file' })
    await expect(pending).resolves.toEqual({ messageId: 'message-file' })
  })

  it('does not report a late SDK success as confirmed after cancellation', async () => {
    const controller = new AbortController()
    let finish!: (value: { messageId: string }) => void
    channel.send.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = platform().sendFile!('chat-test', snapshot(), undefined, controller.signal)
    controller.abort()
    finish({ messageId: 'message-file' })
    await expect(pending).rejects.toThrow()
    expect(channel.send).toHaveBeenCalledTimes(1)
  })
})
