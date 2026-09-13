import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

describe('dsh-feishu package contract', () => {
  it('is an official DSH Bundle without a product bin or bundled Runtime', async () => {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as {
      bin?: unknown
      dsh?: unknown
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(manifest.bin).toBeUndefined()
    expect(manifest.dsh).toMatchObject({
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web' },
    })
    expect(manifest.dependencies?.['@larksuiteoapi/node-sdk']).toBe('1.73.3')
    expect(manifest.peerDependencies?.['dsh-evoforge-gateway']).toBe('0.1.0-alpha.1')
    const native = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh-session/package.json'), 'utf8'))
    expect(native.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
    for (const peer of ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-llm']) {
      const installed = JSON.parse(await readFile(require.resolve(`${peer}/package.json`), 'utf8'))
      expect(installed.version).toBe(native.version)
      expect(manifest.peerDependencies?.[peer]).toBe(native.version)
      expect(manifest.devDependencies?.[peer]).toBe(native.version)
    }
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('@deepseek-ai/cordis')
    expect(Object.keys(manifest.dependencies ?? {}).filter(name => name.startsWith('@deepseek-ai/dsh-'))).toEqual([])
    expect(await readFile(resolve(packageRoot, 'cordis.patch.yml'), 'utf8')).toBe(
      '- insert:\n    - id: evoforge-feishu\n      name: dsh-evoforge-feishu\n      disabled: true\n',
    )
  })
})
