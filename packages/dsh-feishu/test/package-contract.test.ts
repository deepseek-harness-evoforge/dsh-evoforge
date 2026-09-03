import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('dsh-feishu package contract', () => {
  it('is an official DSH Bundle without a product bin or bundled Runtime', async () => {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as {
      bin?: unknown
      dsh?: unknown
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    expect(manifest.bin).toBeUndefined()
    expect(manifest.dsh).toMatchObject({
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web' },
    })
    expect(manifest.dependencies?.['@larksuiteoapi/node-sdk']).toBe('1.73.0')
    expect(manifest.peerDependencies?.['dsh-gateway']).toBe('0.1.0-alpha.1')
    expect(manifest.peerDependencies?.['@deepseek-ai/dsh-tools']).toBe('0.1.2-alpha.5')
    expect(manifest.peerDependencies?.['@deepseek-ai/dsh-llm']).toBe('0.1.2-alpha.5')
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('@deepseek-ai/cordis')
    expect(Object.keys(manifest.dependencies ?? {}).filter(name => name.startsWith('@deepseek-ai/dsh-'))).toEqual([])
    expect(await readFile(resolve(packageRoot, 'cordis.patch.yml'), 'utf8')).toBe(
      '- insert:\n    - id: evoforge-feishu\n      name: dsh-feishu\n      disabled: true\n',
    )
  })
})
