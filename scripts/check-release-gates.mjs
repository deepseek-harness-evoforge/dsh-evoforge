import { access, readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isAbsolute, relative, resolve } from 'node:path'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const manifestPath = resolve(repositoryRoot, 'release-gates.json')
const allowedStatuses = new Set(['passed', 'partial', 'not-run', 'failed', 'blocked'])

export async function readReleaseGateManifest(path = manifestPath) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export function validateReleaseGateManifest(manifest, root = repositoryRoot) {
  const errors = []
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be an object']
  }
  if (manifest.schemaVersion !== 1) errors.push('manifest schemaVersion must be 1')
  if (typeof manifest.releaseLine !== 'string' || manifest.releaseLine.length === 0) errors.push('manifest releaseLine is required')
  if (manifest.requiredStatus !== 'passed') errors.push('manifest requiredStatus must be passed')
  if (!Array.isArray(manifest.gates) || manifest.gates.length === 0) {
    errors.push('manifest gates must be a non-empty array')
    return errors
  }

  const ids = new Set()
  for (const [index, gate] of manifest.gates.entries()) {
    const prefix = `gates[${index}]`
    if (gate === null || typeof gate !== 'object' || Array.isArray(gate)) {
      errors.push(`${prefix} must be an object`)
      continue
    }
    if (typeof gate.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(gate.id)) errors.push(`${prefix}.id is invalid`)
    if (ids.has(gate.id)) errors.push(`${prefix}.id is duplicated: ${gate.id}`)
    ids.add(gate.id)
    if (typeof gate.title !== 'string' || gate.title.length === 0) errors.push(`${prefix}.title is required`)
    if (typeof gate.requiredForTag !== 'boolean') errors.push(`${prefix}.requiredForTag must be boolean`)
    if (!allowedStatuses.has(gate.status)) errors.push(`${prefix}.status is invalid: ${gate.status}`)
    if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) {
      errors.push(`${prefix}.evidence must be non-empty`)
      continue
    }
    for (const evidence of gate.evidence) {
      if (typeof evidence !== 'string' || evidence.length === 0 || isAbsolute(evidence)) {
        errors.push(`${prefix}.evidence contains an invalid path`)
        continue
      }
      const absolute = resolve(root, evidence)
      const outside = relative(root, absolute).startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
        || isAbsolute(relative(root, absolute))
      if (outside) errors.push(`${prefix}.evidence escapes repository: ${evidence}`)
    }
    if (gate.status !== 'passed' && (typeof gate.blocker !== 'string' || gate.blocker.length === 0)) {
      errors.push(`${prefix}.blocker is required for status ${gate.status}`)
    }
  }
  return errors
}

export function requiredReleaseBlockers(manifest) {
  return manifest.gates
    .filter(gate => gate.requiredForTag && gate.status !== manifest.requiredStatus)
    .map(gate => ({ id: gate.id, title: gate.title, status: gate.status, blocker: gate.blocker ?? 'missing blocker explanation' }))
}

export async function verifyReleaseGateEvidence(manifest, root = repositoryRoot) {
  const missing = []
  for (const gate of manifest.gates) {
    for (const evidence of gate.evidence ?? []) {
      try {
        await access(resolve(root, evidence))
      } catch {
        missing.push(`${gate.id}: ${evidence}`)
      }
    }
  }
  return missing
}

async function main() {
  const manifest = await readReleaseGateManifest()
  const errors = validateReleaseGateManifest(manifest)
  const missing = errors.length === 0 ? await verifyReleaseGateEvidence(manifest) : []
  const blockers = errors.length === 0 && missing.length === 0 ? requiredReleaseBlockers(manifest) : []
  const result = {
    schemaVersion: manifest.schemaVersion,
    releaseLine: manifest.releaseLine,
    status: errors.length > 0 || missing.length > 0 || blockers.length > 0 ? 'blocked' : 'passed',
    errors,
    missingEvidence: missing,
    blockers,
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(`Release gates: ${result.status.toUpperCase()} (${manifest.releaseLine})\n`)
    for (const gate of manifest.gates) {
      process.stdout.write(`- ${gate.status.padEnd(8)} ${gate.id}${gate.requiredForTag ? ' [tag]' : ''}\n`)
    }
    for (const error of errors) process.stderr.write(`ERROR: ${error}\n`)
    for (const item of missing) process.stderr.write(`MISSING EVIDENCE: ${item}\n`)
    for (const blocker of blockers) process.stderr.write(`BLOCKED: ${blocker.id}: ${blocker.blocker}\n`)
  }
  if (result.status !== 'passed') process.exitCode = 1
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
