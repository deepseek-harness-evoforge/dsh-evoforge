import { isDeepStrictEqual } from 'node:util'

/**
 * Private, read-only provenance projection for the audited alpha.5 format.
 * This is not a Session implementation or a model-message composer. Current
 * DSH foldSurface rejects v0 Assistant citations; source records must not be
 * stripped or relabelled to make them acceptable to that newer contract.
 * Rules are pinned to db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5,
 * packages/core/session/src/surface.ts. Call only after selecting v0 dialect.
 */
export function foldHistoricalV0Surface(events: readonly unknown[]): {
  readonly nodes: number[]
  readonly replacements: { readonly seq: number; readonly shadowedSeqs: number[] }[]
} {
  const nodes: number[] = []
  const replacements: { seq: number; shadowedSeqs: number[] }[] = []
  for (const [seq, value] of events.entries()) {
    const event = record(value)
    if (event.seq !== seq) invalid()
    const eligible = event.type === 'user/message'
      || event.type === 'assistant/message' || event.type === 'tool/result'
    if (!eligible) {
      if (event.surfaceOp !== undefined || event.sourceEventSeqs !== undefined) invalid()
      continue
    }
    const append = event.surfaceOp === 'append'
    let start = nodes.length
    let count = 0
    if (!append) {
      const op = record(event.surfaceOp)
      if (Object.keys(op).length !== 3
        || !['op', 'start', 'end'].every(key => Object.hasOwn(op, key))
        || op.op !== 'replace'
        || !eventSeq(op.start) || !eventSeq(op.end)) invalid()
      start = nodes.indexOf(op.start)
      const end = nodes.indexOf(op.end)
      if (start < 0 || end < start) invalid()
      count = end - start + 1
    }
    const shadowedSeqs = nodes.slice(start, start + count)
    const cited = new Set<number>()
    if (event.sourceEventSeqs !== undefined) {
      const sources = event.sourceEventSeqs
      if (!Array.isArray(sources)
        || (sources.length === 0 && event.type !== 'assistant/message')) invalid()
      for (const source of sources) {
        if (!eventSeq(source) || source >= seq || cited.has(source)) invalid()
        cited.add(source)
      }
    }
    if (shadowedSeqs.some(source => !cited.has(source))) invalid()
    if (!append && event.type === 'tool/result') {
      if (shadowedSeqs.length !== 1) invalid()
      const original = record(events[shadowedSeqs[0]!])
      if (original.type !== 'tool/result'
        || !isDeepStrictEqual(toolIdentity(original.data), toolIdentity(event.data))) invalid()
    }
    nodes.splice(start, count, seq)
    if (!append) replacements.push({ seq, shadowedSeqs })
  }
  return { nodes, replacements }
}

function toolIdentity(value: unknown): unknown {
  const data = record(value)
  const message = record(data.message)
  if (!Array.isArray(message.content) || message.content.length !== 1) invalid()
  const result = record(message.content[0])
  return { ...data, message: { ...message, content: [{ ...result, content: null }] } }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function eventSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
}

function invalid(): never {
  throw new Error('Invalid historical v0 surface provenance')
}
