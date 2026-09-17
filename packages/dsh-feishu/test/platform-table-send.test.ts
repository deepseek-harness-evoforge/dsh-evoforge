import { beforeEach, describe, expect, it, vi } from 'vitest'

const channel = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@larksuiteoapi/node-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@larksuiteoapi/node-sdk')>(),
  createLarkChannel: () => channel,
}))
import { createOfficialFeishuPairingPlatform } from '../src/platform.js'

const table = '| 事项 | 负责人 | 截止时间 | 状态 |\n|---|---|---|---|\n'
  + '| 登录文案 | 林 | 周三 | 已完成 |\n| 退款说明 | 陈 | 周五 | 未明确 |'
const options = { replyTo: 'message-parent', replyInThread: true }
const platform = () => createOfficialFeishuPairingPlatform({
  appId: 'fake', appSecret: 'fake', handshakeTimeoutMs: 1_000,
})

beforeEach(() => {
  channel.send.mockReset().mockResolvedValue({ messageId: 'message-table' })
})

describe('official table presentation', () => {
  it.each([table, `更新结果：\n\n${table}\n\n未明确不是已完成。`,
    '事项 | 状态\n:--- | ---:\n文案 | 未完成'])
  ('sends table-bearing text through native post md without rewriting it', async text => {
    await expect(platform().sendText('chat-test', text, options, new AbortController().signal))
      .resolves.toEqual({ messageId: 'message-table' })
    expect(channel.send).toHaveBeenCalledExactlyOnceWith('chat-test', {
      post: { zh_cn: { title: '', content: [[{ tag: 'md', text }]] } },
    }, options)
  })

  it.each(['你好', 'a | b', '|不是|表格|\n|--x|--y|',
    `${table}\n<at user_id="all">所有人</at>`, `${table}\n![图](https://example.invalid/a.png)`,
    `${table}\n![图][reference]`, `${table}\n<img src="private">`, table.padEnd(3_501, ' ')])
  ('keeps plain or potentially active content as exact literal text', async text => {
    await platform().sendText('chat-test', text, undefined, new AbortController().signal)
    expect(channel.send).toHaveBeenCalledExactlyOnceWith('chat-test', { text }, undefined)
  })

  it('does not retry an ambiguous failure', async () => {
    channel.send.mockRejectedValue(new Error('connection lost'))
    await expect(platform().sendText('chat-test', table, options, new AbortController().signal))
      .rejects.toThrow()
    expect(channel.send).toHaveBeenCalledTimes(1)
  })

  it('preserves the SDK single-message boundary and literal fenced examples', async () => {
    const text = `\`\`\`markdown\n${table}\n\`\`\``.padEnd(3_500, ' ')
    await platform().sendText('chat-test', text, undefined, new AbortController().signal)
    expect(channel.send).toHaveBeenCalledExactlyOnceWith('chat-test', {
      post: { zh_cn: { title: '', content: [[{ tag: 'md', text }]] } },
    }, undefined)
  })

  it('does not send after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(platform().sendText('chat-test', table, options, controller.signal)).rejects.toThrow()
    expect(channel.send).not.toHaveBeenCalled()
  })
})
