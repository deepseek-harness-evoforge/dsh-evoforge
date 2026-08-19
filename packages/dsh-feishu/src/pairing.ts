import { createHash, randomBytes } from 'node:crypto'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { FeishuInboundMessage, FeishuPlatform } from './platform.js'

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const USAGE = '用法：/feishu-pair start | status | cancel'

export interface FeishuPairingTarget {
  readonly workspaceId: string
  readonly sessionId: string
  readonly agentPreset: string
  readonly provider: string
  readonly model: string
  readonly maxTokens?: number
}

export interface FeishuPairingRuntimeOptions {
  readonly appId: string
  readonly appIdEnv: string
  readonly appSecretEnv: string
  readonly pairingWindowMs: number
}

interface WaitingState {
  readonly kind: 'waiting'
  readonly target: FeishuPairingTarget
  readonly phrase: string
  readonly expiresAt: number
}

interface PairedState {
  readonly kind: 'paired'
  readonly target: FeishuPairingTarget
  readonly message: FeishuInboundMessage
  readonly acknowledgement: 'delivered' | 'uncertain'
}

type PairingState =
  | { readonly kind: 'idle' }
  | WaitingState
  | PairedState
  | { readonly kind: 'expired'; readonly target: FeishuPairingTarget }
  | { readonly kind: 'cancelled'; readonly target: FeishuPairingTarget }
  | { readonly kind: 'failed'; readonly target: FeishuPairingTarget }

/**
 * Setup-only pairing module. It accepts one high-entropy phrase, returns a static
 * config draft, and deliberately has no Agent or Gateway dispatch interface.
 */
export class FeishuPairingRuntime {
  private state: PairingState = Object.freeze({ kind: 'idle' })
  private timer: ReturnType<typeof setTimeout> | undefined
  private connected = false
  private disposed = false
  private commandTail: Promise<void> = Promise.resolve()
  private readonly removeMessage: () => void
  private readonly removeError: () => void

  constructor(
    private readonly platform: FeishuPlatform,
    private readonly options: FeishuPairingRuntimeOptions,
  ) {
    this.removeMessage = platform.onMessage(message => this.accept(message))
    this.removeError = platform.onError(() => { void this.failWaiting() })
  }

  command(target: FeishuPairingTarget, rawInput: string): Promise<CommandResult> {
    const operation = this.commandTail.then(() => this.execute(target, rawInput))
    this.commandTail = operation.then(() => {}, () => {})
    return operation
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.clearExpiry()
    this.removeMessage()
    this.removeError()
    await this.disconnect()
  }

  private async execute(target: FeishuPairingTarget, rawInput: string): Promise<CommandResult> {
    if (this.disposed) return commandError('飞书配对已停止。')
    const words = rawInput.trim().split(/\s+/u).filter(Boolean)
    if (words.length !== 1) return commandError(USAGE)
    const action = words[0]
    if (action === 'start') return await this.start(target)
    if (action === 'status') return this.status(target)
    if (action === 'cancel') return await this.cancel(target)
    return commandError(USAGE)
  }

  private async start(target: FeishuPairingTarget): Promise<CommandResult> {
    if (this.state.kind === 'waiting') {
      if (!sameTarget(this.state.target, target)) return wrongSession()
      return commandSuccess(startInstructions(this.state))
    }
    if (this.state.kind === 'paired') {
      if (!sameTarget(this.state.target, target)) return wrongSession()
      return commandSuccess(renderPaired(this.options, this.state))
    }
    const waiting: WaitingState = Object.freeze({
      kind: 'waiting',
      target: Object.freeze({ ...target }),
      phrase: `EVOFORGE PAIR ${pairingCode()}`,
      expiresAt: Date.now() + this.options.pairingWindowMs,
    })
    this.state = waiting
    // A rejected connect may still have allocated SDK/WebSocket resources.
    this.connected = true
    try {
      await this.platform.connect()
      if (this.state !== waiting) {
        await this.disconnect()
        return this.status(target)
      }
      const delay = Math.max(0, waiting.expiresAt - Date.now())
      this.timer = setTimeout(() => { void this.expire(waiting) }, delay)
      return commandSuccess(startInstructions(waiting))
    } catch {
      if (this.state === waiting) this.state = Object.freeze({ kind: 'failed', target: waiting.target })
      await this.disconnect()
      return commandError('飞书连接失败。请运行 /doctor 检查配置后重试。')
    }
  }

  private status(target: FeishuPairingTarget): CommandResult {
    if ('target' in this.state && !sameTarget(this.state.target, target)) return wrongSession()
    if (this.state.kind === 'waiting') {
      const seconds = Math.max(0, Math.ceil((this.state.expiresAt - Date.now()) / 1_000))
      return commandSuccess(`正在等待飞书消息，剩余约 ${seconds} 秒。\n${startInstructions(this.state)}`)
    }
    if (this.state.kind === 'paired') return commandSuccess(renderPaired(this.options, this.state))
    if (this.state.kind === 'expired') return commandSuccess('上一次配对窗口已过期。运行 /feishu-pair start 重新开始。')
    if (this.state.kind === 'cancelled') return commandSuccess('上一次配对已取消。运行 /feishu-pair start 重新开始。')
    if (this.state.kind === 'failed') return commandSuccess('上一次飞书连接失败。运行 /doctor 检查后重试。')
    return commandSuccess('尚未开始配对。运行 /feishu-pair start。')
  }

  private async cancel(target: FeishuPairingTarget): Promise<CommandResult> {
    if ('target' in this.state && !sameTarget(this.state.target, target)) return wrongSession()
    this.clearExpiry()
    this.state = Object.freeze({ kind: 'cancelled', target: Object.freeze({ ...target }) })
    await this.disconnect()
    return commandSuccess('飞书配对已取消；没有创建或修改任何 Gateway route。')
  }

  private async accept(message: FeishuInboundMessage): Promise<void> {
    const waiting = this.state
    if (waiting.kind !== 'waiting') return
    if (Date.now() > waiting.expiresAt) {
      await this.expire(waiting)
      return
    }
    if (message.rawContentType !== 'text' || message.content.trim() !== waiting.phrase) return
    this.clearExpiry()
    const paired: PairedState = Object.freeze({
      kind: 'paired',
      target: waiting.target,
      message: Object.freeze({ ...message }),
      acknowledgement: 'delivered',
    })
    this.state = paired
    try {
      await this.platform.sendText(
        message.chatId,
        'EvoForge 配对信息已收到。请回到 DSH 运行 /feishu-pair status，审查静态 route 后再启用。',
        { replyTo: message.messageId },
      )
    } catch {
      this.state = Object.freeze({ ...paired, acknowledgement: 'uncertain' })
    } finally {
      await this.disconnect()
    }
  }

  private async expire(expected: WaitingState): Promise<void> {
    if (this.state !== expected) return
    this.clearExpiry()
    this.state = Object.freeze({ kind: 'expired', target: expected.target })
    await this.disconnect()
  }

  private async failWaiting(): Promise<void> {
    if (this.state.kind !== 'waiting') return
    const target = this.state.target
    this.clearExpiry()
    this.state = Object.freeze({ kind: 'failed', target })
    await this.disconnect()
  }

  private clearExpiry(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private async disconnect(): Promise<void> {
    if (!this.connected) return
    this.connected = false
    try {
      await this.platform.disconnect()
    } catch {
      // Pairing is already closed in memory; never keep an open acceptance window
      // because an SDK cleanup report itself failed.
    }
  }
}

function pairingCode(): string {
  const bytes = randomBytes(16)
  return [...bytes].map(byte => PAIRING_ALPHABET[byte & 31]).join('')
}

function startInstructions(state: WaitingState): string {
  return [
    '飞书配对窗口已开启（2 分钟，只接受首条完全匹配的消息）：',
    `1. 打开目标飞书私聊；群聊请 @机器人。`,
    `2. 只发送：${state.phrase}`,
    '3. 收到机器人确认后，回到这里运行 /feishu-pair status。',
    '普通消息不会进入 Agent，也不会自动创建权限。',
  ].join('\n')
}

function renderPaired(options: FeishuPairingRuntimeOptions, state: PairedState): string {
  const { target, message } = state
  const routeId = `feishu-${createHash('sha256')
    .update(`${target.workspaceId}\0${message.chatId}\0${message.senderId}`)
    .digest('hex').slice(0, 12)}`
  const lines = [
    '配对成功。下面只是待审查配置，不会自动生效：',
    '```yaml',
    '- id: evoforge-gateway',
    '  name: dsh-gateway',
    '  disabled: false',
    '  config:',
    '    routes:',
    `      - id: ${yaml(routeId)}`,
    '        adapter: feishu',
    `        accountId: ${yaml(options.appId)}`,
    `        conversationId: ${yaml(message.chatId)}`,
    ...(message.threadId === undefined ? [] : [`        threadId: ${yaml(message.threadId)}`]),
    `        userId: ${yaml(message.senderId)}`,
    `        workspaceId: ${yaml(target.workspaceId)}`,
    `        sessionId: ${yaml(target.sessionId)}`,
    `        agentPreset: ${yaml(target.agentPreset)}`,
    `        provider: ${yaml(target.provider)}`,
    `        model: ${yaml(target.model)}`,
    ...(target.maxTokens === undefined ? [] : [`        maxTokens: ${target.maxTokens}`]),
    '- id: evoforge-feishu',
    '  name: dsh-feishu',
    '  disabled: false',
    '  config:',
    `    routeIds: [${yaml(routeId)}]`,
    `    appIdEnv: ${options.appIdEnv}`,
    `    appSecretEnv: ${options.appSecretEnv}`,
    '```',
    `真实回执：${state.acknowledgement === 'delivered' ? '已送达' : '结果不确定，请先人工确认'}。`,
    '审查并写入 DSH profile 后，关闭 pairing mode 并重启 DSH；Gateway 仍按 exact identity 默认拒绝。',
  ]
  return lines.join('\n')
}

function yaml(value: string): string {
  return JSON.stringify(value)
}

function sameTarget(left: FeishuPairingTarget, right: FeishuPairingTarget): boolean {
  return left.workspaceId === right.workspaceId && left.sessionId === right.sessionId
}

function wrongSession(): CommandResult {
  return commandError('只能在发起配对的 Session 中查看或更改这次配对。')
}

function commandSuccess(text: string): CommandResult {
  return { kind: 'success', text }
}

function commandError(text: string): CommandResult {
  return { kind: 'error', text }
}
