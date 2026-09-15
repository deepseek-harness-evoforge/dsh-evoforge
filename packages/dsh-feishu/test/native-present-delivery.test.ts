import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import { installFeishuPresentDelivery, type FeishuFileDelivery } from '../src/file-delivery.js'

async function fixture(enabled = true, withApproval = true) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (withApproval) await ctx.plugin(ApprovalService)
  const events: unknown[] = [{ type: 'turn/start', data: {} }]
  const agent = { ctx, session: {
    id: 'old-file-session', requestHeader: () => ({ tools: [{ name: 'present' }] }),
    get seq() { return events.length }, eventAt: (seq: number) => events[seq],
    append(type: string, data: unknown) { const event = { type, data }; events.push(event); return event },
  } } as unknown as Agent
  let feishuTurn = true
  const backend: FeishuFileDelivery = {
    destination: vi.fn(() => ({ routeId: 'route', destinationDigest: 'b'.repeat(64), description: 'test chat / test user' })),
    snapshot: vi.fn(async () => ({ attachmentId: `sha256:${'a'.repeat(64)}`, name: 'result.txt', bytes: 7 })),
    submit: vi.fn(async () => ({ id: 'receipt', created: true, status: 'prepared' as const })),
    waitForReceipt: vi.fn(async () => ({ id: 'receipt', created: false, status: 'delivered' as const })),
  }
  ctx.tools.register(defineTool({
    name: 'present', description: 'Fixture for the native present result contract; real body is covered by assembled tests.',
    parameters: { files: { type: 'json', required: true } },
    output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: 'Presented result.txt' }] },
    execute: async args => ({ turn: 1, files: args.files }),
  }))
  const schemas = structuredClone(ctx.tools.schemas(agent))
  const dispose = installFeishuPresentDelivery(agent, enabled, backend, () => feishuTurn)
  const run = (files: unknown = [{ path: 'result.txt' }], caller = agent) => ctx.tools.execute({
    agent: caller, callId: ToolCallId('present-call'), name: 'present', arguments: { files }, signal: new AbortController().signal,
  })
  return { ctx, agent, backend, run, dispose, schemas, setWebTurn: () => { feishuTurn = false } }
}

describe('native present Feishu transport result', () => {
  it('preserves old Session schemas and canonical native value while appending a real delivery receipt', async () => {
    const h = await fixture()
    h.ctx.on('approval/request', request => {
      expect(request.toolName).toBe('present')
      expect(h.backend.submit).not.toHaveBeenCalled()
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    try {
      const result = await h.run()
      expect(result).toMatchObject({ isError: false, value: { turn: 1, files: [{ path: 'result.txt' }] } })
      const receipt = result.content.at(-1)
      expect(receipt?.type).toBe('text')
      expect(receipt?.type === 'text' ? JSON.parse(receipt.text) : undefined).toMatchObject({ status: 'delivered', delivered: true })
      expect(h.ctx.tools.schemas(h.agent)).toEqual(h.schemas)
      expect(h.ctx.tools.get('feishu_file_send', h.agent)).toBeUndefined()
      expect(h.backend.submit).toHaveBeenCalledOnce()
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })

  it.each(['web', 'other-agent', 'removed'] as const)('leaves native presentation alone for %s', async kind => {
    const h = await fixture()
    if (kind === 'web') h.setWebTurn()
    if (kind === 'removed') h.dispose()
    try {
      expect((await h.run(undefined, kind === 'other-agent' ? { ...h.agent } as Agent : h.agent)).isError).toBe(false)
      expect(h.backend.snapshot).not.toHaveBeenCalled()
      expect(h.backend.submit).not.toHaveBeenCalled()
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })

  it.each(['disabled', 'missing-approval'] as const)('does not claim attachment delivery when %s', async kind => {
    const h = await fixture(kind !== 'disabled', kind !== 'missing-approval')
    try {
      const result = await h.run()
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('不能宣称已发送')
      expect(h.backend.snapshot).not.toHaveBeenCalled()
      expect(h.backend.submit).not.toHaveBeenCalled()
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })

  it.each(['prepared', 'sending', 'retrying', 'failed', 'uncertain'] as const)('does not mark present successful for a %s receipt', async status => {
    const h = await fixture()
    h.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    vi.mocked(h.backend.waitForReceipt).mockResolvedValue({ id: 'receipt', created: false, status })
    try {
      const result = await h.run()
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain(status)
      expect(JSON.stringify(result.content)).toContain('不要自动重发')
      expect(h.backend.submit).toHaveBeenCalledOnce()
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })

  it.each(['blocked', 'replaced-value'] as const)('respects another post-execute policy: %s', async kind => {
    const h = await fixture()
    h.ctx.on('tools/post-execute', async () => kind === 'blocked'
      ? { kind: 'block', feedback: [{ type: 'text', text: 'policy blocked' }] }
      : { kind: 'accept', value: { turn: 1, files: [{ path: 'different.txt' }] } })
    try {
      expect((await h.run()).isError).toBe(true)
      expect(h.backend.snapshot).not.toHaveBeenCalled()
      expect(h.backend.submit).not.toHaveBeenCalled()
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })

  it('does not snapshot or send any member of an unsupported multi-file call', async () => {
    const h = await fixture()
    try {
      expect((await h.run([{ path: 'result.txt' }, { path: 'second.txt' }])).isError).toBe(true)
      expect(h.backend.snapshot).not.toHaveBeenCalled()
      expect(h.backend.submit).not.toHaveBeenCalled()
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })

  it('never sends a denied native present body', async () => {
    const h = await fixture()
    h.ctx.tools.guard(() => 'native policy denied')
    try {
      expect((await h.run()).isError).toBe(true)
      expect(h.backend.snapshot).not.toHaveBeenCalled()
      expect(h.backend.submit).not.toHaveBeenCalled()
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })

  it('cancels an in-flight approval on unload and ignores a late approval', async () => {
    const h = await fixture()
    let allow!: (value: ApprovalOutcome) => void
    h.ctx.on('approval/request', () => new Promise(resolve => { allow = resolve }))
    const running = h.run()
    try {
      await vi.waitFor(() => expect(allow).toBeTypeOf('function'))
      h.dispose()
      allow('allowed-once')
      expect((await running).isError).toBe(true)
      expect(h.backend.submit).not.toHaveBeenCalled()
      expect(h.ctx.tools.get('present', h.agent)).toBeDefined()
    } finally { h.dispose(); await h.ctx.fiber.dispose() }
  })
})
