import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { expect, it } from 'vitest'
import { openGatewayOutboundJournal } from '../src/outbound-journal.js'

const source = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(import.meta.dirname, '../../../..', 'deepseek-harness')

async function mount(root: string) {
  const load = (path: string) => import(pathToFileURL(join(source, path)).href)
  const [{ Context }, storage, json, domain] = await Promise.all([
    load('vendor/cordis/lib/index.js'), load('packages/storage/storage/lib/index.js'),
    load('packages/storage/storage-json/lib/index.js'), load('packages/storage/storage-domain/lib/index.js'),
  ])
  const ctx = new Context()
  try {
    await ctx.plugin(storage.default)
    await ctx.plugin(json, { root })
    await ctx.plugin(domain, { backend: 'json' })
    return { ctx, facility: ctx.storageDomain as DomainFacility }
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}

it('preserves the legacy native text unit byte-for-byte while file state survives a fresh Context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evoforge-file-journal-'))
  const policy = { maxAttempts: 1, maxRetryAfterMs: 1_000, sendTimeoutMs: 1_000 }
  let active: Awaited<ReturnType<typeof mount>> | undefined
  try {
    active = await mount(root)
    const first = await openGatewayOutboundJournal(active.facility)
    const text = await first.prepare({
      routeId: 'route-a', kind: 'notice', intentKey: 'text:original', text: 'legacy text', now: 1,
    })
    await first.begin(text.record.id, 2)
    await first.finish(text.record.id, { kind: 'delivered', externalMessageId: 'text-message' }, policy, 3)
    const textPath = join(root, 'evoforge_gateway_outbound.json')
    const legacyBytes = await readFile(textPath)
    const nativeFile = { attachmentId: `sha256:${'a'.repeat(64)}`, name: 'result.txt', bytes: 19 }
    const file = await first.prepare({
      routeId: 'route-a', kind: 'file', intentKey: 'file:original', file: nativeFile,
      destinationDigest: 'b'.repeat(64), now: 4,
    })
    await first.begin(file.record.id, 5)
    await first.close()
    await active.ctx.fiber.dispose()
    active = undefined
    expect(await readFile(textPath)).toEqual(legacyBytes)
    const fileDocument = JSON.parse(await readFile(join(root, 'evoforge_gateway_file_outbound.json'), 'utf8'))
    expect(fileDocument.unit).toEqual({ name: 'evoforge_gateway_file_outbound', version: 1 })
    expect(fileDocument.tables.files[file.record.id]).toMatchObject({ file: nativeFile, status: 'sending' })
    expect(fileDocument.tables.files[file.record.id]).not.toHaveProperty('text')

    active = await mount(root)
    const resumed = await openGatewayOutboundJournal(active.facility)
    expect(await resumed.recoverInflight(6)).toBe(1)
    expect(resumed.get(file.record.id)).toMatchObject({ status: 'uncertain', file: nativeFile })
    expect(resumed.get(text.record.id)).toEqual({
      ...text.record, status: 'delivered', attempts: 1, updatedAt: 3, externalMessageId: 'text-message',
    })
    expect(await readFile(textPath)).toEqual(legacyBytes)
    await resumed.close()
  } finally {
    try { await active?.ctx.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) }
  }
}, 10_000)
