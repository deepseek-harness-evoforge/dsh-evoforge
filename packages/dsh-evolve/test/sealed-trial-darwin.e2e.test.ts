import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runSealedDarwinTrial } from '../src/sealed-trial-darwin.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('sealed darwin Trial executor', () => {
  it('allows the workspace while denying host reads, outside writes, network, child executables, and inherited secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-sealed-'))
    temporaryRoots.push(root)
    const workspace = join(root, 'trial')
    const outsideSecret = join(root, 'outside-secret.txt')
    const outsideWrite = join(root, 'outside-write.txt')
    await mkdir(workspace)
    await writeFile(outsideSecret, 'must-not-be-readable')
    const script = join(workspace, 'probe.cjs')
    await writeFile(
      script,
      `
const fs = require('node:fs')
const net = require('node:net')
const childProcess = require('node:child_process')

const facts = { inheritedSecret: process.env.DSH_EVOLVE_TEST_SECRET ?? null }
fs.writeFileSync(${JSON.stringify(join(workspace, 'inside.txt'))}, 'inside-ok')
facts.inside = fs.readFileSync(${JSON.stringify(join(workspace, 'inside.txt'))}, 'utf8')
try { fs.readFileSync(${JSON.stringify(outsideSecret)}, 'utf8'); facts.outsideRead = 'allowed' }
catch (error) { facts.outsideRead = error.code }
try { fs.writeFileSync(${JSON.stringify(outsideWrite)}, 'escaped'); facts.outsideWrite = 'allowed' }
catch (error) { facts.outsideWrite = error.code }
const child = childProcess.spawnSync('/bin/sh', ['-c', 'true'])
facts.childExec = child.error?.code ?? child.status
const socket = net.connect(443, '1.1.1.1', () => { facts.network = 'allowed'; finish() })
socket.on('error', (error) => { facts.network = error.code; finish() })
setTimeout(() => { facts.network = 'timeout'; finish() }, 1000).unref()
function finish() { process.stdout.write(JSON.stringify(facts)); socket.destroy() }
`,
    )

    const previousSecret = process.env.DSH_EVOLVE_TEST_SECRET
    process.env.DSH_EVOLVE_TEST_SECRET = 'must-not-cross-trial-boundary'
    try {
      const result = await runSealedDarwinTrial({
        argv: [process.execPath, script],
        outputLimitBytes: 64 * 1024,
        timeoutMs: 5_000,
        workspace,
      })

      expect(result).toMatchObject({ backend: 'darwin-seatbelt', enforcement: 'full' })
      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        inheritedSecret: null,
        inside: 'inside-ok',
        outsideRead: 'EPERM',
        outsideWrite: 'EPERM',
        childExec: 'EPERM',
        network: 'EPERM',
      })
      expect(await readFile(join(workspace, 'inside.txt'), 'utf8')).toBe('inside-ok')
      await expect(readFile(outsideWrite, 'utf8')).rejects.toThrow()
    } finally {
      if (previousSecret === undefined) delete process.env.DSH_EVOLVE_TEST_SECRET
      else process.env.DSH_EVOLVE_TEST_SECRET = previousSecret
    }
  })

  it('kills a Trial that exceeds its wall-clock budget', async () => {
    const workspace = await createWorkspace()
    const script = join(workspace, 'never-finishes.cjs')
    await writeFile(script, 'setInterval(() => {}, 1_000)')

    const result = await runSealedDarwinTrial({
      argv: [process.execPath, script],
      outputLimitBytes: 1_024,
      timeoutMs: 100,
      workspace,
    })

    expect(result).toMatchObject({
      backend: 'darwin-seatbelt',
      enforcement: 'full',
      exitCode: null,
      signal: 'SIGKILL',
      timedOut: true,
    })
  })

  it('kills a Trial and truncates evidence at the combined output limit', async () => {
    const workspace = await createWorkspace()
    const script = join(workspace, 'too-loud.cjs')
    await writeFile(script, `process.stdout.write('x'.repeat(128 * 1024))`)

    const result = await runSealedDarwinTrial({
      argv: [process.execPath, script],
      outputLimitBytes: 1_024,
      timeoutMs: 5_000,
      workspace,
    })

    expect(result.outputTruncated).toBe(true)
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBe(1_024)
  })

  it('grants only declared runtime reads and child executables for an assembled Trial', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-assembled-sealed-'))
    temporaryRoots.push(root)
    const workspace = join(root, 'trial')
    const runtime = join(root, 'runtime')
    await mkdir(workspace)
    await mkdir(runtime)
    await writeFile(join(runtime, 'visible.txt'), 'runtime-visible')
    const attemptedWrite = join(runtime, 'must-stay-read-only.txt')
    const childScript = join(workspace, 'child.cjs')
    const parentScript = join(workspace, 'parent.cjs')
    await writeFile(
      childScript,
      `
const fs = require('node:fs')
const facts = { runtimeRead: fs.readFileSync(${JSON.stringify(join(runtime, 'visible.txt'))}, 'utf8') }
try { fs.writeFileSync(${JSON.stringify(attemptedWrite)}, 'escaped'); facts.runtimeWrite = 'allowed' }
catch (error) { facts.runtimeWrite = error.code }
process.stdout.write(JSON.stringify(facts))
`,
    )
    await writeFile(
      parentScript,
      `
const { spawnSync } = require('node:child_process')
const child = spawnSync(process.execPath, [${JSON.stringify(childScript)}], { encoding: 'utf8' })
if (child.error) throw child.error
if (child.status !== 0) throw new Error(child.stderr)
process.stdout.write(child.stdout)
`,
    )

    const result = await runSealedDarwinTrial({
      argv: [process.execPath, parentScript],
      allowProcessFork: true,
      allowedExecutables: [process.execPath],
      outputLimitBytes: 64 * 1024,
      readOnlyRoots: [runtime],
      timeoutMs: 5_000,
      workspace,
    })

    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      runtimeRead: 'runtime-visible',
      runtimeWrite: 'EPERM',
    })
    await expect(readFile(attemptedWrite, 'utf8')).rejects.toThrow()
  })
})

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-sealed-'))
  temporaryRoots.push(root)
  const workspace = join(root, 'trial')
  await mkdir(workspace)
  return workspace
}
