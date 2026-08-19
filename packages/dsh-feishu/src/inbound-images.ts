import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageMediaType,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { FeishuInboundMessage, FeishuPlatform } from './platform.js'

interface NativeImageStore {
  readonly imageLimits: ImageAttachmentLimits
  validateImage(input: SaveImageAttachment): Promise<void>
  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>
}

export interface MaterializedFeishuInbound {
  readonly text: string | undefined
  readonly images: readonly ImageAttachmentRef[]
}

/**
 * Convert Adapter-owned resource identities into durable native DSH image
 * references. Every member is downloaded and validated before the first save,
 * so a malformed later image cannot publish an earlier orphaned batch member.
 */
export async function materializeFeishuInbound(
  message: FeishuInboundMessage,
  platform: FeishuPlatform,
  store: NativeImageStore,
  signal?: AbortSignal,
): Promise<MaterializedFeishuInbound> {
  signal?.throwIfAborted()
  const resources = message.resources.filter(resource => resource.type === 'image')
  const limits = store.imageLimits
  if (resources.length > limits.maxImagesPerMessage) {
    throw new Error('dsh-feishu: inbound message exceeds the native DSH image-count limit')
  }
  const prepared = await Promise.all(resources.map(async (resource): Promise<SaveImageAttachment> => {
    const data = await platform.downloadMessageResource(
      message.messageId,
      resource.fileKey,
      'image',
      limits.maxImageBytes,
      signal,
    )
    signal?.throwIfAborted()
    if (data.byteLength === 0 || data.byteLength > limits.maxImageBytes) {
      throw new Error('dsh-feishu: inbound image exceeds the native DSH byte limit')
    }
    return Object.freeze({
      data,
      mediaType: detectImageMediaType(data),
      ...(resource.fileName === undefined ? {} : { name: resource.fileName }),
    })
  }))
  const totalBytes = prepared.reduce((sum, image) => sum + image.data.byteLength, 0)
  if (totalBytes > limits.maxMessageImageBytes) {
    throw new Error('dsh-feishu: inbound message exceeds the native DSH aggregate image-byte limit')
  }
  for (const image of prepared) await store.validateImage(image)
  const images: ImageAttachmentRef[] = []
  for (const image of prepared) images.push(await store.saveImage(image))
  const text = message.rawContentType === 'image'
    ? undefined
    : sanitizeResourceKeys(message.content, message.resources)
  return Object.freeze({
    text: text === undefined || text.length === 0 ? undefined : text,
    images: Object.freeze(images),
  })
}

function sanitizeResourceKeys(
  content: string,
  resources: FeishuInboundMessage['resources'],
): string {
  let sanitized = content
  for (const resource of resources) {
    const marker = resource.type === 'image' ? '[image]' : `[unsupported ${resource.type}]`
    sanitized = sanitized.split(`![image](${resource.fileKey})`).join(marker)
    sanitized = sanitized.split(resource.fileKey).join(marker)
  }
  return sanitized
}

function detectImageMediaType(data: Uint8Array): ImageMediaType {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(data, [...Buffer.from('GIF87a')]) || startsWith(data, [...Buffer.from('GIF89a')])) {
    return 'image/gif'
  }
  if (startsWith(data, [...Buffer.from('RIFF')])
    && startsWith(data.subarray(8), [...Buffer.from('WEBP')])) return 'image/webp'
  throw new Error('dsh-feishu: message resource is not a supported native DSH image format')
}

function startsWith(data: Uint8Array, prefix: readonly number[]): boolean {
  return data.byteLength >= prefix.length && prefix.every((value, index) => data[index] === value)
}
