import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PINNED_DSH_REVISION = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
const workspace = resolve(import.meta.dirname, '..')
const dshRoot = process.env.DSH_SOURCE_ROOT

if (dshRoot === undefined || dshRoot.trim() === '') {
  throw new Error('generate:typert requires DSH_SOURCE_ROOT pointing at the pinned deepseek-harness checkout')
}
const exactDshRoot = resolve(dshRoot)
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: exactDshRoot, encoding: 'utf8' }).trim()
if (revision !== PINNED_DSH_REVISION) {
  throw new Error(`generate:typert requires DSH ${PINNED_DSH_REVISION}; received ${revision}`)
}

const generatorUrl = pathToFileURL(join(exactDshRoot, 'packages/typert/generator/lib/index.js')).href
const { FaceModelEmitter, WorkspaceAnalyzer } = await import(generatorUrl)
const analysisRoot = await mkdtemp(join(tmpdir(), 'evoforge-typert-'))
const aggregate = join(analysisRoot, 'tsconfig.host.json')
await writeFile(aggregate, `${JSON.stringify({
  files: [],
  references: [
    { path: join(workspace, 'packages/dsh-evolve/tsconfig.typert.json') },
    { path: join(exactDshRoot, 'packages/typert/protocol') },
  ],
}, null, 2)}\n`)
const model = new WorkspaceAnalyzer({
  root: workspace,
  hostConfig: aggregate,
  packages: ['dsh-evolve', '@deepseek-ai/dsh-typert-protocol'],
  faces: ['host'],
}).analyze()
const face = model.faces.find(candidate => candidate.face === 'host')
const emitted = face === undefined ? undefined : new FaceModelEmitter(face).emit('dsh-evolve')
if (emitted === undefined || emitted.remote === undefined) {
  throw new Error('pinned DSH generator produced no dsh-evolve Host Remote artifact')
}

const gatewayAggregate = join(analysisRoot, 'tsconfig.gateway-host.json')
await writeFile(gatewayAggregate, `${JSON.stringify({
  files: [],
  references: [
    { path: join(workspace, 'packages/dsh-gateway/tsconfig.typert.json') },
    { path: join(exactDshRoot, 'packages/typert/protocol') },
  ],
}, null, 2)}\n`)
const gatewayModel = new WorkspaceAnalyzer({
  root: workspace,
  hostConfig: gatewayAggregate,
  packages: ['dsh-gateway', '@deepseek-ai/dsh-typert-protocol'],
  faces: ['host'],
}).analyze()
const gatewayFace = gatewayModel.faces.find(candidate => candidate.face === 'host')
const gatewayEmitted = gatewayFace === undefined
  ? undefined
  : new FaceModelEmitter(gatewayFace).emit('dsh-gateway')
if (gatewayEmitted === undefined || gatewayEmitted.remote === undefined) {
  throw new Error('pinned DSH generator produced no dsh-gateway Host Remote artifact')
}

const output = join(workspace, 'packages/dsh-evolve/lib')
await mkdir(output, { recursive: true })
await Promise.all([
  writeFile(join(output, 'typert.host.js'), emitted.js),
  writeFile(join(output, 'typert.host.d.ts'), emitted.dts),
  writeFile(join(output, 'typert.remote-client.js'), emitted.remote.js),
  writeFile(join(output, 'typert.remote-client.d.ts'), emitted.remote.dts),
  writeFile(join(output, 'typert.remote-client.d.ts.map'), emitted.remote.dtsMap),
  writeFile(join(output, 'typert.source.sha256'), `${await evolutionSourceDigest()}\n`),
])

const gatewayOutput = join(workspace, 'packages/dsh-gateway/lib')
await mkdir(gatewayOutput, { recursive: true })
await Promise.all([
  writeFile(join(gatewayOutput, 'typert.host.js'), gatewayEmitted.js),
  writeFile(join(gatewayOutput, 'typert.host.d.ts'), gatewayEmitted.dts),
  writeFile(join(gatewayOutput, 'typert.remote-client.js'), gatewayEmitted.remote.js),
  writeFile(join(gatewayOutput, 'typert.remote-client.d.ts'), gatewayEmitted.remote.dts),
  writeFile(join(gatewayOutput, 'typert.remote-client.d.ts.map'), gatewayEmitted.remote.dtsMap),
  writeFile(join(gatewayOutput, 'typert.source.sha256'), `${await gatewaySourceDigest()}\n`),
])

async function evolutionSourceDigest() {
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

async function gatewaySourceDigest() {
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
