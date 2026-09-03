import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log('Usage: pnpm run release:tag -- --tag dsh-v0.1.0-alpha.1 [--push] [--dry-run]')
  process.exit(0)
}
if (args.tag === undefined) throw new Error('A SemVer tag is required: --tag dsh-v0.1.0-alpha.1')
if (!/^dsh-v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/u.test(args.tag)) {
  throw new Error(`Invalid EvoForge tag: ${args.tag}`)
}

const dirty = git(['status', '--porcelain']).stdout.trim()
if (dirty !== '') throw new Error('Release tag requires a clean worktree')
const branch = git(['branch', '--show-current']).stdout.trim()
if (branch !== 'main') throw new Error(`Release tag must be created on main, got ${branch || '(detached)'}`)
const head = git(['rev-parse', 'HEAD']).stdout.trim()
const originMain = git(['rev-parse', 'refs/remotes/origin/main']).stdout.trim()
if (head !== originMain) throw new Error('Release tag requires HEAD to equal origin/main')

runNode('scripts/check-release-tag-version.mjs', ['--tag', args.tag])
runNode('scripts/check-release.mjs')
runNode('scripts/check-npm-package-names.mjs')
runNode('scripts/check-release-gates.mjs')

const localTag = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${args.tag}`], {
  cwd: repositoryRoot,
  encoding: 'utf8',
})
if (localTag.status === 0) throw new Error(`Tag already exists locally: ${args.tag}`)
const remoteTag = spawnSync('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${args.tag}`], {
  cwd: repositoryRoot,
  encoding: 'utf8',
})
if (remoteTag.status === 0) throw new Error(`Tag already exists on origin: ${args.tag}`)

if (args.dryRun) {
  console.log(`Release tag dry-run passed: ${args.tag} at ${head}`)
  process.exit(0)
}

run('git', ['tag', '--annotate', args.tag, '--message', `EvoForge ${args.tag}`])
console.log(`Created annotated tag ${args.tag} at ${head}`)
if (args.push) {
  run('git', ['push', 'origin', args.tag])
  console.log(`Pushed ${args.tag} to origin`)
}

function runNode(script, scriptArgs = []) {
  run(process.execPath, [resolve(repositoryRoot, script), ...scriptArgs])
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: repositoryRoot, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed with ${result.status ?? 'signal'}`)
}

function git(commandArgs) {
  const result = spawnSync('git', commandArgs, { cwd: repositoryRoot, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${commandArgs.join(' ')} failed: ${result.stderr?.trim() || result.status}`)
  return result
}

function parseArgs(values) {
  const result = { dryRun: false, help: false, push: false }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--') continue
    if (value === '--tag') result.tag = values[++index]
    else if (value === '--push') result.push = true
    else if (value === '--dry-run') result.dryRun = true
    else if (value === '--help' || value === '-h') result.help = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  return result
}
