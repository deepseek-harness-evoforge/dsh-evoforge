import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDoctorReport } from '../src/client/DoctorAction.tsx'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('Doctor native DSH Client Module', () => {
  it('ships one read-only Host Bundle and one browser Surface contribution', async () => {
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

  it('uses the existing /doctor command and the common native Surface slot', async () => {
    const client = await readFile(resolve(packageRoot, 'dist/client.js'), 'utf8')
    const host = await readFile(resolve(packageRoot, 'dist/index.mjs'), 'utf8')
    expect(client).toMatch(/window\.__ModuleLoader__\.load\(\{\s*id: "dsh-evoforge-doctor"/u)
    expect(client).toContain('evoforge.control.surface')
    expect(client).toContain('/doctor')
    expect(client).not.toContain('position:fixed')
    expect(host).not.toContain('window.__ModuleLoader__')
  })

  it('parses the stable human command without inventing a second health schema', () => {
    expect(parseDoctorReport([
      'DSH readiness: NOT READY',
      '✓ required-plugins: 2 required plugins are active.',
      '✗ runtime-failures: Enabled plugins failed: dsh-telegram [evoforge-telegram].',
      '  Next: Inspect the named Loader entry diagnostics, correct its configuration, and reload it.',
      '? channel-telegram: Required Telegram transport is still changing.',
    ].join('\n'))).toEqual({
      status: 'not-ready',
      checks: [
        { id: 'required-plugins', status: 'passed', summary: '2 required plugins are active.' },
        {
          id: 'runtime-failures',
          status: 'failed',
          summary: 'Enabled plugins failed: dsh-telegram [evoforge-telegram].',
          action: 'Inspect the named Loader entry diagnostics, correct its configuration, and reload it.',
        },
        { id: 'channel-telegram', status: 'unknown', summary: 'Required Telegram transport is still changing.' },
      ],
    })
  })
})
