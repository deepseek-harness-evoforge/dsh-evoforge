import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type { GatewayFileDeliveryIntent, GatewayFileReference, GatewayOutboundReceipt } from 'dsh-evoforge-gateway'

export const FEISHU_FILE_TOOL = 'feishu_file_send'
const MAX_FILE_BYTES = 30_000_000

export interface FeishuFileDestination {
  readonly routeId: string
  readonly destinationDigest: string
  readonly description: string
  readonly replyToExternalId?: string
  readonly replyInThread?: boolean
}

export interface FeishuFileDelivery {
  /** Only the live, authenticated inbound turn may use standing full-access delivery. */
  isCurrentChannelTurn?(): boolean
  destination(): FeishuFileDestination
  snapshot(path: string, name: string, signal: AbortSignal): Promise<GatewayFileReference>
  submit(intent: GatewayFileDeliveryIntent): Promise<GatewayOutboundReceipt>
  waitForReceipt(id: string, options: { timeoutMs: number; signal: AbortSignal }): Promise<GatewayOutboundReceipt>
}

/** Narrow view of the audited current native AttachmentStore; older image-only Hosts fail closed. */
export interface NativeFileAttachments {
  saveFileStream(input: { data: AsyncIterable<Uint8Array>; name: string; signal: AbortSignal }): Promise<GatewayFileReference>
  readFileStream(ref: GatewayFileReference, signal: AbortSignal): AsyncIterable<Uint8Array>
}

export function requireNativeFileAttachments(value: unknown): NativeFileAttachments {
  if (typeof value !== 'object' || value === null
    || !('saveFileStream' in value) || typeof value.saveFileStream !== 'function'
    || !('readFileStream' in value) || typeof value.readFileStream !== 'function') {
    throw failure('This DSH Host does not support native file attachments', 'NATIVE_FILES_UNAVAILABLE')
  }
  return value as NativeFileAttachments
}

export function shouldInstallFeishuFileTool(agent: Agent, enabled: boolean): boolean {
  const header = agent.session.requestHeader()
  return header === undefined ? enabled : header.tools?.some(tool => tool.name === FEISHU_FILE_TOOL) === true
}

/** File bytes stay in native FS/AttachmentStore; only the approved reference crosses the Gateway seam. */
export async function snapshotNativeFile(
  fs: FileSystem,
  attachments: NativeFileAttachments,
  cwd: string,
  path: string,
  name: string,
  signal: AbortSignal,
): Promise<GatewayFileReference> {
  assertName(name)
  signal.throwIfAborted()
  const workspace = await fs.resolve(cwd, { cwd, signal })
  const target = await fs.resolve(path, { cwd, signal })
  if (!fs.contains(workspace, target)) {
    throw failure('Only output files resolved within this Session workspace can be sent', 'FILE_OUTSIDE_WORKSPACE')
  }
  const info = await fs.stat(target, signal)
  if (info?.type !== 'file') throw failure('Select a regular file to send', 'FILE_NOT_REGULAR')
  const data = Buffer.from(await fs.readBytes(target, signal, MAX_FILE_BYTES))
  signal.throwIfAborted()
  if (data.byteLength < 1 || data.byteLength > MAX_FILE_BYTES) {
    throw failure('File must contain 1 to 30000000 bytes', 'FILE_SIZE_INVALID')
  }
  const expected = `sha256:${createHash('sha256').update(data).digest('hex')}`
  const ref = await attachments.saveFileStream({
    name, signal,
    data: (async function* () {
      for (let offset = 0; offset < data.byteLength; offset += 64 * 1024) {
        signal.throwIfAborted()
        yield data.subarray(offset, offset + 64 * 1024)
      }
    })(),
  })
  signal.throwIfAborted()
  assertReference(ref)
  if (ref.attachmentId !== expected || ref.bytes !== data.byteLength || ref.name !== name) {
    throw failure('Native file snapshot did not match the selected bytes', 'FILE_SNAPSHOT_MISMATCH')
  }
  return Object.freeze({ attachmentId: ref.attachmentId, name: ref.name, bytes: ref.bytes })
}

/** Read through the native provider and independently check the bytes before an external upload. */
export async function readNativeFile(
  attachments: NativeFileAttachments,
  ref: GatewayFileReference,
  signal: AbortSignal,
): Promise<Uint8Array> {
  assertReference(ref)
  signal.throwIfAborted()
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of attachments.readFileStream(ref, signal)) {
    signal.throwIfAborted()
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > ref.bytes - length) {
      throw failure('Native attachment exceeded the approved size', 'FILE_SNAPSHOT_MISMATCH')
    }
    chunks.push(Buffer.from(chunk))
    length += chunk.byteLength
  }
  signal.throwIfAborted()
  const data = Buffer.concat(chunks, length)
  if (length !== ref.bytes || `sha256:${createHash('sha256').update(data).digest('hex')}` !== ref.attachmentId) {
    throw failure('Native attachment no longer matches the approved snapshot', 'FILE_SNAPSHOT_MISMATCH')
  }
  return data
}

export function installFeishuFileTool(agent: Agent, enabled: boolean, delivery: FeishuFileDelivery): () => void {
  const lifecycle = new AbortController()
  const check = (): void => {
    lifecycle.signal.throwIfAborted()
    if (!enabled) throw failure('Feishu file delivery is disabled', 'FILE_DELIVERY_DISABLED')
  }
  const offTool = agent.ctx.tools.register(defineTool({
    name: FEISHU_FILE_TOOL,
    description: agent.session.requestHeader()?.tools?.find(tool => tool.name === FEISHU_FILE_TOOL)?.description
      ?? 'Send one local output file to this conversation’s exact Feishu recipient. Uses the current native full-access permission for a live Feishu turn; otherwise requires native approval of the immutable snapshot. Only delivered confirms success. Do not automatically retry uncertain or pending sends. Once submission starts, cancellation cannot guarantee withdrawal of the external effect.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Exact output file path within this Session’s workspace; relative paths use its working directory.' },
      file_name: { type: 'string', required: true, description: 'Display filename including extension, without any directory components.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) => ({ status: statusOf(value) }),
    },
    presentCall: args => ({ card: 'generic', title: '发送文件到当前飞书会话', kind: 'execute', rawInput: { fileName: args.file_name } }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: result.isError ? '文件未发送或送达结果未确认' : statusTitle(statusOf(result.meta)),
    }),
    async execute(args, exec) {
      check()
      return sendApprovedFile(agent, enabled, lifecycle.signal, delivery, args.file_path, args.file_name, exec)
    },
  }))
  const offGuard = agent.ctx.tools.guard(exec => exec.name !== FEISHU_FILE_TOOL ? undefined
    : lifecycle.signal.aborted || !enabled ? 'Feishu file delivery is disabled' : undefined)
  return () => {
    if (lifecycle.signal.aborted) return
    lifecycle.abort(new Error('Feishu file Tool disposed'))
    offGuard()
    offTool()
  }
}

/** Adapt a native present call only while answering an actual Feishu ingress turn. */
export function installFeishuPresentDelivery(
  agent: Agent,
  enabled: boolean,
  delivery: FeishuFileDelivery,
  isFeishuTurn: () => boolean,
): () => void {
  const lifecycle = new AbortController()
  const off = agent.ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.agent !== agent || exec.name !== 'present' || result.isError || !isFeishuTurn()) return next()
    const decision = await next()
    if (decision.kind !== 'accept') return decision
    try {
      if (decision.value !== undefined) {
        throw failure('Native present value was replaced by another policy; no Feishu file was sent', 'PRESENT_VALUE_CHANGED')
      }
      const value = result.value
      const args = exec.arguments
      if (!isRecord(value) || !isRecord(args)
        || !Array.isArray(value.files) || value.files.length !== 1
        || !Array.isArray(args.files) || args.files.length !== 1
        || !isRecord(value.files[0]) || !isRecord(args.files[0])
        || typeof value.files[0].path !== 'string' || value.files[0].path !== args.files[0].path) {
        throw failure('Feishu delivery requires one matching file per present call; no file was sent', 'PRESENT_FILES_INVALID')
      }
      // Do not rewrite the native schema, canonical value, or durable declaration.
      // The result projection gains the actual transport outcome, not a guessed text claim.
      const outcome = await sendApprovedFile(agent, enabled, lifecycle.signal, delivery,
        value.files[0].path, basename(value.files[0].path), exec)
      if (!outcome.delivered) {
        return { kind: 'block', feedback: [{ type: 'text', text: `${JSON.stringify(outcome)}；不要自动重发。` }] }
      }
      return { kind: 'accept', content: [
        ...(decision.content ?? result.content), { type: 'text', text: JSON.stringify(outcome) },
      ], ...(decision.additionalContexts === undefined ? {} : { additionalContexts: decision.additionalContexts }) }
    } catch (error) {
      return { kind: 'block', feedback: [{ type: 'text',
        text: `飞书附件未确认送达，不能宣称已发送：${error instanceof Error ? error.message : 'file delivery failed'}`,
      }] }
    }
  })
  return () => {
    if (lifecycle.signal.aborted) return
    lifecycle.abort(new Error('Feishu native present delivery disposed'))
    off()
  }
}

async function sendApprovedFile(
  agent: Agent, enabled: boolean, lifecycle: AbortSignal, delivery: FeishuFileDelivery,
  sourcePath: string, name: string, exec: ToolExecution,
) {
  const signal = AbortSignal.any([lifecycle, exec.signal])
  signal.throwIfAborted()
  if (!enabled) throw failure('Feishu file delivery is disabled; Web presentation does not send a Feishu attachment', 'FILE_DELIVERY_DISABLED')
  if (exec.agent !== agent) throw failure('File delivery belongs to one exact Agent', 'FILE_AGENT_MISMATCH')
  const approval = agent.ctx.get('approval')
  if (approval === undefined) throw failure('Native Approval is required before file delivery', 'FILE_APPROVAL_UNAVAILABLE')
  const standingPermission = hasStandingFilePermission(agent, delivery)
  assertName(name)
  const destination = Object.freeze({ ...delivery.destination() })
  const file = Object.freeze({ ...await delivery.snapshot(sourcePath, name, signal) })
  assertReference(file)
  signal.throwIfAborted()
  if (standingPermission) {
    if (!hasStandingFilePermission(agent, delivery)) {
      throw failure('Current channel or full-access permission changed before file submission', 'FILE_PERMISSION_CHANGED')
    }
  } else {
    const outcome = await approval.request({
      agent, toolName: exec.name, callId: exec.callId, signal,
      reason: `发送文件 ${JSON.stringify(file.name)}（${file.bytes} 字节）到 ${destination.description}。\n`
        + `原文件：${JSON.stringify(sourcePath)}\n文件快照：${file.attachmentId}\n接收方绑定：${destination.destinationDigest}\n`
        + '只批准这个快照和接收方；开始提交后，取消等待不能保证撤回发送。',
    })
    signal.throwIfAborted()
    if (outcome !== 'allowed-once') throw failure('Native Approval did not allow this file delivery', 'FILE_APPROVAL_DENIED')
  }
  const current = delivery.destination()
  if (current.routeId !== destination.routeId || current.destinationDigest !== destination.destinationDigest
    || current.replyToExternalId !== destination.replyToExternalId || current.replyInThread !== destination.replyInThread) {
    throw failure('Feishu recipient changed while approval was pending', 'FILE_DESTINATION_CHANGED')
  }
  const receipt = await delivery.submit({
    kind: 'file', routeId: destination.routeId, destinationDigest: destination.destinationDigest,
    intentKey: `file:${String(agent.session.id)}:${String(exec.callId)}`, file,
    ...(destination.replyToExternalId === undefined ? {} : { replyToExternalId: destination.replyToExternalId }),
    ...(destination.replyInThread === undefined ? {} : { replyInThread: destination.replyInThread }),
  })
  const observed = await delivery.waitForReceipt(receipt.id, { timeoutMs: 35_000, signal })
  const result = { status: observed.status, delivered: observed.status === 'delivered', fileName: file.name, bytes: file.bytes,
    authorization: standingPermission ? 'native-full-access' : 'native-approval',
    receiptId: receipt.id, notice: statusTitle(observed.status) }
  if (observed.status === 'failed' || observed.status === 'uncertain') {
    throw failure(`${JSON.stringify(result)}；不要自动重发。`, `FILE_DELIVERY_${observed.status.toUpperCase()}`)
  }
  return result
}

/** This is a declared channel delivery policy, not an interpretation of `never` as an approval grant. */
function hasStandingFilePermission(agent: Agent, delivery: FeishuFileDelivery): boolean {
  if (delivery.isCurrentChannelTurn?.() !== true) return false
  const presets = agent.ctx.get('permissionPresets')
  if (presets?.current(agent.session) !== 'danger-full-access') return false
  const spec = presets.resolve('danger-full-access')
  return spec.sandbox === 'danger-full-access' && spec.approval === 'never'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function statusOf(value: unknown): string {
  return typeof value === 'object' && value !== null && 'status' in value && typeof value.status === 'string'
    ? value.status : 'unconfirmed'
}

function statusTitle(status: string): string {
  switch (status) {
    case 'delivered': return '文件已送达飞书'
    case 'prepared': return '文件仍在排队，尚未确认送达'
    case 'sending': return '文件正在发送，尚未确认送达'
    case 'retrying': return '文件正在等待重试，尚未确认送达'
    case 'failed': return '文件发送失败'
    case 'uncertain': return '文件送达结果未知，请先检查飞书，勿重复发送'
    default: return '文件送达状态未确认'
  }
}

function assertName(name: string): void {
  if (typeof name !== 'string' || !name || name.trim() !== name || name === '.' || name === '..'
    || Buffer.byteLength(name, 'utf8') > 255 || /[/\\\u0000-\u001f\u007f]/u.test(name)) {
    throw failure('File name must be a safe leaf filename', 'FILE_NAME_INVALID')
  }
}

function assertReference(ref: GatewayFileReference): void {
  assertName(ref.name)
  if (!/^sha256:[a-f0-9]{64}$/u.test(ref.attachmentId) || !Number.isSafeInteger(ref.bytes)
    || ref.bytes < 1 || ref.bytes > MAX_FILE_BYTES) throw failure('Invalid native file snapshot', 'FILE_SNAPSHOT_INVALID')
}

function failure(message: string, code: string): HarnessError {
  return new HarnessError(message, `FEISHU_${code}`)
}
