import { createHash } from 'node:crypto'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { describe, expect, it, vi } from 'vitest'
import { snapshotNativeFile, type NativeFileAttachments } from '../src/file-delivery.js'

function harness(inside = true) {
  const data = Buffer.from('native snapshot bytes')
  const fs = {
    resolve: vi.fn(async (path: string) => ({ targetKey: path, displayPath: path })),
    stat: vi.fn(async () => ({ type: 'file', size: data.length, version: 'v1' })),
    contains: vi.fn(() => inside), readBytes: vi.fn(async () => data),
  }
  const attachments: NativeFileAttachments = {
    saveFileStream: vi.fn(async input => {
      const chunks = []
      for await (const chunk of input.data) chunks.push(Buffer.from(chunk))
      const saved = Buffer.concat(chunks)
      return { attachmentId: `sha256:${createHash('sha256').update(saved).digest('hex')}`, bytes: saved.length, name: input.name }
    }),
    readFileStream: vi.fn(),
  }
  const run = (name = 'result.txt', signal = new AbortController().signal) => snapshotNativeFile(
    fs as unknown as FileSystem, attachments, '/workspace', 'result.txt', name, signal,
  )
  return { data, fs, attachments, run }
}

describe('native output file snapshot', () => {
  it('rejects a target resolved outside the Session workspace before reading bytes or storing an attachment', async () => {
    const h = harness(false)
    await expect(h.run()).rejects.toThrow(/workspace/u)
    expect(h.fs.readBytes).not.toHaveBeenCalled()
    expect(h.attachments.saveFileStream).not.toHaveBeenCalled()
  })

  it('uses the native filesystem byte cap and streamed native attachment store', async () => {
    const h = harness()
    const ref = await h.run()
    expect(ref).toEqual({ name: 'result.txt', bytes: h.data.length, attachmentId: `sha256:${createHash('sha256').update(h.data).digest('hex')}` })
    expect(h.fs.readBytes).toHaveBeenCalledWith(expect.objectContaining({ targetKey: 'result.txt' }), expect.any(AbortSignal), 30_000_000)
    expect(Object.isFrozen(ref)).toBe(true)
  })

  it('rejects a mismatched native snapshot before asking for approval', async () => {
    const h = harness()
    vi.mocked(h.attachments.saveFileStream).mockResolvedValue({ name: 'result.txt', bytes: h.data.length, attachmentId: `sha256:${'f'.repeat(64)}` })
    await expect(h.run()).rejects.toThrow(/match/u)
  })

  it.each(['../secret', '', 'a\nb'])('does not read an invalid display filename %j', async name => {
    const h = harness()
    await expect(h.run(name)).rejects.toThrow(/name/u)
    expect(h.fs.readBytes).not.toHaveBeenCalled()
  })

  it('does not start a late snapshot after cancellation', async () => {
    const h = harness()
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    await expect(h.run('result.txt', abort.signal)).rejects.toThrow('cancelled')
    expect(h.fs.readBytes).not.toHaveBeenCalled()
  })
})
