import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('official Feishu SDK socket lifecycle', () => {
  it('reports a stalled handshake without killing the hosting process', () => {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL(
      './fixtures/websocket-handshake-timeout.mjs', import.meta.url,
    ))], { encoding: 'utf8', timeout: 5_000 })

    expect(child.error).toBeUndefined()
    expect(child.signal).toBeNull()
    expect(child.status, child.stderr).toBe(0)
    expect(child.stdout).toContain('timeout-reported-without-process-crash')
    expect(child.stderr).not.toContain('Unhandled')
  })
})
