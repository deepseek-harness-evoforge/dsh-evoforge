import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const workspace = resolve(import.meta.dirname, '..')
const output = join(workspace, 'packages/dsh-gateway/lib')
const recorded = (await readFile(join(output, 'typert.source.sha256'), 'utf8')).trim()
const actual = await sourceDigest()
if (recorded !== actual) {
  throw new Error('generated dsh-gateway Typert artifacts are stale; regenerate with pinned DSH_SOURCE_ROOT')
}

const host = await import(pathToFileURL(join(output, 'typert.host.js')).href)
const remote = await import(pathToFileURL(join(output, 'typert.remote-client.js')).href)
if (host.TYPERT?.package !== 'dsh-gateway' || host.TYPERT.face !== 'host') {
  throw new Error('invalid dsh-gateway Host Typert manifest')
}
if (remote.TYPERT_REMOTE?.package !== 'dsh-gateway') {
  throw new Error('invalid dsh-gateway Client Remote contribution')
}
const hostMethods = methods(host.TYPERT.invocations)
const remoteMethods = methods(remote.TYPERT_REMOTE.descriptors)
if (JSON.stringify(hostMethods) !== '["overview"]' || JSON.stringify(remoteMethods) !== '["overview"]') {
  throw new Error(`unexpected evoforgeGateway Remote methods: ${JSON.stringify({ hostMethods, remoteMethods })}`)
}
const descriptor = remote.TYPERT_REMOTE.descriptors.find(row => row?.namespace === 'evoforgeGateway')
if (!descriptor || descriptor.parameters.length !== 0) {
  throw new Error('evoforgeGateway/overview must have no caller-controlled parameters')
}

function methods(rows) {
  if (!Array.isArray(rows)) return []
  return rows.filter(row => row?.namespace === 'evoforgeGateway').map(row => row.method).sort()
}

async function sourceDigest() {
  const sources = [
    'packages/dsh-gateway/src/client-types.ts',
    'packages/dsh-gateway/src/gateway.ts',
    'packages/dsh-gateway/src/gateway-remote.ts',
    'packages/dsh-gateway/src/gateway-remote.typert.ts',
    'packages/dsh-gateway/src/outbound.ts',
    'packages/dsh-gateway/src/transport-health.ts',
    'packages/dsh-gateway/typert-generator-compat.d.ts',
    'packages/dsh-gateway/tsconfig.typert.json',
  ]
  const hash = createHash('sha256')
  for (const source of sources) {
    hash.update(source).update('\0').update(await readFile(join(workspace, source))).update('\0')
  }
  return hash.digest('hex')
}
