import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('dsh-evolve-attention package contract', () => {
  it('ships one disabled narrow bridge with optional concrete channel peers', async () => {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
    expect(manifest.name).toBe('dsh-evolve-attention')
    expect(manifest.dsh?.bundle).toEqual({ patch: './cordis.patch.yml' })
    expect(manifest.peerDependencies).toMatchObject({
      'dsh-evolve': '>=0.1.0-alpha.1 <0.2.0',
      'dsh-feishu': '>=0.1.0-alpha.1 <0.2.0',
      'dsh-telegram': '>=0.1.0-alpha.1 <0.2.0',
    })
    expect(manifest.peerDependenciesMeta).toEqual({
      'dsh-feishu': { optional: true },
      'dsh-telegram': { optional: true },
    })
    expect(manifest.dependencies).toEqual({ '@deepseek-ai/schemastery': '3.18.1' })
    expect(manifest.exports?.['./cordis.patch.yml']).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('cordis.patch.yml')
    expect(manifest.files).toContain('README.md')
    expect(await readFile(resolve(packageRoot, 'cordis.patch.yml'), 'utf8')).toBe(
      '- insert:\n'
      + '    - id: evoforge-evolve-attention\n'
      + '      name: dsh-evolve-attention\n'
      + '      disabled: true\n',
    )
  })
})
