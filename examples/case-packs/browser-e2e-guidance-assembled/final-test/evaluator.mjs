import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, realpath } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'

const [candidateInput, dshInput] = process.argv.slice(2)
if (candidateInput === undefined || dshInput === undefined) {
  throw new Error('assembled evaluator requires <candidate-dir> <dsh-source-dir>')
}

const candidateDir = await realpath(candidateInput)
const dshDir = await realpath(dshInput)
const workspace = dirname(candidateDir)
const skillSource = await readFile(join(candidateDir, 'SKILL.md'), 'utf8')
const skillHome = join(workspace, '.agents-home', 'skills', 'browser-e2e-baseline')
await mkdir(skillHome, { recursive: true })
await cp(join(candidateDir, 'SKILL.md'), join(skillHome, 'SKILL.md'))

const driver = join(dshDir, 'examples', 'headless-agent', 'tests', 'fixtures', 'headless-driver.ts')
const config = join(dshDir, 'examples', 'headless-agent', 'tests', 'fixtures', 'cli.cordis.yml')
const execution = await runBounded(
  process.execPath,
  [driver, config, '/browser-e2e-baseline', 'verify', 'the', 'real', 'GUI', 'flow'],
  {
    cwd: workspace,
    env: {
      DSH_AGENTS_HOME: join(workspace, '.agents-home'),
      DSH_HOME: join(workspace, '.dsh-home'),
      DSH_TELEMETRY_DISABLED: '1',
      HOME: workspace,
      LANG: 'C',
      LC_ALL: 'C',
      PATH: '/usr/bin:/bin',
      TMPDIR: join(workspace, '.trial-tmp'),
    },
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 10_000,
  },
)

if (execution.exitCode !== 0) {
  throw new Error(`assembled DSH process exited ${execution.exitCode}: ${execution.stderr.trim()}`)
}

const records = execution.stdout.trim().split('\n').map(line => JSON.parse(line))
const events = records.flatMap(record => record.type === 'session_event' ? [record.event] : [])
const result = records.findLast(record => record.type === 'result')
const invocation = events.find(event => event.type === 'user/message'
  && event.data?.source?.kind === 'skill-invocation'
  && event.data.source.name === 'browser-e2e-baseline')
const invocationText = invocation?.data?.content
  ?.filter(block => block.type === 'text')
  .map(block => block.text)
  .join('') ?? ''
const requestHeaders = events
  .filter(event => event.type === 'request/header')
  .map(event => event.data.header)
const serializedHeaders = JSON.stringify(requestHeaders)
const firstRequestIndex = events.findIndex(event => event.type === 'request/header')
const firstRequestEvents = firstRequestIndex === -1 ? [] : events.slice(0, firstRequestIndex + 1)
const normalizedComposition = firstRequestEvents.flatMap(event => {
  if (event.type === 'request/header') {
    return [{ type: event.type, header: event.data.header }]
  }
  if (event.type === 'user/message') {
    if (event.data?.source?.kind === 'skill-invocation') {
      return [{
        type: event.type,
        source: event.data.source,
        content: '<ALLOWED_SKILL_BODY>',
      }]
    }
    return [{ type: event.type, source: event.data?.source, content: event.data?.content }]
  }
  if (event.type === 'assistant/message') {
    return [{ type: event.type, content: event.data?.message?.content }]
  }
  if (event.type === 'tool/result') {
    return [{ type: event.type, content: event.data?.message?.content }]
  }
  return []
})
const toolRoundTrip = events.some(event => event.type === 'tool/result'
  && JSON.stringify(event).includes('CLI_TOOL_ROUND_TRIP'))
const requiredGuidance = invocationText.includes('verify the real flow in a controlled browser')
const checks = [
  { name: 'real-loader-agent-turn', passed: result?.type === 'result' },
  { name: 'skill-on-demand-injected', passed: invocationText.includes('# Develop a DSH Plugin') },
  { name: 'real-tool-round-trip', passed: toolRoundTrip },
  { name: 'guidance-reaches-model-history', passed: requiredGuidance },
  {
    name: 'skill-body-outside-request-prefix',
    passed: !serializedHeaders.includes(skillSource.trim())
      && !serializedHeaders.includes('# Develop a DSH Plugin')
      && !serializedHeaders.includes('verify the real flow in a controlled browser'),
  },
]

process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  passed: checks.every(check => check.passed),
  checks,
  composition: {
    fingerprint: createHash('sha256').update(JSON.stringify(normalizedComposition)).digest('hex'),
    modelCalls: requestHeaders.length,
    usage: result?.usage ?? {},
  },
}))

function runBounded(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      env: options.env,
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
        reject(new Error('assembled DSH process exceeded output budget'))
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
