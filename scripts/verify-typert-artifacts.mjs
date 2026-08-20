import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const workspace = resolve(import.meta.dirname, '..')
const output = join(workspace, 'packages/dsh-evolve/lib')
const expectedMethods = [
  'approveExistingSkill',
  'approveReview',
  'overview',
  'pause',
  'promote',
  'promoteExistingSkill',
  'rejectExistingSkill',
  'rejectReview',
  'resume',
  'review',
  'rollback',
]

const recorded = (await readFile(join(output, 'typert.source.sha256'), 'utf8')).trim()
const actual = await sourceDigest()
if (recorded !== actual) {
  throw new Error('generated Typert artifacts are stale; regenerate with pinned DSH_SOURCE_ROOT')
}

const host = await import(pathToFileURL(join(output, 'typert.host.js')).href)
const remote = await import(pathToFileURL(join(output, 'typert.remote-client.js')).href)
const hostManifest = host.TYPERT
const remoteManifest = remote.TYPERT_REMOTE
if (hostManifest?.package !== 'dsh-evolve' || hostManifest.face !== 'host') {
  throw new Error('invalid dsh-evolve Host Typert manifest')
}
if (remoteManifest?.package !== 'dsh-evolve') {
  throw new Error('invalid dsh-evolve Client Remote contribution')
}
const hostMethods = methods(hostManifest.invocations)
const remoteMethods = methods(remoteManifest.descriptors)
if (JSON.stringify(hostMethods) !== JSON.stringify(expectedMethods)
  || JSON.stringify(remoteMethods) !== JSON.stringify(expectedMethods)) {
  throw new Error(`unexpected evoforgeEvolution Remote methods: ${JSON.stringify({ hostMethods, remoteMethods })}`)
}
const expectedParameters = {
  approveExistingSkill: ['workspaceId', 'candidateId', 'note'],
  approveReview: ['workspaceId', 'id', 'note'],
  overview: ['workspaceId', 'sessionId'],
  pause: ['workspaceId'],
  promote: ['workspaceId', 'generationId'],
  promoteExistingSkill: ['workspaceId', 'candidateId'],
  rejectExistingSkill: ['workspaceId', 'candidateId', 'note'],
  rejectReview: ['workspaceId', 'id', 'note'],
  resume: ['workspaceId'],
  review: ['workspaceId', 'id'],
  rollback: ['workspaceId', 'canaryId'],
}
const actualParameters = Object.fromEntries(
  remoteManifest.descriptors
    .filter(row => row?.namespace === 'evoforgeEvolution')
    .map(row => [row.method, row.parameters.map(parameter => parameter.wire)]),
)
if (JSON.stringify(actualParameters) !== JSON.stringify(expectedParameters)) {
  throw new Error(`unexpected evoforgeEvolution Remote parameters: ${JSON.stringify(actualParameters)}`)
}

function methods(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .filter(row => row?.namespace === 'evoforgeEvolution')
    .map(row => row.method)
    .sort()
}

async function sourceDigest() {
  const sources = [
    'packages/dsh-evolve/src/candidate-impact.ts',
    'packages/dsh-evolve/src/control-types.ts',
    'packages/dsh-evolve/src/delivery-outcome-monitor.ts',
    'packages/dsh-evolve/src/evolution-remote.ts',
    'packages/dsh-evolve/src/evolution-remote.typert.ts',
    'packages/dsh-evolve/typert-generator-compat.d.ts',
    'packages/dsh-evolve/tsconfig.typert.json',
  ]
  const hash = createHash('sha256')
  for (const source of sources) {
    hash.update(source).update('\0').update(await readFile(join(workspace, source))).update('\0')
  }
  return hash.digest('hex')
}
