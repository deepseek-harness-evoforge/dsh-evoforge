import { access, readFile } from 'node:fs/promises'
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

const packageErrors = []
const repositoryUrl = 'git+https://github.com/deepseek-harness-evoforge/dsh-evoforge.git'
for (const manifest of manifests) {
  const packageDir = join(packageRoot, manifest.name)
  if (manifest.private === true) packageErrors.push(`${manifest.name} must be publishable (private must be false or omitted)`)
  if (manifest.license !== 'MIT') packageErrors.push(`${manifest.name} must declare the MIT license`)
  if (manifest.repository?.url !== repositoryUrl) packageErrors.push(`${manifest.name} has an unexpected repository URL`)
  if (!Array.isArray(manifest.files) || !manifest.files.includes('cordis.patch.yml')) {
    packageErrors.push(`${manifest.name} must include cordis.patch.yml in files`)
  }
  if (manifest.exports?.['./cordis.patch.yml'] !== './cordis.patch.yml') {
    packageErrors.push(`${manifest.name} must export ./cordis.patch.yml`)
  }
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
    packageErrors.push(`${manifest.name} must declare dsh.bundle.patch as ./cordis.patch.yml`)
  }
  for (const requiredFile of ['README.md', 'cordis.patch.yml']) {
    try {
      await access(join(packageDir, requiredFile))
    } catch {
      packageErrors.push(`${manifest.name} is missing ${requiredFile}`)
    }
  }
}
if (packageErrors.length > 0) throw new Error(`Invalid public package metadata:\n${packageErrors.join('\n')}`)

const suiteErrors = validateSuiteManifest()
if (suiteErrors.length > 0) throw new Error(`Invalid capability suite manifest:\n${suiteErrors.join('\n')}`)

const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8')
if (!/^## Unreleased\s*$/m.test(changelog)) throw new Error('CHANGELOG.md must contain an Unreleased section')

console.log(`Release preflight passed for ${manifests.length} packages at ${[...versions][0]}`)
console.log('Next required evidence remains the DSH clean-profile install/boot/reload/dispose/remove gate, browser recovery, real channel checks, and paired Hermes benchmark.')
