import type { ImageAttachmentRef, ImageAttachmentLimits, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { describe, expect, it, vi } from 'vitest'
import { materializeFeishuInbound } from '../src/inbound-images.js'
import type { FeishuInboundMessage, FeishuPlatform } from '../src/platform.js'

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

describe('Feishu native DSH image materialization', () => {
  it('downloads exact message resources, validates the whole batch, and exposes no Feishu key', async () => {
    const calls: string[] = []
    const platform = fakePlatform(async (messageId, fileKey, type, maxBytes) => {
      calls.push(`${messageId}/${fileKey}/${type}/${maxBytes}`)
      return png
    })
    const store = fakeStore()
    const message: FeishuInboundMessage = {
      messageId: 'om_1', chatId: 'oc_1', chatType: 'p2p', senderId: 'ou_1',
      rawContentType: 'post',
      content: 'Please inspect ![image](img_secret_key).',
      resources: [{ type: 'image', fileKey: 'img_secret_key', fileName: 'diagram.png' }],
    }

    const result = await materializeFeishuInbound(message, platform, store)

    expect(calls).toEqual([`om_1/img_secret_key/image/${store.imageLimits.maxImageBytes}`])
    expect(store.validateImage).toHaveBeenCalledBefore(store.saveImage)
    expect(result.text).toBe('Please inspect [image].')
    expect(result.text).not.toContain('img_secret_key')
    expect(result.images).toEqual([expect.objectContaining({
      attachmentId: `sha256:${'a'.repeat(64)}`,
      mediaType: 'image/png',
      name: 'diagram.png',
    })])
  })

  it('keeps image-only input image-only and rejects an oversized batch before persistence', async () => {
    const platform = fakePlatform(async () => png)
    const store = fakeStore({ maxImagesPerMessage: 1 })
    const one: FeishuInboundMessage = {
      messageId: 'om_2', chatId: 'oc_1', chatType: 'p2p', senderId: 'ou_1',
      rawContentType: 'image', content: '![image](img_one)',
      resources: [{ type: 'image', fileKey: 'img_one' }],
    }
    await expect(materializeFeishuInbound(one, platform, store)).resolves.toMatchObject({
      text: undefined,
      images: [expect.objectContaining({ mediaType: 'image/png' })],
    })

    await expect(materializeFeishuInbound({
      ...one,
      messageId: 'om_3',
      resources: [
        { type: 'image', fileKey: 'img_one' },
        { type: 'image', fileKey: 'img_two' },
      ],
    }, platform, store)).rejects.toThrow(/image-count limit/u)
    expect(store.saveImage).toHaveBeenCalledTimes(1)
  })

  it('rejects bytes that are not a native DSH image before validation or save', async () => {
    const platform = fakePlatform(async () => Uint8Array.from([1, 2, 3]))
    const store = fakeStore()
    const message: FeishuInboundMessage = {
      messageId: 'om_bad', chatId: 'oc_1', chatType: 'p2p', senderId: 'ou_1',
      rawContentType: 'image', content: '![image](img_bad)',
      resources: [{ type: 'image', fileKey: 'img_bad' }],
    }

    await expect(materializeFeishuInbound(message, platform, store)).rejects.toThrow(/image format/u)
    expect(store.validateImage).not.toHaveBeenCalled()
    expect(store.saveImage).not.toHaveBeenCalled()
  })
})

function fakePlatform(
  download: NonNullable<FeishuPlatform['downloadMessageResource']>,
): FeishuPlatform {
  return {
    onMessage: () => () => {}, onApprovalAction: () => () => {}, onError: () => () => {},
    async connect() {}, async disconnect() {},
    async sendText() { return { messageId: 'out' } },
    async sendCard() { return { messageId: 'card' } },
    downloadMessageResource: download,
  }
}

function fakeStore(overrides: Partial<ImageAttachmentLimits> = {}): {
  imageLimits: ImageAttachmentLimits
  validateImage: ReturnType<typeof vi.fn<(input: SaveImageAttachment) => Promise<void>>>
  saveImage: ReturnType<typeof vi.fn<(input: SaveImageAttachment) => Promise<ImageAttachmentRef>>>
} {
  const imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 4096,
    maxImagePixels: 1_000_000,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    ...overrides,
  }
  return {
    imageLimits,
    validateImage: vi.fn(async () => {}),
    saveImage: vi.fn(async input => ({
      attachmentId: `sha256:${'a'.repeat(64)}` as never,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...(input.name === undefined ? {} : { name: input.name }),
    })),
  }
}
