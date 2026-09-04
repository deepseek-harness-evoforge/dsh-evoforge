import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

/**
 * Keep the known upstream boundary explicit. A clean latest DSH checkout that
 * fails for another reason must not be downgraded to a supported baseline.
 */
export function classifyBuildFailure(output) {
  if (typeof output !== 'string' || output.trim() === '') return 'unknown'
  if (/Cannot find entry:\s*\["lib\/types\/\{index,invariant,startup\}\.js"\]/u.test(output)) {
    return 'blocked-upstream-root-types-entry'
  }
  return 'unknown'
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: pnpm run audit:dsh:latest -- --source /absolute/path/to/deepseek-harness [--json] [--offline] [--skip-build]')
    return
  }
  if (args.source === undefined) {
    throw new Error('DSH latest audit requires --source /absolute/path/to/deepseek-harness')
  }

  const source = realpathSync(args.source)
  const fetch = runGit(source, ['fetch', 'origin', '--tags', '--prune'])
  if (fetch.status !== 0) throw new Error(`DSH latest audit could not fetch origin: ${fetch.output}`)

  const revision = git(source, ['rev-parse', 'HEAD'])
  const originMaster = git(source, ['rev-parse', 'origin/master'])
  const dirty = git(source, ['status', '--porcelain'])
  const manifest = JSON.parse(readFileSync(join(source, 'apps', 'cli', 'package.json'), 'utf8'))
  const result = {
    schemaVersion: 1,
    source,
    revision,
    originMaster,
    version: manifest.version,
    clean: dirty === '',
    headMatchesOriginMaster: revision === originMaster,
    install: null,
    build: null,
  }

  if (!result.clean || !result.headMatchesOriginMaster) {
    result.blocked = 'dirty-or-not-at-origin-master'
    finish(result, 1, args.json)
  }

  const installArgs = ['install', '--frozen-lockfile', '--ignore-scripts']
  if (args.offline) installArgs.push('--offline')
  const install = runPnpm(source, installArgs)
  result.install = { status: install.status, output: install.output }
  if (install.status !== 0) {
    result.blocked = 'dependency-install-failed'
    finish(result, 1, args.json)
  }

  if (args.skipBuild) {
    result.build = { status: null, classification: 'not-run', output: '' }
    finish(result, 0, args.json)
  }

  const build = runPnpm(source, ['build'])
  const classification = build.status === 0 ? 'passed' : classifyBuildFailure(build.output)
  result.build = { status: build.status, classification, output: build.output }
  if (build.status === 0) finish(result, 0, args.json)
  if (classification === 'blocked-upstream-root-types-entry') {
    result.blocked = 'known-upstream-build-defect'
    finish(result, 2, args.json)
  }
  result.blocked = 'unknown-build-failure'
  finish(result, 1, args.json)
}

function finish(value, status, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  } else {
    process.stdout.write(`DSH latest audit: ${value.blocked ?? (value.build?.classification ?? 'passed')}\n`)
    process.stdout.write(`- revision: ${value.revision}\n- origin/master: ${value.originMaster}\n- version: ${value.version}\n`)
    if (value.install !== null) process.stdout.write(`- install: ${value.install.status === 0 ? 'passed' : 'failed'}\n`)
    if (value.build !== null) process.stdout.write(`- build: ${value.build.classification}\n`)
  }
  process.exit(status)
}

function runPnpm(cwd, commandArgs) {
  const result = spawnSync('pnpm', commandArgs, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function runGit(cwd, commandArgs) {
  const result = spawnSync('git', commandArgs, { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function git(cwd, commandArgs) {
  return execFileSync('git', commandArgs, { cwd, encoding: 'utf8' }).trim()
}

function parseArgs(values) {
  const result = { help: false, json: false, offline: false, skipBuild: false }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--') continue
    if (value === '--source') result.source = values[++index]
    else if (value === '--json') result.json = true
    else if (value === '--offline') result.offline = true
    else if (value === '--skip-build') result.skipBuild = true
    else if (value === '--help' || value === '-h') result.help = true
    else throw new Error(`Unknown option ${value}`)
  }
  return result
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
