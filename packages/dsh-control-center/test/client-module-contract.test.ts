import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('Control Center native DSH Client Module', () => {
  it('ships as one removable Bundle/Client package on the official conversation seam', async () => {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
    expect(manifest.bin).toBeUndefined()
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client).toMatchObject({
      platform: 'web',
      inject: expect.arrayContaining(['@deepseek-ai/dsh-client-ui-conversation']),
    })
    expect(manifest.exports['./client']?.default).toBe('./lib/client.js')
    expect(manifest.files).not.toContain('test')
  })

  it('declares one child contribution slot and never creates a second router or fixed page', async () => {
    const client = await readFile(resolve(packageRoot, 'lib/client.js'), 'utf8')
    expect(client).toContain('conversation.view')
    expect(client).toContain('evoforge.control.surface')
    expect(client).toContain('window.__ModuleLoader__.load({')
    expect(client).not.toContain('position:fixed')
    expect(client).not.toContain('createBrowserRouter')
    expect(client).not.toContain('react-router')
  })
})
