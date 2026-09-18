import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

/** Presentation only: never turn a partial or ambiguous native call into an approvable card. */
export function approvalDetails(
  request: Pick<ApprovalRequest, 'toolName' | 'callId' | 'reason'>,
  events: readonly SessionEvent[],
  maxChars: number,
): string | undefined {
  let argumentsText = '该请求未关联具体工具调用。'
  if (request.callId !== undefined) {
    // Providers may reuse call ids in a later turn; only the current native turn can answer this question.
    let start = events.length - 1
    while (start >= 0 && events[start]?.type !== 'turn/start') start--
    const boundary = events[start]
    if (boundary?.type !== 'turn/start') return undefined
    const calls = events.slice(start + 1).filter(event => event.type === 'tool/call'
      && event.data.turn === boundary.data.turn && event.data.callId === request.callId)
    if (calls.length !== 1) return undefined
    const call = calls[0]!
    if (call.type !== 'tool/call' || call.data.name !== request.toolName || call.data.arguments.length === 0) return undefined
    argumentsText = `原生工具参数（完整原文）：\n${call.data.arguments}`
  }
  const content = `等待审批\n\n操作：${request.toolName}\n\n${argumentsText}`
    + (request.reason === undefined ? '' : `\n\n原因：${request.reason}`)
    + '\n\n请核对上述操作；允许一次只批准本次请求，不会永久放宽权限。'
  return content.length <= maxChars ? content : undefined
}

export const APPROVAL_DETAILS_UNAVAILABLE = '审批详情无法完整展示\n\n请在 DSH Web 的原会话中核对并处理本次审批。'
  + '\n这里不提供批准按钮；这条通知不代表操作已获准或已完成。'
