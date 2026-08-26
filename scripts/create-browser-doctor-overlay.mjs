import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixturePath = resolve(repositoryRoot, 'packages/dsh-control-center/test/fixtures/browser-doctor-bootstrap.mjs')
const args = parseArgs(process.argv.slice(2))
const outputPath = resolve(args.out ?? resolve(repositoryRoot, '.tmp/browser-doctor.patch.yml'))
const workspacePath = args.workspace ?? resolve('/tmp', 'evoforge-browser-workspace')
const sessionId = args.session ?? 'evoforge-control-center-browser-session'

await mkdir(dirname(outputPath), { recursive: true })
const patch = `- insert:\n    - id: evoforge-control-center-browser-bootstrap\n      name: ${fixturePath}\n      config:\n        workspacePath: ${yamlScalar(workspacePath)}\n        sessionId: ${yamlScalar(sessionId)}\n        agentPreset: standard\n`
await writeFile(outputPath, patch, 'utf8')
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
      process.stdout.write('Usage: node scripts/create-browser-doctor-overlay.mjs [--out path] [--workspace path] [--session id]\n')
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${value}`)
    }
  }
  return result
}

function yamlScalar(value) {
  if (isAbsolute(value)) return `!!js String(${JSON.stringify(value)})`
  return JSON.stringify(value)
}
