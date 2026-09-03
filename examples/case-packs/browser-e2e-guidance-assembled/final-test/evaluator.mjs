import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, realpath } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'

const evaluatorArgs = process.argv.slice(2)
const [candidateInput, dshInput] = evaluatorArgs
if (candidateInput === undefined || dshInput === undefined) {
  throw new Error('assembled evaluator requires <candidate-dir> <dsh-source-dir>')
}

const subjectKind = flagValue(evaluatorArgs, '--dsh-evolve-subject-kind') ?? 'skill-tree'
const targetSkillName = flagValue(evaluatorArgs, '--dsh-evolve-skill-name') ?? 'browser-e2e-baseline'
if (!['skill-tree', 'capability-absent'].includes(subjectKind)) {
  throw new Error(`unsupported Trial subject kind '${subjectKind}'`)
}

const candidateDir = await realpath(candidateInput)
const dshDir = await realpath(dshInput)
const workspace = dirname(candidateDir)
const skillPresent = subjectKind === 'skill-tree'
const skillSource = skillPresent
  ? await readFile(join(candidateDir, 'SKILL.md'), 'utf8')
  : ''
if (skillPresent) {
  const skillHome = join(workspace, '.agents-home', 'skills', targetSkillName)
  await mkdir(skillHome, { recursive: true })
  await cp(join(candidateDir, 'SKILL.md'), join(skillHome, 'SKILL.md'))
}

// DSH alpha.5 moved the keyless headless driver and overlay into the
// test-support/profile tree. Keep the evaluator on the official test fixture
// instead of reviving the removed examples/headless-agent path.
const driver = join(dshDir, 'packages', 'test-support', 'loader-smoke', 'tests', 'fixtures', 'headless-driver.ts')
const config = join(dshDir, 'apps', 'cli', 'tests', 'profiles', 'headless', 'tests', 'fixtures', 'cli.patch.yml')
const execution = await runBounded(
  process.execPath,
  [driver, config, `/${targetSkillName}`, 'verify', 'the', 'real', 'GUI', 'flow'],
  {
    cwd: workspace,
    env: {
      DSH_AGENTS_HOME: join(workspace, '.agents-home'),
      DSH_HOME: join(workspace, '.dsh-home'),
      DSH_TELEMETRY_DISABLED: '1',
      // The outer Evolution Trial is the deny-by-default Seatbelt boundary.
      // macOS refuses nested sandbox-exec, so this assembled composition test
      // bypasses only DSH's inner sandbox while retaining the outer boundary;
      // DSH's own sandbox backend suite remains the security gate.
      DSH_PERMISSION_MODE: 'danger-full-access',
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
  && event.data.source.name === targetSkillName)
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
    return [{ type: event.type, header: normalizeCompositionValue(event.data.header, workspace) }]
  }
  if (event.type === 'user/message') {
    if (event.data?.source?.kind === 'skill-invocation'
      && event.data.source.name === targetSkillName) {
      return []
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
  { name: 'target-skill-present', passed: skillPresent && invocation !== undefined },
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

function flagValue(args, name) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`missing value for ${name}`)
  }
  return value
}

// Each Trial gets a fresh temporary root. DSH correctly includes the current
// working directory in its system prompt, but that host path is not a
// capability or behavior difference and must not make paired composition
// fingerprints diverge.
function normalizeCompositionValue(value, ephemeralRoot) {
  return JSON.parse(JSON.stringify(value).split(ephemeralRoot).join('<trial-workspace>'))
}

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
