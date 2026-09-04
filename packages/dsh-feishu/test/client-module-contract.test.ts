import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('Feishu native DSH Client Module', () => {
  it('ships one host Bundle, one browser half, and one typed reference projection', async () => {
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
    expect(manifest.exports['./remote']?.default).toBe('./lib/typert.remote-client.js')
    expect(manifest.files).toContain('lib/typert.remote-client.js')
    expect(manifest.files).toContain('lib/typert.remote-client.d.ts')
    expect(manifest.files).toContain('lib/typert.host.js')
    expect(manifest.files).not.toContain('test')
  })

  it('registers inside the original DSH Web loader and keeps browser code out of Host output', async () => {
    const client = await readFile(resolve(packageRoot, 'dist/client.js'), 'utf8')
    const host = await readFile(resolve(packageRoot, 'dist/index.mjs'), 'utf8')
    expect(client).toMatch(/window\.__ModuleLoader__\.load\(\{\s*id: "dsh-evoforge-feishu"/u)
    expect(client).toContain('evoforge.control.surface')
    expect(client).not.toContain('dsh-feishu-panel')
    expect(client).toContain('executeCommand(commands, target, "/feishu")')
    expect(client).toContain('commands.execute(sessionId, line, [])')
    expect(client).toContain('EVOFORGE_FEISHU_HEALTH_V2')
    expect(client).toContain('health.content.permission.document-read')
    expect(client).toContain('health.content.status.future-session-only')
    expect(client).toContain('evoforgeFeishu')
    expect(client).not.toContain('/feishu-pair')
    expect(client).not.toContain('EVOFORGE PAIR')
    expect(host).not.toContain('window.__ModuleLoader__')
  })

  it('keeps the generated Remote contract to a redacted, parameterless reference method', async () => {
    const host = await readFile(resolve(packageRoot, 'lib/typert.host.js'), 'utf8')
    const remote = await readFile(resolve(packageRoot, 'lib/typert.remote-client.js'), 'utf8')
    expect(host).toContain("package: 'dsh-evoforge-feishu'")
    expect(remote).toContain("namespace: 'evoforgeFeishu'")
    expect(remote).toContain("method: 'references'")
    expect(remote).not.toContain('secret-value')
  })

  it('keeps the real-browser bootstrap outside the published package', async () => {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
    const bootstrap = await readFile(resolve(packageRoot, 'test/fixtures/browser-workspace-bootstrap.mjs'), 'utf8')
    const healthBootstrap = await readFile(resolve(packageRoot, 'test/fixtures/browser-health-bootstrap.mjs'), 'utf8')
    const overlay = await readFile(resolve(packageRoot, 'test/fixtures/browser-cordis.patch.yml'), 'utf8')
    expect(manifest.files).not.toContain('test')
    expect(bootstrap).toContain("workspaceRegistry.create(config.workspacePath, 'EvoForge Feishu Setup')")
    expect(bootstrap).toContain('ctx.agents.create')
    expect(healthBootstrap).toContain("ctx.commands.execute(agent, '/feishu'")
    expect(healthBootstrap).toContain("agent.session.append('turn/start'")
    expect(healthBootstrap).toContain("inject = ['agents', 'commands', 'evoforge.feishuTest']")
    expect(overlay).toContain('name: dsh-evoforge-feishu')
    expect(overlay).toContain('mode: pairing')
    expect(overlay).toContain('name: __EVOFORGE_FEISHU_BROWSER_BOOTSTRAP__')
  })
})
