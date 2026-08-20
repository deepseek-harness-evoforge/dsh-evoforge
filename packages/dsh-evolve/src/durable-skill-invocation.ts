import { isSkillName } from '@deepseek-ai/dsh-skill'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

export interface DurableSkillInvocation {
  readonly skillName: string
  readonly route: 'user-explicit' | 'model-tool'
  readonly seq: number
  /** Exact native DSH content blocks shown to the model. */
  readonly content: readonly unknown[]
}

/**
 * Extract only source-linked, successful native DSH Skill invocations. This
 * is shared by baseline sealing and feedback attribution so evidence cannot
 * disagree about which content the model actually saw.
 */
export function durableSkillInvocations(
  events: readonly SessionEvent[],
): DurableSkillInvocation[] {
  return [
    ...explicitInvocations(events),
    ...successfulToolInvocations(events),
  ].sort((left, right) => left.seq - right.seq)
}

function explicitInvocations(events: readonly SessionEvent[]): DurableSkillInvocation[] {
  return events.flatMap((event) => {
    if (event.type !== 'user/message' || sourceKind(event.data.source) !== 'skill-invocation') return []
    const skillName = sourceName(event.data.source)
    return skillName !== undefined && isSkillName(skillName)
      ? [{
          skillName,
          route: 'user-explicit' as const,
          seq: event.seq,
          content: event.data.content,
        }]
      : []
  })
}

function successfulToolInvocations(events: readonly SessionEvent[]): DurableSkillInvocation[] {
  const results = events.filter((event): event is SessionEvent<'tool/result'> =>
    event.type === 'tool/result')
  return events.flatMap((event) => {
    if (event.type !== 'tool/call' || event.data.name !== 'skill') return []
    const skillName = toolSkillName(event.data.arguments)
    if (skillName === undefined) return []
    const matches = results.flatMap(candidate => {
      if (candidate.sourceEventSeqs?.includes(event.seq) === true
        && candidate.data.error === undefined) {
        return candidate.data.message.content.filter(block =>
          block.type === 'tool-result'
          && String(block.toolCallId) === String(event.data.callId)
          && block.isError !== true)
      }
      return []
    })
    return matches.length !== 1
      ? []
      : [{
          skillName,
          route: 'model-tool' as const,
          seq: event.seq,
          content: matches[0]!.content,
        }]
  })
}

function toolSkillName(raw: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const name = (parsed as Record<string, unknown>).name
  return typeof name === 'string' && isSkillName(name) ? name : undefined
}

function sourceKind(source: unknown): string | undefined {
  if (source === null || typeof source !== 'object') return undefined
  const kind = (source as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : undefined
}

function sourceName(source: unknown): string | undefined {
  if (source === null || typeof source !== 'object') return undefined
  const name = (source as { name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}
