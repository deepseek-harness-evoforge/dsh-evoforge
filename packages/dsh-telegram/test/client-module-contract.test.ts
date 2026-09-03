import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseTelegramHealth } from '../src/client/TelegramAction.tsx'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('Telegram native DSH Client Module', () => {
  it('ships one Host Adapter and one browser Surface contribution', async () => {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
    expect(manifest.bin).toBeUndefined()
    expect(manifest.dsh).toEqual({
      bundle: { patch: './cordis.patch.yml' },
      client: {
        inject: [
          '@deepseek-ai/dsh-api-remotes',
          '@deepseek-ai/dsh-client-locale',
          '@deepseek-ai/dsh-client-ui-conversation',
        ],
        platform: 'web',
      },
    })
    expect(manifest.exports['./client']).toBe('./dist/client.js')
    expect(manifest.files).toEqual(['dist', 'cordis.patch.yml'])
  })

  it('uses the existing /telegram command and common Control Center slot', async () => {
    const client = await readFile(resolve(packageRoot, 'dist/client.js'), 'utf8')
    const host = await readFile(resolve(packageRoot, 'dist/index.mjs'), 'utf8')
    expect(client).toMatch(/window\.__ModuleLoader__\.load\(\{\s*id: "dsh-telegram"/u)
    expect(client).toContain('evoforge.control.surface')
    expect(client).toContain('/telegram')
    expect(client).not.toContain('position:fixed')
    expect(host).not.toContain('window.__ModuleLoader__')
  })

  it('parses the Telegram command while retaining Gateway delivery counts', () => {
    expect(parseTelegramHealth([
      'Telegram route: READY (Gateway tg-route, session sess-1, one private chat).',
      'Transport: telegram-long-poll; lifecycle ready.',
      'Retained delivery: 7 delivered; 2 pending; 1 uncertain; 3 failed.',
      'Model surface: 0 tools, 0 prompt sections, 0 skills.',
    ].join('\n'))).toEqual({
      status: 'ready',
      transportKind: 'telegram-long-poll',
      lifecycle: 'ready',
      routeId: 'tg-route',
      sessionId: 'sess-1',
      delivered: 7,
      pending: 2,
      uncertain: 1,
      failed: 3,
    })
  })
})
