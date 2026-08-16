import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [candidateInput, dshInput] = process.argv.slice(2)
if (candidateInput === undefined || dshInput === undefined) {
  throw new Error('dispose-owned-watcher evaluator requires <candidate-dir> <dsh-source-dir>')
}

const candidateDir = await realpath(candidateInput)
const dshDir = await realpath(dshInput)
const workspace = dirname(candidateDir)
const skillSource = await readFile(join(candidateDir, 'SKILL.md'), 'utf8')
const ownsResources = skillSource.includes('timers, watchers, processes, connections, and temporary directories inside `ctx.effect()` and return cleanup')
  || skillSource.includes('timers and watchers inside `ctx.effect()` and return cleanup')

const packageScope = join(workspace, 'node_modules', '@deepseek-ai')
await mkdir(packageScope, { recursive: true })
await mkdir(join(workspace, 'node_modules', '@types'), { recursive: true })
await symlink(join(dshDir, 'vendor', 'cordis'), join(packageScope, 'cordis'), 'dir')
await symlink(
  join(dshDir, 'packages', 'core', 'system-prompt'),
  join(packageScope, 'dsh-system-prompt'),
  'dir',
)
await symlink(
  join(dshDir, 'node_modules', '@types', 'node'),
  join(workspace, 'node_modules', '@types', 'node'),
  'dir',
)
await writeFile(join(workspace, 'package.json'), '{"type":"module"}\n')
await writeFile(join(workspace, 'watched.txt'), 'initial\n')
const pluginPath = join(workspace, 'plugin.ts')
await writeFile(pluginPath, ownsResources ? correctPlugin() : knownBadPlugin())
await writeFile(join(workspace, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: 'ES2022',
    types: ['node'],
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
    config: { persona: 'Stable lifecycle fixture persona.' },
  },
  { id: 'watcher-subject', name: './plugin.ts' },
], null, 2))
const nativeConfigPath = join(workspace, 'native.cordis.yml')
await writeFile(nativeConfigPath, JSON.stringify([
  {
    id: 'system-prompt',
    name: '@deepseek-ai/dsh-system-prompt',
    config: { persona: 'Stable lifecycle fixture persona.' },
  },
], null, 2))

const subject = await import(pathToFileURL(pluginPath).href)
subject.resetProbe()
const { boot } = await import(pathToFileURL(join(dshDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href)
let ctx
let initialAssembly
let restartAssembly
let disabledAssembly
let reenabledAssembly
let initialProbe
let restartProbe
let disabledProbe
let reenabledProbe
let disposedProbe
try {
  ctx = await boot('dispose-owned-watcher-fixture', configPath)
  initialAssembly = await ctx.systemPrompt.assemble()
  await writeFile(join(workspace, 'watched.txt'), 'changed\n')
  await waitFor(() => {
    const probe = subject.inspectLifecycle()
    return probe.ticks > 0 && probe.events > 0
  }, 1_200)
  initialProbe = subject.inspectLifecycle()

  const entry = [...ctx.loader.entries()].find(item => item.options.id === 'watcher-subject')
  if (entry?.fiber === undefined) throw new Error('watcher-subject Loader entry is not active')
  await entry.fiber.restart()
  restartProbe = subject.inspectLifecycle()
  restartAssembly = await ctx.systemPrompt.assemble()

  await entry.update({ disabled: true })
  disabledProbe = subject.inspectLifecycle()
  disabledAssembly = await ctx.systemPrompt.assemble()

  await entry.update({ disabled: false })
  reenabledProbe = subject.inspectLifecycle()
  reenabledAssembly = await ctx.systemPrompt.assemble()
} finally {
  await ctx?.fiber.dispose()
  disposedProbe = subject.inspectLifecycle()
}

let nativeCtx
let nativeAssembly
try {
  nativeCtx = await boot('dispose-owned-watcher-native-fixture', nativeConfigPath)
  nativeAssembly = await nativeCtx.systemPrompt.assemble()
} finally {
  await nativeCtx?.fiber.dispose()
  subject.forceCleanup()
}

const native = JSON.stringify(nativeAssembly)
const assemblies = [initialAssembly, restartAssembly, disabledAssembly, reenabledAssembly]
  .map(value => JSON.stringify(value))
const checks = [
  { name: 'plugin-typecheck', passed: typecheck.exitCode === 0 },
  { name: 'real-loader-boot', passed: initialAssembly !== undefined },
  {
    name: 'timer-and-watcher-observed',
    passed: initialProbe?.ticks > 0 && initialProbe?.events > 0
      && initialProbe?.activeIntervals === 1 && initialProbe?.activeWatchers === 1,
  },
  {
    name: 'restart-has-one-resource-set',
    passed: restartProbe?.activeIntervals === 1 && restartProbe?.activeWatchers === 1
      && restartProbe?.maxIntervals === 1 && restartProbe?.maxWatchers === 1
      && restartProbe?.loads === 2 && restartProbe?.disposals === 1,
  },
  {
    name: 'disable-removes-all-resources',
    passed: disabledProbe?.activeIntervals === 0 && disabledProbe?.activeWatchers === 0
      && disabledProbe?.disposals === 2,
  },
  {
    name: 'reenable-has-one-resource-set',
    passed: reenabledProbe?.activeIntervals === 1 && reenabledProbe?.activeWatchers === 1
      && reenabledProbe?.maxIntervals === 1 && reenabledProbe?.maxWatchers === 1
      && reenabledProbe?.loads === 3,
  },
  {
    name: 'root-dispose-removes-all-resources',
    passed: disposedProbe?.activeIntervals === 0 && disposedProbe?.activeWatchers === 0
      && disposedProbe?.disposals === 3,
  },
  { name: 'model-composition-stable', passed: assemblies.every(value => value === native) },
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

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = () => {
      if (predicate()) {
        resolve()
      } else if (Date.now() - started >= timeoutMs) {
        reject(new Error('timed out waiting for real timer and watcher activity'))
      } else {
        setTimeout(poll, 10)
      }
    }
    poll()
  })
}

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
import { watch, type FSWatcher } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dispose-owned-watcher'

const intervals = new Set<ReturnType<typeof setInterval>>()
const watchers = new Set<FSWatcher>()
const state = {
  loads: 0,
  disposals: 0,
  ticks: 0,
  events: 0,
  maxIntervals: 0,
  maxWatchers: 0,
}

export function inspectLifecycle() {
  return {
    ...state,
    activeIntervals: intervals.size,
    activeWatchers: watchers.size,
  }
}

export function forceCleanup(): void {
  for (const interval of intervals) clearInterval(interval)
  for (const watcher of watchers) watcher.close()
  intervals.clear()
  watchers.clear()
}

export function resetProbe(): void {
  forceCleanup()
  Object.assign(state, {
    loads: 0,
    disposals: 0,
    ticks: 0,
    events: 0,
    maxIntervals: 0,
    maxWatchers: 0,
  })
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const watcher = watch(new URL('./watched.txt', import.meta.url), () => { state.events += 1 })
    const interval = setInterval(() => { state.ticks += 1 }, 10)
    watchers.add(watcher)
    intervals.add(interval)
    state.loads += 1
    state.maxIntervals = Math.max(state.maxIntervals, intervals.size)
    state.maxWatchers = Math.max(state.maxWatchers, watchers.size)
    return () => {
      clearInterval(interval)
      watcher.close()
      intervals.delete(interval)
      watchers.delete(watcher)
      state.disposals += 1
    }
  }, 'dispose-owned-watcher resources')
}
`
}

function knownBadPlugin() {
  return `
import { watch, type FSWatcher } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'leaky-watcher'

const intervals = new Set<ReturnType<typeof setInterval>>()
const watchers = new Set<FSWatcher>()
const state = {
  loads: 0,
  disposals: 0,
  ticks: 0,
  events: 0,
  maxIntervals: 0,
  maxWatchers: 0,
}

export function inspectLifecycle() {
  return {
    ...state,
    activeIntervals: intervals.size,
    activeWatchers: watchers.size,
  }
}

export function forceCleanup(): void {
  for (const interval of intervals) clearInterval(interval)
  for (const watcher of watchers) watcher.close()
  intervals.clear()
  watchers.clear()
}

export function resetProbe(): void {
  forceCleanup()
  Object.assign(state, {
    loads: 0,
    disposals: 0,
    ticks: 0,
    events: 0,
    maxIntervals: 0,
    maxWatchers: 0,
  })
}

export function apply(_ctx: Context): void {
  const watcher = watch(new URL('./watched.txt', import.meta.url), () => { state.events += 1 })
  const interval = setInterval(() => { state.ticks += 1 }, 10)
  watchers.add(watcher)
  intervals.add(interval)
  state.loads += 1
  state.maxIntervals = Math.max(state.maxIntervals, intervals.size)
  state.maxWatchers = Math.max(state.maxWatchers, watchers.size)
}
`
}
