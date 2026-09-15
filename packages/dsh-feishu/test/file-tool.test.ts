import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import { FEISHU_FILE_TOOL, installFeishuFileTool, shouldInstallFeishuFileTool, type FeishuFileDelivery } from '../src/file-delivery.js'

const file = Object.freeze({ attachmentId: `sha256:${'a'.repeat(64)}`, name: 'result.txt', bytes: 19 })
const destination = Object.freeze({ routeId: 'route-a', destinationDigest: 'b'.repeat(64), description: 'Feishu chat-a / user-a' })

async function harness(enabled = true, withApproval = true) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (withApproval) await ctx.plugin(ApprovalService)
  const events = [{ type: 'turn/start', data: {} as Record<string, unknown> }]
  const agent = { ctx, session: {
    id: 'file-session', requestHeader: () => undefined,
    get seq() { return events.length }, eventAt: (seq: number) => events[seq],
    append(type: string, data: Record<string, unknown>) { const event = { type, data }; events.push(event); return event },
  } } as unknown as Agent
  const backend: FeishuFileDelivery = {
    destination: vi.fn(() => destination),
    snapshot: vi.fn(async () => file),
    submit: vi.fn(async () => ({ id: 'receipt-a', created: true, status: 'prepared' as const })),
    waitForReceipt: vi.fn(async () => ({ id: 'receipt-a', created: false, status: 'delivered' as const })),
  }
  const dispose = installFeishuFileTool(agent, enabled, backend)
  const run = (signal = new AbortController().signal) => ctx.tools.execute({
    agent, callId: ToolCallId('file-call'), name: FEISHU_FILE_TOOL,
    arguments: { file_path: 'result.txt', file_name: 'result.txt' }, signal,
  })
  return { ctx, agent, events, backend, dispose, run }
}

describe('Feishu file delivery native Tool', () => {
  it('freezes the tool surface at the native request header', () => {
    const agent = (tools: unknown[] | undefined) => ({ session: {
      requestHeader: () => tools === undefined ? undefined : { tools },
    } }) as unknown as Agent
    expect(shouldInstallFeishuFileTool(agent(undefined), true)).toBe(true)
    expect(shouldInstallFeishuFileTool(agent(undefined), false)).toBe(false)
    expect(shouldInstallFeishuFileTool(agent([]), true)).toBe(false)
    expect(shouldInstallFeishuFileTool(agent([{ name: FEISHU_FILE_TOOL }]), false)).toBe(true)
  })

  it('approves exact immutable bytes and recipient before submitting, then waits for a durable receipt', async () => {
    const h = await harness()
    h.ctx.on('approval/request', request => {
      expect(h.backend.snapshot).toHaveBeenCalledOnce()
      expect(h.backend.submit).not.toHaveBeenCalled()
      expect(request.reason).toContain(file.attachmentId)
      expect(request.reason).toContain(destination.description)
      expect(request.reason).toContain(destination.destinationDigest)
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    try {
      await expect(h.run()).resolves.toMatchObject({ isError: false, value: { status: 'delivered', fileName: 'result.txt' } })
      expect(h.backend.submit).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'file', file, routeId: destination.routeId, destinationDigest: destination.destinationDigest,
        intentKey: 'file:file-session:file-call',
      }))
      expect(h.backend.waitForReceipt).toHaveBeenCalledOnce()
      expect(h.events.map(event => event.type)).toEqual(['turn/start', 'approval/asked', 'approval/decided'])
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })

  it.each(['rejected', 'cancelled', 'unavailable'] as const)('does not submit after native Approval returns %s', async outcome => {
    const h = await harness()
    h.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>(outcome))
    try {
      expect((await h.run()).isError).toBe(true)
      expect(h.backend.submit).not.toHaveBeenCalled()
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })

  it.each([false, true])('does not snapshot when disabled or Approval is unavailable (disabled=%s)', async disabled => {
    const h = await harness(!disabled, disabled)
    try {
      expect((await h.run()).isError).toBe(true)
      expect(h.backend.snapshot).not.toHaveBeenCalled()
      expect(h.backend.submit).not.toHaveBeenCalled()
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })

  it('rejects a recipient change during Approval and does not upload', async () => {
    const h = await harness()
    h.ctx.on('approval/request', () => {
      vi.mocked(h.backend.destination).mockReturnValue({ ...destination, destinationDigest: 'c'.repeat(64) })
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    try {
      expect((await h.run()).isError).toBe(true)
      expect(h.backend.submit).not.toHaveBeenCalled()
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })

  it('disposal cancels native Approval and prevents a late allowed answer from sending', async () => {
    const h = await harness()
    let allow!: (value: ApprovalOutcome) => void
    h.ctx.on('approval/request', () => new Promise(resolve => { allow = resolve }))
    const running = h.run()
    try {
      await vi.waitFor(() => expect(allow).toBeTypeOf('function'))
      h.dispose()
      allow('allowed-once')
      expect((await running).isError).toBe(true)
      expect(h.backend.submit).not.toHaveBeenCalled()
      expect(h.ctx.tools.get(FEISHU_FILE_TOOL, h.agent)).toBeUndefined()
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })

  it.each(['prepared', 'sending', 'retrying'] as const)('reports %s without claiming delivery', async status => {
    const h = await harness()
    h.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    vi.mocked(h.backend.waitForReceipt).mockResolvedValue({ id: 'receipt-a', created: false, status })
    try {
      await expect(h.run()).resolves.toMatchObject({ isError: false, value: { status, delivered: false } })
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })

  it.each(['failed', 'uncertain'] as const)('does not mark the native Tool successful when delivery is %s', async status => {
    const h = await harness()
    h.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    vi.mocked(h.backend.waitForReceipt).mockResolvedValue({ id: 'receipt-a', created: false, status })
    try {
      const result = await h.run()
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain(status)
      expect(JSON.stringify(result.content)).toContain('receipt-a')
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })
})
