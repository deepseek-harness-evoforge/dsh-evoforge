import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const [configPath, dshSourceDir, storeSource, action, inputPath] = process.argv.slice(2)
if (configPath === undefined || dshSourceDir === undefined || storeSource === undefined || action === undefined) {
  throw new Error('usage: generation-crash-driver <config> <dsh-source> <store-source> <action> [input]')
}

const { boot } = await import(
  pathToFileURL(`${dshSourceDir}/packages/boot/app-boot/lib/index.js`).href
)
const { openEvolutionStore } = await import(pathToFileURL(storeSource).href)
const ctx = await boot('dsh-evolve-generation-crash-test-child', configPath)
const store = await openEvolutionStore(ctx.storageDomain)

if (action === 'before-publish') {
  process.kill(process.pid, 'SIGKILL')
} else if (action === 'after-publish') {
  const input = JSON.parse(await readFile(inputPath, 'utf8'))
  await store.publishGeneration(input)
  process.kill(process.pid, 'SIGKILL')
} else if (action === 'after-promote') {
  const input = JSON.parse(await readFile(inputPath, 'utf8'))
  const generation = (await store.publishGeneration(input)).generation
  await store.promoteGeneration(input.workspaceId, generation.id)
  process.kill(process.pid, 'SIGKILL')
} else if (action === 'after-rollback') {
  const input = JSON.parse(await readFile(inputPath, 'utf8'))
  await store.rollbackGeneration(input.workspaceId)
  process.kill(process.pid, 'SIGKILL')
} else {
  throw new Error(`unknown crash action '${action}'`)
}
