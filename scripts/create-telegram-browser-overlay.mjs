import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const outputPath = resolve(args.out ?? resolve(repositoryRoot, '.tmp/telegram-browser.patch.yml'))
const workspaceId = required(args, 'workspace-id')
const workspacePath = args.workspace ?? '/private/tmp/evoforge-telegram-browser-workspace'
const sessionId = args.session ?? 'evoforge-telegram-browser-session'
const apiBase = args['api-base'] ?? 'http://127.0.0.1:41235'
const fixturePath = resolve(repositoryRoot, 'packages/dsh-control-center/test/fixtures/browser-doctor-bootstrap.mjs')

await mkdir(dirname(outputPath), { recursive: true })
// Keep the absolute test entry outside the control-center package root. DSH's
// client-module resolver uses the nearest package.json as source identity and
// would otherwise treat this fixture as a second dsh-control-center client.
const shimDir = await mkdtemp(join(tmpdir(), 'evoforge-browser-bootstrap-'))
const shimPath = join(shimDir, 'bootstrap.mjs')
await writeFile(shimPath, `export { name, inject, apply } from ${JSON.stringify(pathToFileURL(fixturePath).href)}\n`, 'utf8')
await writeFile(outputPath, `- id: evoforge-gateway
  name: dsh-gateway
  disabled: false
  config:
    routes:
      - id: telegram-browser
        adapter: telegram
        accountId: telegram-browser-account
        conversationId: '1001'
        userId: '2002'
        workspaceId: ${yaml(workspaceId)}
        sessionId: ${yaml(sessionId)}
        agentPreset: standard
        provider: deepseek-official
        model: deepseek-v4-flash

- id: evoforge-telegram
  name: dsh-telegram
  disabled: false
  config:
    routeId: telegram-browser
    tokenEnv: DSH_TELEGRAM_BROWSER_TOKEN
    apiBase: ${yaml(apiBase)}
    pollTimeoutSeconds: 1

- insert:
    - id: evoforge-telegram-browser-workspace
      name: ${shimPath}
      config:
        workspacePath: !!js String(${JSON.stringify(workspacePath)})
        sessionId: ${yaml(sessionId)}
        agentPreset: standard
`, 'utf8')
process.stdout.write(`${outputPath}\n`)

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--out' || value === '--workspace-id' || value === '--workspace' || value === '--session' || value === '--api-base') {
      const next = values[index + 1]
      if (next === undefined || next.startsWith('--')) throw new Error(`${value} requires a value`)
      result[value.slice(2)] = next
      index += 1
    } else if (value === '--help') {
      process.stdout.write('Usage: node scripts/create-telegram-browser-overlay.mjs --workspace-id <id> [--out path] [--workspace path] [--session id] [--api-base url]\n')
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${value}`)
    }
  }
  return result
}

function required(values, key) {
  const value = values[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`--${key} is required`)
  return value
}

function yaml(value) {
  return JSON.stringify(value)
}
