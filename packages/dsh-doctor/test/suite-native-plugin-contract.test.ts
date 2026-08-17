import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = resolve(packageRoot, '..')

const contracts = [
  {
    name: 'dsh-evolve',
    entryId: 'evoforge-evolution',
    disabled: false,
  },
  {
    name: 'dsh-evolve-web',
    entryId: 'evoforge-evolution-web',
    disabled: false,
  },
  {
    name: 'dsh-software-delivery',
    entryId: 'evoforge-software-delivery',
    disabled: false,
  },
  {
    name: 'dsh-doctor',
    entryId: 'evoforge-doctor',
    disabled: false,
  },
  {
    name: 'dsh-github-review',
    entryId: 'evoforge-github-review',
    disabled: true,
  },
  {
    name: 'dsh-telegram',
    entryId: 'evoforge-telegram',
    disabled: true,
  },
  {
    name: 'dsh-goal-continuity',
    entryId: 'evoforge-goal-continuity',
    disabled: true,
  },
  {
    name: 'dsh-evolve-attention',
    entryId: 'evoforge-evolve-attention',
    disabled: true,
  },
  {
    name: 'dsh-resident',
    entryId: 'evoforge-resident',
    disabled: true,
  },
  {
    name: 'dsh-channel-router',
    entryId: 'evoforge-channel-router',
    disabled: true,
  },
] as const

describe('EvoForge native DSH plugin suite contract', () => {
  it.each(contracts)('$name exports one loadable Cordis plugin contract', async ({ name }) => {
    const source = await readFile(join(packagesRoot, name, 'src', 'index.ts'), 'utf8')
    expect(source).toContain(`export const name = '${name}'`)
    expect(source).toMatch(/export const inject = \[[^\]]+\]/u)
    expect(source).toContain('export const Config')
    expect(source).toMatch(/export (?:async )?function apply\(/u)
    if (name === 'dsh-software-delivery') {
      expect(source).not.toContain('export {\n  verifyDelivery')
      expect(source).not.toMatch(/dsh-delivery\s+verify/u)
    }
  })

  it.each(contracts)('$name is an official install-and-activate Bundle without a product CLI', async ({
    name,
    entryId,
    disabled,
  }) => {
    const root = join(packagesRoot, name)
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      bin?: unknown
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      exports?: Record<string, unknown>
      files?: string[]
      dsh?: { bundle?: { patch?: string }; client?: { inject?: string[] } }
    }
    expect(manifest.bin).toBeUndefined()
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.exports?.['./cordis.patch.yml']).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('cordis.patch.yml')

    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      expect(dependency === '@deepseek-ai/cordis' || dependency.startsWith('@deepseek-ai/dsh-'))
        .toBe(false)
    }
    for (const dependency of Object.keys(manifest.peerDependencies ?? {})) {
      if (dependency !== '@deepseek-ai/cordis' && !dependency.startsWith('@deepseek-ai/dsh-')) continue
      expect(manifest.devDependencies?.[dependency]).toBeDefined()
      if (dependency.startsWith('@deepseek-ai/dsh-')) expect(manifest.peerDependencies?.[dependency])
        .toBe('>=0.1.0-rc.5 <0.1.0')
    }
    for (const dependency of manifest.dsh?.client?.inject ?? []) {
      expect(manifest.peerDependencies?.[dependency]).toBe('>=0.1.0-rc.5 <0.1.0')
      expect(manifest.devDependencies?.[dependency]).toBe('0.1.0-rc.6')
    }

    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    expect([...patch.matchAll(/^\s*name:\s*(\S+)\s*$/gmu)].map(match => match[1]))
      .toEqual([name])
    expect(patch).toContain(`id: ${entryId}`)
    expect(/^\s*disabled:\s*true\s*$/mu.test(patch)).toBe(disabled)
  })
})
