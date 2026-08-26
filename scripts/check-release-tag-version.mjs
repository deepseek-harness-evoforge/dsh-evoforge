import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * Check that a release tag names exactly the version shipped by every public
 * Bundle. A tag is the immutable public identity of a release; allowing a
 * tag/package mismatch makes a registry publish impossible to reproduce.
 */
export function validateReleaseTag(tag, versions) {
  const errors = []
  if (typeof tag !== 'string' || tag.length === 0) {
    errors.push('a release tag is required')
    return errors
  }
  if (!/^dsh-v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/u.test(tag)) {
    errors.push(`invalid EvoForge release tag: ${tag}`)
  }
  const uniqueVersions = [...new Set(versions)]
  if (uniqueVersions.length !== 1) {
    errors.push(`all packages must share one version; found ${uniqueVersions.join(', ') || '(none)'}`)
  } else {
    const expected = `dsh-v${uniqueVersions[0]}`
    if (tag !== expected) errors.push(`tag ${tag} does not match package version ${uniqueVersions[0]} (expected ${expected})`)
  }
  return errors
}

if (isMainModule()) {
  const tag = parseTag(process.argv.slice(2)) ?? process.env.GITHUB_REF_NAME
  const packageVersions = await readPackageVersions()
  const errors = validateReleaseTag(tag, packageVersions)
  if (errors.length > 0) throw new Error(errors.join('\n'))
  console.log(`Release tag ${tag} matches ${packageVersions.length} package versions.`)
}

async function readPackageVersions() {
  const packageRoot = join(repositoryRoot, 'packages')
  const entries = await readdir(packageRoot, { withFileTypes: true })
  const packageNames = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  return Promise.all(packageNames.map(async name => {
    const manifest = JSON.parse(await readFile(join(packageRoot, name, 'package.json'), 'utf8'))
    return manifest.version
  }))
}

function parseTag(values) {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--tag') return values[++index]
    if (value === '--help' || value === '-h') {
      console.log('Usage: node scripts/check-release-tag-version.mjs --tag dsh-v0.1.0-alpha.1')
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${value}`)
  }
  return undefined
}

function isMainModule() {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
}
