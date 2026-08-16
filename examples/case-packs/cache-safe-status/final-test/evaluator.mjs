import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [candidateInput, dshInput] = process.argv.slice(2)
if (candidateInput === undefined || dshInput === undefined) {
  throw new Error('cache-safe evaluator requires <candidate-dir> <dsh-source-dir>')
}

const candidateDir = await realpath(candidateInput)
const dshDir = await realpath(dshInput)
const workspace = dirname(candidateDir)
const skillSource = await readFile(join(candidateDir, 'SKILL.md'), 'utf8')
const cacheSafe = skillSource.includes('Default to zero model surface')
  && skillSource.includes('Keep progress, timestamps, approvals, Candidate state, and UI projections in the host plane.')

const packageScope = join(workspace, 'node_modules', '@deepseek-ai')
await mkdir(packageScope, { recursive: true })
await symlink(join(dshDir, 'vendor', 'cordis'), join(packageScope, 'cordis'), 'dir')
await symlink(
  join(dshDir, 'packages', 'core', 'system-prompt'),
  join(packageScope, 'dsh-system-prompt'),
  'dir',
)
await writeFile(join(workspace, 'package.json'), '{"type":"module"}\n')
const pluginPath = join(workspace, 'plugin.ts')
await writeFile(pluginPath, cacheSafe ? correctPlugin() : knownBadPlugin())
await writeFile(join(workspace, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: 'ES2022',
  },
  files: ['./plugin.ts'],
}, null, 2))

const typecheck = await runBounded(
  process.execPath,
  [join(dshDir, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', join(workspace, 'tsconfig.json')],
  { cwd: workspace, maxBytes: 256 * 1024, timeoutMs: 8_000 },
)

const configPath = join(workspace, 'cordis.yml')
await writeFile(configPath, JSON.stringify([
  {
    id: 'system-prompt',
    name: '@deepseek-ai/dsh-system-prompt',
    config: { persona: 'Stable cache fixture persona.' },
  },
  { id: 'status-subject', name: './plugin.ts' },
], null, 2))
const nativeConfigPath = join(workspace, 'native.cordis.yml')
await writeFile(nativeConfigPath, JSON.stringify([
  {
    id: 'system-prompt',
    name: '@deepseek-ai/dsh-system-prompt',
    config: { persona: 'Stable cache fixture persona.' },
  },
], null, 2))

const { boot } = await import(pathToFileURL(join(dshDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href)
let ctx
let initialAssembly
let changedAssembly
let hostProjection = false
let disposedService = false
try {
  ctx = await boot('cache-safe-status-fixture', configPath)
  initialAssembly = await ctx.systemPrompt.assemble()
  const service = ctx.get('evoforgeStatus')
  if (service !== undefined && typeof service.update === 'function' && typeof service.snapshot === 'function') {
    service.update({ goalPhase: 'active', approvals: 1, candidate: 'testing' })
    hostProjection = JSON.stringify(service.snapshot()) === JSON.stringify({
      goalPhase: 'active', approvals: 1, candidate: 'testing',
    })
  } else {
    const subject = await import(pathToFileURL(pluginPath).href)
    subject.updateStatus?.({ goalPhase: 'active', approvals: 1, candidate: 'testing' })
  }
  changedAssembly = await ctx.systemPrompt.assemble()
} finally {
  await ctx?.fiber.dispose()
  disposedService = ctx?.get('evoforgeStatus') === undefined
}

let nativeCtx
let nativeAssembly
try {
  nativeCtx = await boot('cache-safe-status-native-fixture', nativeConfigPath)
  nativeAssembly = await nativeCtx.systemPrompt.assemble()
} finally {
  await nativeCtx?.fiber.dispose()
}

const initial = JSON.stringify(initialAssembly)
const changed = JSON.stringify(changedAssembly)
const native = JSON.stringify(nativeAssembly)
const noStatusInModelSurface = !changed.includes('goalPhase')
  && !changed.includes('approvals')
  && !changed.includes('candidate')
const checks = [
  { name: 'plugin-typecheck', passed: typecheck.exitCode === 0 },
  { name: 'real-loader-boot', passed: initialAssembly !== undefined },
  { name: 'host-status-projection', passed: hostProjection },
  { name: 'status-update-keeps-composition-stable', passed: initial === changed },
  { name: 'status-absent-from-model-surface', passed: noStatusInModelSurface },
  { name: 'dispose-removes-host-service', passed: disposedService },
  { name: 'removal-restores-native-composition', passed: initial === native },
]

process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  passed: checks.every(check => check.passed),
  checks,
  composition: {
    fingerprint: createHash('sha256').update(native).digest('hex'),
    modelCalls: 0,
    usage: {},
  },
}))

function runBounded(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      env: {
        HOME: options.cwd,
        LANG: 'C',
        LC_ALL: 'C',
        PATH: '/usr/bin:/bin',
        TMPDIR: join(options.cwd, '.trial-tmp'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let bytes = 0
    let settled = false
    const kill = () => {
      if (child.pid === undefined) return
      try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }
    const collect = target => chunk => {
      bytes += chunk.byteLength
      if (bytes > options.maxBytes) {
        kill()
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    const timeout = setTimeout(kill, options.timeoutMs)
    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', exitCode => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (bytes > options.maxBytes) {
        reject(new Error('plugin typecheck exceeded output budget'))
        return
      }
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
  })
}

function correctPlugin() {
  return `
import { Service, type Context } from '@deepseek-ai/cordis'

export const name = 'cache-safe-status'

export interface StatusSnapshot {
  goalPhase: string
  approvals: number
  candidate: string
}

export default class StatusProjection extends Service {
  private current: StatusSnapshot = { goalPhase: 'none', approvals: 0, candidate: 'none' }

  constructor(ctx: Context) {
    super(ctx, 'evoforgeStatus')
  }

  update(next: StatusSnapshot): void {
    this.current = { ...next }
  }

  snapshot(): StatusSnapshot {
    return { ...this.current }
  }
}
`
}

function knownBadPlugin() {
  return `
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'cache-unsafe-status'
export const inject = ['systemPrompt']

let current = { goalPhase: 'none', approvals: 0, candidate: 'none' }

export function updateStatus(next: typeof current): void {
  current = { ...next }
}

export function apply(ctx: Context): void {
  ctx.systemPrompt.context({
    name: 'changing-status',
    order: 10,
    text: () => JSON.stringify(current),
  })
}
`
}
