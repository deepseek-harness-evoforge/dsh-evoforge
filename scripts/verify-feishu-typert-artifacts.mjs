import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const workspace = resolve(import.meta.dirname, '..')
const output = join(workspace, 'packages/dsh-feishu/lib')
const recorded = (await readFile(join(output, 'typert.source.sha256'), 'utf8')).trim()
const actual = await sourceDigest()
if (recorded !== actual) {
  throw new Error('generated dsh-feishu Typert artifacts are stale; regenerate with pinned DSH_SOURCE_ROOT')
}

const host = await import(pathToFileURL(join(output, 'typert.host.js')).href)
const remote = await import(pathToFileURL(join(output, 'typert.remote-client.js')).href)
if (host.TYPERT?.package !== 'dsh-evoforge-feishu' || host.TYPERT.face !== 'host') {
  throw new Error('invalid dsh-feishu Host Typert manifest')
}
if (remote.TYPERT_REMOTE?.package !== 'dsh-evoforge-feishu') {
  throw new Error('invalid dsh-feishu Client Remote contribution')
}
const hostMethods = methods(host.TYPERT.invocations)
const remoteMethods = methods(remote.TYPERT_REMOTE.descriptors)
if (JSON.stringify(hostMethods) !== '["references"]' || JSON.stringify(remoteMethods) !== '["references"]') {
  throw new Error(`unexpected evoforgeFeishu Remote methods: ${JSON.stringify({ hostMethods, remoteMethods })}`)
}
const descriptor = remote.TYPERT_REMOTE.descriptors.find(row =>
  row?.namespace === 'evoforgeFeishu' && row.method === 'references')
if (!descriptor || descriptor.parameters.length !== 0) {
  throw new Error('evoforgeFeishu/references must have no caller-controlled parameters')
}

function methods(rows) {
  if (!Array.isArray(rows)) return []
  return rows.filter(row => row?.namespace === 'evoforgeFeishu').map(row => row.method).sort()
}

async function sourceDigest() {
  const sources = [
    'packages/dsh-feishu/src/feishu-credentials-remote.ts',
    'packages/dsh-feishu/src/feishu-credentials-remote.typert.ts',
    'packages/dsh-feishu/typert-generator-compat.d.ts',
    'packages/dsh-feishu/tsconfig.typert.json',
  ]
  const hash = createHash('sha256')
  for (const source of sources) {
    hash.update(source).update('\0').update(await readFile(join(workspace, source))).update('\0')
  }
  return hash.digest('hex')
}
