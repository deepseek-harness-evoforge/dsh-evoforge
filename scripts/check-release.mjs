import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSuiteManifest } from './suite-manifest.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = new Set(process.argv.slice(2))

if (!args.has('--allow-dirty')) {
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  if (status.status !== 0) throw new Error('Unable to inspect git status')
  if (status.stdout.trim() !== '') throw new Error('Release check requires a clean git worktree (use --allow-dirty only for local rehearsal)')
}

const packageRoot = join(root, 'packages')
const packageDirs = (await readdir(packageRoot, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()
const manifests = await Promise.all(packageDirs.map(async name => JSON.parse(await readFile(join(packageRoot, name, 'package.json'), 'utf8'))))
const versions = new Set(manifests.map(manifest => manifest.version))
if (versions.size !== 1) throw new Error(`All plugin packages must share one version; found ${[...versions].join(', ')}`)

const suiteErrors = validateSuiteManifest()
if (suiteErrors.length > 0) throw new Error(`Invalid capability suite manifest:\n${suiteErrors.join('\n')}`)

const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8')
if (!/^## Unreleased\s*$/m.test(changelog)) throw new Error('CHANGELOG.md must contain an Unreleased section')

console.log(`Release preflight passed for ${manifests.length} packages at ${[...versions][0]}`)
console.log('Next required evidence remains the DSH clean-profile install/boot/reload/dispose/remove gate, browser recovery, real channel checks, and paired Hermes benchmark.')
