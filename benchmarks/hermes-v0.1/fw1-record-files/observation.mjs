import path from 'node:path'

function decode(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return undefined }
}
function lines(text) {
  const result = text.replaceAll('\r\n', '\n').split('\n')
  if (result.at(-1) === '') result.pop()
  return result
}

export function inspectFileOperations(events, { cwd, root, inputs, output }) {
  const readable = new Map(inputs.map(file => [path.join(root, file.path), file.content]))
  const outputPath = path.join(root, 'result.json')
  if (output !== undefined) readable.set(outputPath, output)
  const starts = new Map(), reads = new Map(), writes = []
  let toolErrors = 0, uncorrelatedResults = 0
  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    const key = JSON.stringify([event.tool, event.callId, event.args])
    if (event.kind === 'tool-start') { starts.set(key, index); continue }
    if (event.kind !== 'tool-result') continue
    if (!starts.has(key)) { uncorrelatedResults++; continue }
    starts.delete(key)
    const result = decode(event.result)
    if (!result || result.error || result.success === false || result.is_error === true) { toolErrors++; continue }
    const raw = event.args?.path
    if (typeof raw !== 'string') continue
    const target = path.resolve(cwd, raw)
    if (['write_file', 'patch'].includes(event.tool) && target === outputPath) {
      if (event.tool === 'patch' || event.args.content === output) writes.push(index)
    }
    if (event.tool !== 'read_file' || !readable.has(target) || typeof result.content !== 'string') continue
    const expected = lines(readable.get(target))
    if (result.total_lines !== expected.length) continue
    const coverage = new Set()
    for (const line of result.content.split('\n')) {
      const match = /^\s*(\d+)\|(.*)$/u.exec(line)
      if (!match) continue
      const number = Number(match[1])
      if (number >= 1 && number <= expected.length && expected[number - 1] === match[2]) coverage.add(number)
    }
    const old = reads.get(target) ?? []
    old.push({ index, coverage })
    reads.set(target, old)
  }
  function fullyRead(target, after = -1) {
    const length = lines(readable.get(target) ?? '').length
    const covered = new Set((reads.get(target) ?? []).filter(read => read.index > after).flatMap(read => [...read.coverage]))
    return length > 0 && covered.size === length
  }
  const inputReads = inputs.map(file => ({ path: file.path, read: fullyRead(path.join(root, file.path)) }))
  const written = writes.length > 0, readBack = written && fullyRead(outputPath, writes.at(-1))
  const policyViolations = events.filter(e => e.kind === 'denied').length
  return { inputReads, written, readBack, policyViolations, toolErrors, uncorrelatedResults,
    complete: inputReads.every(f => f.read) && written && readBack && policyViolations === 0 && uncorrelatedResults === 0 }
}
