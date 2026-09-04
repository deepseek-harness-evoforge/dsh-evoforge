import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SUPPORTED_DSH_TARGETS = Object.freeze({
  'db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5': '0.1.2-alpha.5',
})

export function assertSupportedDshTarget({ revision, version, dirty }) {
  const expectedVersion = SUPPORTED_DSH_TARGETS[revision]
  if (expectedVersion === undefined) {
    throw new Error(`unsupported DSH revision ${revision}`)
  }
  if (version !== expectedVersion) {
    throw new Error(`DSH revision ${revision} must report version ${expectedVersion}; received ${version}`)
  }
  if (dirty !== '') {
    throw new Error(`DSH compatibility target has working tree changes:\n${dirty}`)
  }
  return Object.freeze({ revision, version })
}

export function inspectDshTarget(sourceDir) {
  const root = realpathSync(sourceDir)
  const revision = git(root, ['rev-parse', 'HEAD']).trim()
  const dirty = git(root, ['status', '--porcelain']).trim()
  const manifest = JSON.parse(readFileSync(join(root, 'apps', 'cli', 'package.json'), 'utf8'))
  const target = assertSupportedDshTarget({ revision, version: manifest.version, dirty })
  return Object.freeze({ root, ...target })
}

export function runCompatibilityMatrix(sourceDir) {
  const target = inspectDshTarget(sourceDir)
  const env = { ...process.env, DSH_EVOLVE_DSH_SOURCE_DIR: target.root }
  const checks = [
    ['--filter', 'dsh-evoforge-doctor', 'exec', 'vitest', 'run', 'test/suite-native-plugin-contract.test.ts', '--maxWorkers', '1'],
    ['--filter', 'dsh-software-delivery', 'exec', 'vitest', 'run', 'test/clean-profile-suite.e2e.test.ts', 'test/suite-upgrade.e2e.test.ts', '--maxWorkers', '1'],
    ['--filter', 'dsh-evolve', 'exec', 'vitest', 'run', 'test/generation-binder.e2e.test.ts', '--maxWorkers', '1'],
    ['--filter', 'dsh-evoforge-feishu', 'exec', 'vitest', 'run', 'test/dsh-assembled-chat.e2e.test.ts', 'test/dsh-assembled-content.e2e.test.ts', 'test/full-channel-cache-composition.e2e.test.ts', 'test/native-schedule-restart.e2e.test.ts', '--maxWorkers', '1'],
  ]
  process.stdout.write(`DSH compatibility target ${target.version} ${target.revision} at ${target.root}\n`)
  for (const args of checks) {
    const result = spawnSync('pnpm', args, { cwd: workspaceRoot(), env, stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
      throw new Error(`DSH compatibility check failed (${result.status ?? 'signal'}): pnpm ${args.join(' ')}`)
    }
  }
  process.stdout.write(`DSH compatibility matrix passed for ${target.version} ${target.revision}\n`)
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function workspaceRoot() {
  return fileURLToPath(new URL('..', import.meta.url))
}

const invokedPath = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href
if (invokedPath === import.meta.url) {
  const sourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  if (sourceDir === undefined || sourceDir.trim() === '') {
    throw new Error('DSH_EVOLVE_DSH_SOURCE_DIR is required')
  }
  runCompatibilityMatrix(sourceDir)
}
