import { readdir, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const expectedRepositoryUrl = 'git+https://github.com/deepseek-harness-evoforge/dsh-evoforge.git'

/**
 * Classify one `npm view --json` result without making tests depend on the
 * network. A package with a different (or missing) repository is a collision;
 * an unavailable package name is publishable in principle. Unknown registry
 * failures remain blocking so a release cannot publish on incomplete evidence.
 */
export function classifyRegistryResult({ status, stdout = '', stderr = '' }, expectedUrl = expectedRepositoryUrl) {
  const combined = `${stdout}\n${stderr}`
  if (status === 0) {
    let metadata
    try {
      metadata = JSON.parse(stdout)
    } catch {
      return { state: 'unknown', reason: 'npm returned invalid JSON' }
    }
    if (metadata === null || metadata === undefined) return { state: 'available' }
    const repository = typeof metadata.repository === 'string'
      ? metadata.repository
      : metadata.repository?.url
    if (sameRepository(repository, expectedUrl)) {
      return { state: 'owned', version: metadata.version ?? null, repository }
    }
    return {
      state: 'collision',
      version: metadata.version ?? null,
      repository: repository ?? null,
    }
  }

  // npm uses E404 for an unregistered package. Do not classify auth, timeout,
  // registry, or malformed-response errors as availability.
  if (/\bE404\b|\b404\b|not found/iu.test(combined)) return { state: 'available' }
  const detail = combined.trim().replace(/\s+/gu, ' ').slice(0, 240)
  return { state: 'unknown', reason: detail || `npm exited with status ${status}` }
}

/**
 * npm may normalize a GitHub repository field differently from package.json
 * (git+https, https, or scp-style SSH; optional .git/trailing slash). Compare
 * only the canonical GitHub owner/repository path so an equivalent URL is
 * owned, while a different host or path remains a collision.
 */
export function sameRepository(actual, expected) {
  const normalize = value => {
    if (typeof value !== 'string') return null
    let text = value.trim()
    if (text.startsWith('git+')) text = text.slice(4)
    if (/^git@github\.com:/iu.test(text)) text = `https://github.com/${text.slice('git@github.com:'.length)}`
    try {
      const url = new URL(text)
      if (url.hostname.toLowerCase() !== 'github.com') return null
      return url.pathname.replace(/^\/+|\/+$/gu, '').replace(/\.git$/iu, '').toLowerCase()
    } catch {
      return null
    }
  }
  const left = normalize(actual)
  const right = normalize(expected)
  return left !== null && right !== null && left === right
}

async function readPackageManifests() {
  const packageRoot = join(repositoryRoot, 'packages')
  const entries = await readdir(packageRoot, { withFileTypes: true })
  const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  return Promise.all(dirs.map(async dir => ({
    dir,
    manifest: JSON.parse(await readFile(join(packageRoot, dir, 'package.json'), 'utf8')),
  })))
}

function inspectPackage(name) {
  return spawnSync('npm', ['view', name, '--json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })
}

async function main() {
  const json = process.argv.includes('--json')
  const records = []
  for (const { dir, manifest } of await readPackageManifests()) {
    const result = classifyRegistryResult(inspectPackage(manifest.name), manifest.repository?.url ?? expectedRepositoryUrl)
    records.push({ dir, name: manifest.name, ...result })
  }

  const collisions = records.filter(record => record.state === 'collision')
  const unknown = records.filter(record => record.state === 'unknown')
  const result = {
    status: collisions.length === 0 && unknown.length === 0 ? 'passed' : 'blocked',
    packages: records,
    collisions: collisions.map(({ dir, name, version, repository }) => ({ dir, name, version, repository })),
    unknown: unknown.map(({ dir, name, reason }) => ({ dir, name, reason })),
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(`npm package-name preflight: ${result.status.toUpperCase()}\n`)
    for (const record of records) {
      const suffix = record.state === 'collision'
        ? ` (existing ${record.version ?? 'unknown'}; ${record.repository ?? 'repository unknown'})`
        : record.state === 'unknown' ? ` (${record.reason})` : ''
      process.stdout.write(`- ${record.state.padEnd(9)} ${record.name}${suffix}\n`)
    }
  }
  if (result.status !== 'passed') {
    process.stderr.write('Registry names must be reserved under this project namespace before a release tag.\n')
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
