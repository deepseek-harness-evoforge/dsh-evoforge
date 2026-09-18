import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { approvalDetails } from '../src/approval-presentation.js'

const id = ToolCallId('call-exact')
const request = { toolName: 'bash', callId: id, reason: '请执行本次操作。' }
const args = JSON.stringify({ command: 'printf "<at id=all> **not markup**"', description: '原始说明' })
const start = { type: 'turn/start', data: { turn: 2 } } as SessionEvent
const call = { type: 'tool/call', data: { turn: 2, callId: id, name: 'bash', arguments: args } } as SessionEvent

describe('Feishu complete native approval details', () => {
  it('preserves the exact native arguments and explanation without parsing or truncation', () => {
    const content = approvalDetails(request, [start, call], 4000)!
    expect(content).toContain(args)
    expect(content).toContain(request.reason)
    expect(content).toContain('只批准本次请求')
    expect(approvalDetails(request, [start, call], content.length)).toBe(content)
    expect(approvalDetails(request, [start, call], content.length - 1)).toBeUndefined()
  })

  it.each(['missing', 'duplicate', 'wrong-name', 'wrong-id', 'empty'] as const)('does not offer approval for %s source', mode => {
    const events = mode === 'missing' ? [] : mode === 'duplicate' ? [call, call] : [{
      ...call, data: { ...call.data,
        ...(mode === 'wrong-name' ? { name: 'write' } : {}),
        ...(mode === 'wrong-id' ? { callId: ToolCallId('other') } : {}),
        ...(mode === 'empty' ? { arguments: '' } : {}),
      },
    }] as SessionEvent[]
    expect(approvalDetails(request, [start, ...events], 4000)).toBeUndefined()
  })

  it('does not substitute an unrelated call for a non-tool native question', () => {
    const content = approvalDetails({ toolName: 'review', reason: '确认计划' }, [start, call], 4000)!
    expect(content).toContain('未关联具体工具调用')
    expect(content).not.toContain(args)
  })

  it('does not truncate an oversized reason or argument suffix', () => {
    expect(approvalDetails({ ...request, reason: 'x'.repeat(4001) }, [start, call], 4000)).toBeUndefined()
    const long = { ...call, data: { ...call.data, arguments: 'x'.repeat(4001) } } as SessionEvent
    expect(approvalDetails(request, [start, long], 4000)).toBeUndefined()
  })

  it('scopes repeated provider call ids to the current native turn', () => {
    const prior = { ...call, data: { ...call.data, turn: 1, arguments: 'OLD PRIVATE ARGUMENTS' } } as SessionEvent
    const content = approvalDetails(request, [prior, start, call], 4000)!
    expect(content).toContain(args)
    expect(content).not.toContain('OLD PRIVATE ARGUMENTS')
    expect(approvalDetails(request, [prior, start], 4000)).toBeUndefined()
    expect(approvalDetails(request, [call], 4000)).toBeUndefined()
  })
})
