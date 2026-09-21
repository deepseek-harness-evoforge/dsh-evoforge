import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateFileWorkflow, checkFileWorkflowAnswer, FILE_WORKFLOW_ROOT_TOKEN } from '../../../packages/dsh-evolve/src/conversation-file-workflow.ts'
import { digest } from '../../../packages/dsh-evolve/src/conversation-correction-intake.ts'
import { inspectFileOperations } from './observation.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const cwd = '/Users/my/harness'
const dsh = '/Users/my/.local/share/evoforge/dsh-0.1.6-alpha.1-0d1f500'
const hermes = '/Users/my/harness/hermes-agent'
const dshHome = '/Users/my/.dsh'
const sha = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'))
const writeJson = (p: string, value: unknown) => fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
const draftId = '3774035d821f956b244e72da0a37480dd93b0ae26996ace6cd65d807e2ce391f'
const trialId = 'a72123b8c8971a444634f4d5bfa04ba8a7c4e2c6c96af1f32ca0e9d6a2778629'
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: hermes, encoding: 'utf8' }).trim(), '29d0cc2602e01943ab300c0382fc9d97efb376da')
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: hermes, encoding: 'utf8' }).trim(), '')
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dsh, encoding: 'utf8' }).trim(), '0d1f50007f9bca3f52b06e1c3074fa14d5fb0720')
const draft = readJson(`${dshHome}/storages/evoforge_conversation_skill_drafts.json`).tables.records[draftId]
const trial = readJson(`${dshHome}/storages/evoforge_conversation_draft_trials.json`).tables.records[trialId]
assert.equal(trial.phase, 'completed')
assert.equal(trial.comparison.outcome, 'no-improvement')
const plan = validateFileWorkflow(draft.fileWorkflow)
assert.equal(digest(plan), 'c4e8084fa5474c79d997b6642fc2e3ad8f628a36885c80e26c2720de5f9baf43')
const root = fs.mkdtempSync(`${cwd}/.evoforge/hermes-fw1-20260922.`)
fs.chmodSync(root, 0o700)
writeJson(path.join(root, 'manifest.json'), { protocol: 'fw1-common-files-v1', draftId, trialId,
  planHash: digest(plan), recipe: trial.fileEvaluation, cases: plan.cases.map(test => ({ id: test.id,
    inputDigest: digest(test.input), files: test.files.map(file => ({ path: file.path, hash: sha(file.content) })) })),
  maxCalls: 12, maxOutputTokens: 4000, deadlineMs: 600000,
  deliveryDelta: 'Hermes final response path replaces DSH present; common file facts scored separately' })
console.log(JSON.stringify({ root, phase: 'prepared', modelRequests: 0 }))

const requireDsh = createRequire(`${dsh}/packages/credentials/credentials-local/package.json`)
const { parse } = requireDsh('yaml')
const provider = parse(fs.readFileSync(`${dshHome}/settings.yaml`, 'utf8'))['llm-pi-ai'].providers.gpt
assert.equal(provider.api, 'openai-completions')
assert.equal(provider.apiKeyEnv, 'GPT_API_KEY')
const { Context } = await import(pathToFileURL(`${dsh}/vendor/cordis/lib/index.js`).href)
const { default: CredentialProvider } = await import(pathToFileURL(`${dsh}/packages/credentials/credentials-local/lib/index.js`).href)
const { credentialRef } = await import(pathToFileURL(`${dsh}/packages/credentials/credentials/lib/index.js`).href)
const credentialHash = sha(fs.readFileSync(`${dshHome}/.credentials.yaml`))
const ctx = new Context()
const fiber = ctx.plugin(CredentialProvider, { dshHome, watch: false })
await fiber
let connection: { model: string; baseURL: string; apiKey: string }
try {
  const credential = await ctx.credentials.resolve(credentialRef(provider.apiKeyEnv))
  assert.ok(credential?.value)
  connection = { model: 'gpt-5.6-sol', baseURL: provider.baseURL, apiKey: credential.value }
} finally { await ctx.fiber.dispose() }
assert.equal(sha(fs.readFileSync(`${dshHome}/.credentials.yaml`)), credentialHash)

const rows: unknown[] = []
for (const test of plan.cases) {
  const caseDir = path.join(root, test.id), work = path.join(caseDir, 'work')
  fs.mkdirSync(caseDir, { mode: 0o700 }); fs.mkdirSync(work, { mode: 0o700 })
  for (const file of test.files) fs.writeFileSync(path.join(work, file.path), file.content, { flag: 'wx', mode: 0o600 })
  const prompt = test.input.replaceAll(FILE_WORKFLOW_ROOT_TOKEN, path.relative(cwd, work))
    .replace('再用 present 交付该文件', '在最终回复中用相对路径指向该文件')
  assert.ok(!prompt.includes('present'))
  const payload = { hermesRepo: hermes, root: work, cwd, caseId: test.id, sessionId: `fw1-${path.basename(root)}-${test.id}`,
    prompt, inputs: test.files.map(file => file.path) }
  const payloadPath = path.join(caseDir, 'payload.json')
  writeJson(payloadPath, payload)
  const logFd = fs.openSync(path.join(caseDir, 'runner.log'), 'wx', 0o600)
  const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]!]))
  const child = spawn(`${hermes}/.venv/bin/python`, [path.join(here, 'hermes-file-workflow.py'), payloadPath], {
    cwd, env: { ...env, HERMES_HOME: path.join(caseDir, 'profile'), PYTHONUNBUFFERED: '1' },
    stdio: ['pipe', logFd, logFd], detached: true,
  })
  fs.closeSync(logFd)
  child.stdin!.end(JSON.stringify(connection))
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, 'SIGTERM') } catch {} }, 600000)
  const killed = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL') } catch {} }, 605000)
  const status = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }))
  }).finally(() => { clearTimeout(timer); clearTimeout(killed) })
  const native = fs.existsSync(path.join(caseDir, 'native-result.json')) ? readJson(path.join(caseDir, 'native-result.json')) : undefined
  const eventsPath = path.join(caseDir, 'events.jsonl')
  const events = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
  const resultPath = path.join(work, 'result.json')
  const output = fs.existsSync(resultPath) && !fs.lstatSync(resultPath).isSymbolicLink() ? fs.readFileSync(resultPath, 'utf8') : undefined
  const operations = inspectFileOperations(events, { cwd, root: work, inputs: test.files, output })
  const facts = checkFileWorkflowAnswer(test, output)
  const inputsUnchanged = test.files.every(file => fs.readFileSync(path.join(work, file.path), 'utf8') === file.content)
  const completed = native?.completed === true && native?.failed === false && status.code === 0 && !timedOut
  const starts = events.filter(e => e.kind === 'api-start')
  const result = { caseId: test.id, status, timedOut, completed, facts, operations, inputsUnchanged,
    output, outputHash: output === undefined ? null : sha(output), pathReferenced: native?.final_response?.includes('result.json') === true,
    actualApiRequests: starts.length, nativeApiCalls: native?.api_calls,
    usage: events.filter(e => e.kind === 'api-result').map(e => e.usage), elapsedMs: native?.elapsedMs,
    passed: completed && facts.passed && operations.complete && inputsUnchanged && starts.length > 0 && starts.length <= 12 }
  writeJson(path.join(caseDir, 'evaluation.json'), result)
  rows.push(result)
  console.log(JSON.stringify({ caseId: test.id, completed, passed: result.passed, requests: starts.length, elapsedMs: native?.elapsedMs }))
}
connection.apiKey = ''
assert.equal(sha(fs.readFileSync(`${dshHome}/.credentials.yaml`)), credentialHash)
writeJson(path.join(root, 'comparison.json'), { protocol: 'fw1-common-files-v1', dsh: trial.comparison, hermes: rows })
console.log(JSON.stringify({ root, phase: 'completed', cases: rows.length }))
