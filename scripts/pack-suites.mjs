import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SUITE_ID, getSuite, getSuiteAudience, getSuitePackages } from './suite-manifest.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = parseArgs(process.argv.slice(2))
const selected = getSuite(args.suite ?? DEFAULT_SUITE_ID)
const packageNames = getSuitePackages(selected.id, args.channel)
const outputId = args.channel === undefined ? selected.id : `${selected.id}-${args.channel}`
const output = resolve(args.out ?? '.evoforge/pack', outputId)
await mkdir(output, { recursive: true })

for (const packageName of packageNames) {
  const result = spawnSync('pnpm', ['--filter', packageName, 'pack', '--pack-destination', output], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const packages = []
for (const packageName of packageNames) {
  const manifest = JSON.parse(await readFile(join(repositoryRoot, 'packages', packageName, 'package.json'), 'utf8'))
  const filename = `${packageName.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`
  const path = join(output, filename)
  if (!existsSync(path)) throw new Error(`pnpm pack did not produce ${path}`)
  const digest = createHash('sha256').update(await readFile(path)).digest('hex')
  packages.push({ name: packageName, version: manifest.version, filename, sha256: digest })
}

const suiteManifest = {
  schemaVersion: 1,
  suite: selected.id,
  audience: getSuiteAudience(selected.id),
  label: selected.label,
  description: selected.description,
  packages,
  ...(args.channel === undefined ? {} : { channel: args.channel }),
  notes: selected.notes,
  dshInstall: `dsh plugin --profile <profile> add ${packages.map(item => item.filename).join(' ')}`,
  dshRemove: `dsh plugin --profile <profile> remove ${packages.map(item => item.name).join(' ')}`,
}
await writeFile(join(output, 'evoforge-suite.json'), `${JSON.stringify(suiteManifest, null, 2)}\n`)
console.log(`Packed ${selected.id}${args.channel === undefined ? '' : `/${args.channel}`} suite (${packages.length} packages) into ${output}`)

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--') continue
    if (value === '--suite') result.suite = values[++index]
    else if (value === '--channel') result.channel = values[++index]
    else if (value === '--out') result.out = values[++index]
    else if (value === '--help' || value === '-h') {
      console.log(`Usage: node scripts/pack-suites.mjs [--suite <name>] [--channel <feishu|telegram>] --out <directory> (default: ${DEFAULT_SUITE_ID})

User-facing suites: core, channels, delivery, continuity
Optional add-on: attention
Compatibility/advanced: evolution, control, gateway
Maintainer-only: full`)
      process.exit(0)
    } else throw new Error(`Unknown argument: ${value}`)
  }
  return result
}
