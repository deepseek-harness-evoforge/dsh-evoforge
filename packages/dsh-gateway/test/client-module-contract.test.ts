import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('Gateway native DSH Client Module', () => {
  it('ships Host, generated Remote, and browser projection in one removable package', async () => {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
    expect(manifest.bin).toBeUndefined()
    expect(manifest.dsh).toEqual({
      bundle: { patch: './cordis.patch.yml' },
      client: {
        inject: [
          '@deepseek-ai/dsh-api-remotes',
          '@deepseek-ai/dsh-client-locale',
          '@deepseek-ai/dsh-client-ui-sidebar',
        ],
        platform: 'web',
      },
    })
    expect(manifest.exports['./client']).toBe('./dist/client.js')
    expect(manifest.exports['./remote']?.default).toBe('./lib/typert.remote-client.js')
    expect(manifest.files).toContain('lib/typert.remote-client.js')
    expect(manifest.files).not.toContain('test')
  })

  it('keeps browser code outside the Host artifact and exposes only one read method', async () => {
    const client = await readFile(resolve(packageRoot, 'dist/client.js'), 'utf8')
    const host = await readFile(resolve(packageRoot, 'dist/index.mjs'), 'utf8')
    const remote = await readFile(resolve(packageRoot, 'lib/typert.remote-client.js'), 'utf8')
    expect(client).toMatch(/window\.__ModuleLoader__\.load\(\{\s*id: "dsh-gateway"/u)
    expect(client).toContain('sidebar.footer.action')
    expect(client).toContain('evoforgeGateway')
    expect(host).not.toContain('window.__ModuleLoader__')
    expect(remote).toContain("method: 'overview'")
    expect(remote).not.toContain("method: 'pause'")
  })

  it('commits the pinned generated contract and keeps the real-browser bootstrap test-only', async () => {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
    const bootstrap = await readFile(resolve(packageRoot, 'test/fixtures/browser-gateway-bootstrap.mjs'), 'utf8')
    const workspaceSeed = await readFile(resolve(packageRoot, 'test/fixtures/browser-workspace-seed.mjs'), 'utf8')
    const overlay = await readFile(resolve(packageRoot, 'test/fixtures/browser-cordis.patch.yml'), 'utf8')

    for (const artifact of [
      'typert.host.js',
      'typert.host.d.ts',
      'typert.remote-client.js',
      'typert.remote-client.d.ts',
      'typert.remote-client.d.ts.map',
      'typert.source.sha256',
    ]) {
      expect(await readFile(resolve(packageRoot, 'lib', artifact), 'utf8')).not.toHaveLength(0)
    }
    expect(manifest.files).not.toContain('test')
    expect(bootstrap).toContain("inject = ['evoforge.gateway']")
    expect(bootstrap).toContain("const gateway = ctx['evoforge.gateway']")
    expect(bootstrap).toContain('gateway.registerTransport({')
    expect(bootstrap).not.toContain("from 'dsh-gateway'")
    expect(bootstrap).not.toContain('agents.create')
    expect(workspaceSeed).toContain("inject = ['workspaceRegistry']")
    expect(workspaceSeed).toContain('ctx.workspaceRegistry.create(')
    expect(workspaceSeed).not.toContain('new Workspace')
    expect(workspaceSeed).not.toContain('agents.create')
    expect(overlay).toContain("packages:\n      - dsh-gateway")
    expect(overlay).toContain('name: __EVOFORGE_GATEWAY_BROWSER_BOOTSTRAP__')
    expect(overlay).toContain('workspaceId: __EVOFORGE_GATEWAY_WORKSPACE_ID__')
  })
})
