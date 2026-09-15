import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspectDshTarget } from './run-dsh-compatibility-matrix.mjs'

const source = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
assert.ok(source, 'DSH_EVOLVE_DSH_SOURCE_DIR is required for native Typert validation')
const target = inspectDshTarget(source)
const root = fileURLToPath(new URL('..', import.meta.url))
const load = path => import(pathToFileURL(join(target.root, path, 'lib/index.js')).href)
const [{ Context }, { default: Registry }, { validateTypertManifest }] = await Promise.all([
  load('vendor/cordis'), load('packages/typert/registry'), load('packages/typert/loader'),
])
const ctx = new Context()
try {
  await ctx.plugin(Registry)
  for (const [directory, name] of [
    ['dsh-evolve', 'dsh-evolve'],
    ['dsh-gateway', 'dsh-evoforge-gateway'],
    ['dsh-feishu', 'dsh-evoforge-feishu'],
  ]) {
    const { TYPERT } = await import(pathToFileURL(join(root, 'packages', directory, 'lib/typert.host.js')).href)
    const contribution = validateTypertManifest(name, TYPERT)
    const dispose = ctx.typert.register(contribution)
    assert.ok(ctx.typert.getPackage(name, 'host'), `native registry did not accept ${name}`)
    await dispose()
    assert.equal(ctx.typert.getPackage(name, 'host'), undefined, `native registry retained ${name} after disposal`)
  }
} finally {
  await ctx.fiber.dispose()
}
process.stdout.write(`Native Typert validation and disposal passed for ${target.revision}.\n`)
