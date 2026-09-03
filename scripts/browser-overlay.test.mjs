import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const execFile = promisify(execFileCallback)
const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

test('browser overlays isolate test fixtures from DSH client package identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evoforge-browser-overlay-test-'))
  try {
    const doctorOut = join(root, 'doctor.patch.yml')
    const telegramOut = join(root, 'telegram.patch.yml')
    await execFile(process.execPath, [
      join(repositoryRoot, 'scripts/create-browser-doctor-overlay.mjs'),
      '--out', doctorOut,
      '--workspace', join(root, 'workspace'),
      '--session', 'browser-overlay-test-doctor',
    ])
    await execFile(process.execPath, [
      join(repositoryRoot, 'scripts/create-telegram-browser-overlay.mjs'),
      '--out', telegramOut,
      '--workspace-id', 'workspace-overlay-test',
      '--workspace', join(root, 'workspace'),
      '--session', 'browser-overlay-test-telegram',
    ])

    for (const outputPath of [doctorOut, telegramOut]) {
      const patch = await readFile(outputPath, 'utf8')
      const entry = patch.match(/^\s+name: (.+bootstrap\.mjs)$/mu)?.[1]
      assert.ok(entry, `overlay entry is missing: ${outputPath}`)
      assert.equal(entry.includes('packages/dsh-control-center'), false)
      const shim = await readFile(entry, 'utf8')
      assert.match(shim, /export \{ name, inject, apply \} from /u)
      assert.match(shim, /browser-doctor-bootstrap\.mjs/u)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
