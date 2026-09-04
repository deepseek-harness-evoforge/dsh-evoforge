import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const outputPath = resolve(args.out ?? resolve(repositoryRoot, '.tmp/gateway-browser.patch.yml'))
const workspacePath = args.workspace ?? resolve('/tmp', 'evoforge-gateway-browser-workspace')
const sessionId = args.session ?? 'evoforge-gateway-browser-session'

const gatewayFixture = resolve(repositoryRoot, 'packages/dsh-gateway/test/fixtures/browser-gateway-bootstrap.mjs')
const controlFixture = resolve(repositoryRoot, 'packages/dsh-control-center/test/fixtures/browser-doctor-bootstrap.mjs')
const shimDir = await mkdtemp(join(tmpdir(), 'evoforge-browser-bootstrap-'))
const gatewayShim = join(shimDir, 'gateway-bootstrap.mjs')
const controlShim = join(shimDir, 'control-bootstrap.mjs')
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(gatewayShim, `export { name, inject, apply } from ${JSON.stringify(pathToFileURL(gatewayFixture).href)}\n`, 'utf8')
await writeFile(controlShim, `export { name, inject, apply } from ${JSON.stringify(pathToFileURL(controlFixture).href)}\n`, 'utf8')
await writeFile(outputPath, `- id: evoforge-gateway
  name: dsh-evoforge-gateway
  disabled: false
- insert:
    - id: evoforge-gateway-browser
      name: ${gatewayShim}
    - id: evoforge-control-center-browser-bootstrap
      name: ${controlShim}
      config:
        workspacePath: ${yamlScalar(workspacePath)}
        sessionId: ${yaml(sessionId)}
        agentPreset: standard
`, 'utf8')
process.stdout.write(`${outputPath}\n`)

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--out' || value === '--workspace' || value === '--session') {
      const next = values[index + 1]
      if (next === undefined || next.startsWith('--')) throw new Error(`${value} requires a value`)
      result[value.slice(2)] = next
      index += 1
    } else if (value === '--help') {
      process.stdout.write('Usage: node scripts/create-gateway-browser-overlay.mjs [--out path] [--workspace path] [--session id]\n')
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${value}`)
    }
  }
  return result
}

function yaml(value) {
  return JSON.stringify(value)
}

function yamlScalar(value) {
  return isAbsolute(value) ? `!!js String(${JSON.stringify(value)})` : yaml(value)
}
