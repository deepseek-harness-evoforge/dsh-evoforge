import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = resolve(packageRoot, '..')
const require = createRequire(import.meta.url)

const contracts: readonly {
  readonly name: string
  readonly moduleName?: string
  readonly entryId: string
  readonly disabled: boolean
}[] = [
  {
    name: 'dsh-control-center',
    entryId: 'evoforge-control-center',
    disabled: false,
  },
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
    moduleName: 'dsh-evoforge-doctor',
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
    moduleName: 'dsh-evoforge-telegram',
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
    name: 'dsh-gateway',
    moduleName: 'dsh-evoforge-gateway',
    entryId: 'evoforge-gateway',
    disabled: false,
  },
  {
    name: 'dsh-feishu',
    moduleName: 'dsh-evoforge-feishu',
    entryId: 'evoforge-feishu',
    disabled: true,
  },
] as const

describe('EvoForge native DSH plugin suite contract', () => {
  it.each(contracts)('$name exports one loadable Cordis plugin contract', async ({ name, moduleName }) => {
    const source = await readFile(join(packagesRoot, name, 'src', 'index.ts'), 'utf8')
    expect(source).toContain(`export const name = '${moduleName ?? name}'`)
    expect(source).toMatch(/export const inject(?::[^=]+)?\s*=\s*\[[^\]]*\]/u)
    expect(source).toContain('export const Config')
    expect(source).toMatch(/export (?:async )?function apply\(/u)
    if (name === 'dsh-software-delivery') {
      expect(source).not.toContain('export {\n  verifyDelivery')
      expect(source).not.toMatch(/dsh-delivery\s+verify/u)
    }
  })

  it.each(contracts)('$name is an official install-and-activate Bundle without a product CLI', async ({
    name,
    moduleName,
    entryId,
    disabled,
  }) => {
    const root = join(packagesRoot, name)
    // Packaging consistency is not release-support authorization. Compare the
    // declarations against the independently installed native cohort.
    const native = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh-session/package.json'), 'utf8'))
    expect(native.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
    const packageRequire = createRequire(join(root, 'package.json'))
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
      if (dependency.startsWith('@deepseek-ai/dsh-')) {
        const installed = JSON.parse(await readFile(packageRequire.resolve(`${dependency}/package.json`), 'utf8'))
        expect(installed.version).toBe(native.version)
        expect(manifest.peerDependencies?.[dependency]).toBe(native.version)
        expect(manifest.devDependencies?.[dependency]).toBe(native.version)
      }
    }
    for (const dependency of manifest.dsh?.client?.inject ?? []) {
      expect(manifest.peerDependencies?.[dependency]).toBe(native.version)
      expect(manifest.devDependencies?.[dependency]).toBe(native.version)
    }

    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    expect([...patch.matchAll(/^\s*name:\s*(\S+)\s*$/gmu)].map(match => match[1]))
      .toEqual([moduleName ?? name])
    expect(patch).toContain(`id: ${entryId}`)
    expect(/^\s*disabled:\s*true\s*$/mu.test(patch)).toBe(disabled)
  })
})
