import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import {
  FEISHU_CONTENT_TOOL,
  installFeishuContentTool,
  shouldInstallFeishuContentTool,
  type FeishuContentReadRequest,
  type FeishuContentReadResult,
  type FeishuContentReader,
} from '../src/content.js'
import type { FeishuContentPermission } from '../src/config.js'

const signal = new AbortController().signal

describe('native Feishu content Tool', () => {
  it('keeps the model surface future-Session-only while preserving a previously visible schema', () => {
    const permissions = new Set<FeishuContentPermission>(['document-read'])
    expect(shouldInstallFeishuContentTool(sessionAgent(undefined), permissions)).toBe(true)
    expect(shouldInstallFeishuContentTool(sessionAgent([]), permissions)).toBe(false)
    expect(shouldInstallFeishuContentTool(sessionAgent([{
      name: FEISHU_CONTENT_TOOL,
      description: 'old schema',
      parameters: { type: 'object', properties: {} },
    }]), new Set())).toBe(true)
    expect(shouldInstallFeishuContentTool(sessionAgent([]), new Set())).toBe(false)
  })

  it('uses the real tools pipeline and native Approval before one bounded document read', async () => {
    const { ctx, agent, approvalEvents } = await harness()
    const reader: FeishuContentReader = {
      read: vi.fn(async (
        _request: FeishuContentReadRequest,
        callSignal: AbortSignal,
      ): Promise<FeishuContentReadResult> => {
        expect(callSignal).toBe(signal)
        return {
          schemaVersion: 1,
          kind: 'document',
          title: 'Design',
          objectType: 'docx',
          contentFormat: 'text/plain',
          content: 'private approved content',
          truncated: false,
        }
      }),
    }
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    const dispose = installFeishuContentTool(agent, policy(['document-read']), reader)

    const result = await ctx.tools.execute({
      callId: CallId('content-1'),
      name: FEISHU_CONTENT_TOOL,
      arguments: { kind: 'document', token_or_url: 'doxcnDocument123' },
      agent,
      signal,
    })

    expect(result).toMatchObject({
      isError: false,
      value: {
        schemaVersion: 1,
        kind: 'document',
        title: 'Design',
        content: 'private approved content',
      },
    })
    expect(reader.read).toHaveBeenCalledOnce()
    expect(approvalEvents.map(event => event.type)).toEqual(['approval/asked', 'approval/decided'])
    expect(approvalEvents[0]?.data).toMatchObject({
      toolName: FEISHU_CONTENT_TOOL,
      callId: 'content-1',
      reason: expect.stringContaining('current DSH Session'),
    })
    expect(approvalEvents[1]?.data).toMatchObject({ outcome: 'allowed-once' })

    dispose()
    expect(ctx.tools.get(FEISHU_CONTENT_TOOL, agent)).toBeUndefined()
  })

  it('denies an independently disabled resource before Approval or platform access', async () => {
    const { ctx, agent, approvalEvents } = await harness()
    const reader: FeishuContentReader = { read: vi.fn() }
    let asked = 0
    ctx.on('approval/request', () => {
      asked += 1
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    installFeishuContentTool(agent, policy(['document-read']), reader)

    const result = await ctx.tools.execute({
      callId: CallId('content-denied'),
      name: FEISHU_CONTENT_TOOL,
      arguments: { kind: 'wiki', token_or_url: 'wikcnNode123' },
      agent,
      signal,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('wiki-read') })
    expect(asked).toBe(0)
    expect(approvalEvents).toEqual([])
    expect(reader.read).not.toHaveBeenCalled()
  })

  it('does not touch Feishu when native Approval rejects the exact call', async () => {
    const { ctx, agent } = await harness()
    const reader: FeishuContentReader = { read: vi.fn() }
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('rejected'))
    installFeishuContentTool(agent, policy(['bitable-records-read']), reader)

    const result = await ctx.tools.execute({
      callId: CallId('content-rejected'),
      name: FEISHU_CONTENT_TOOL,
      arguments: {
        kind: 'bitable',
        token_or_url: 'bascnApp123',
        table_id: 'tblRecords123',
        page_size: 5,
      },
      agent,
      signal,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('user rejected') })
    expect(reader.read).not.toHaveBeenCalled()
  })

  it('fails closed before platform access when no native Approval service is installed', async () => {
    const { ctx, agent } = await harness(false)
    const reader: FeishuContentReader = { read: vi.fn() }
    installFeishuContentTool(agent, policy(['document-read']), reader)

    const result = await ctx.tools.execute({
      callId: CallId('content-no-approval'),
      name: FEISHU_CONTENT_TOOL,
      arguments: { kind: 'document', token_or_url: 'doxcnDocument123' },
      agent,
      signal,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('current DSH Session') })
    expect(reader.read).not.toHaveBeenCalled()
  })

  it('validates resource-specific arguments inside the protected operation', async () => {
    const { ctx, agent } = await harness()
    const reader: FeishuContentReader = { read: vi.fn() }
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    installFeishuContentTool(agent, policy(['drive-metadata-read']), reader)

    const result = await ctx.tools.execute({
      callId: CallId('content-invalid'),
      name: FEISHU_CONTENT_TOOL,
      arguments: { kind: 'drive', token_or_url: 'boxcnFile123' },
      agent,
      signal,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('drive_type') })
    expect(reader.read).not.toHaveBeenCalled()
  })
})

function policy(permissions: readonly FeishuContentPermission[]) {
  return {
    permissions: new Set(permissions),
    maxContentChars: 20_000,
    maxBitableRecords: 20,
  }
}

async function harness(withApproval = true): Promise<{
  ctx: Context
  agent: Agent
  approvalEvents: Array<{ type: string; data: Record<string, unknown> }>
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (withApproval) await ctx.plugin(ApprovalService)
  const approvalEvents: Array<{ type: string; data: Record<string, unknown> }> = []
  const events: Array<{ type: string; data: Record<string, unknown> }> = [
    { type: 'turn/start', data: { turn: 1 } },
  ]
  const session = {
    id: 'feishu-content-test',
    events,
    requestHeader: () => undefined,
    append(type: string, data: Record<string, unknown>) {
      const event = { type, data }
      approvalEvents.push(event)
      events.push(event)
      return event
    },
  }
  const agent = { ctx, session } as unknown as Agent
  return { ctx, agent, approvalEvents }
}

function sessionAgent(tools: unknown[] | undefined): Agent {
  return {
    session: {
      requestHeader: () => tools === undefined
        ? undefined
        : { config: { provider: 'test', model: 'test' }, tools },
    },
  } as unknown as Agent
}
