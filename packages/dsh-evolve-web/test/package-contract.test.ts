import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('installable DSH bundle', () => {
  it('installs the host runtime and global Web adapter as one removable profile layer', async () => {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
    expect(manifest.dsh?.bundle).toEqual({ patch: './cordis.patch.yml' })
    expect(manifest.dependencies?.['dsh-evolve']).toBeUndefined()
    expect(manifest.peerDependencies?.['dsh-evolve']).toBe('0.1.0-alpha.1')
    expect(manifest.files).toContain('cordis.patch.yml')

    expect(await readFile(resolve(packageRoot, 'cordis.patch.yml'), 'utf8')).toBe(
      "- insert:\n"
      + "    - id: evoforge-evolution-web\n"
      + "      name: dsh-evolve-web\n",
    )
  })

  it('keeps the real-browser bootstrap test-only and loads the installed host artifact', async () => {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
    expect(manifest.files).not.toContain('test')

    const bootstrap = await readFile(resolve(packageRoot, 'test/fixtures/browser-workspace-bootstrap.mjs'), 'utf8')
    expect(bootstrap).toContain('pathToFileURL(config.evolveEntry)')
    expect(bootstrap).not.toContain("from 'dsh-evolve'")

    const overlay = await readFile(resolve(packageRoot, 'test/fixtures/cordis.patch.yml'), 'utf8')
    expect(overlay).toContain('name: __EVOFORGE_BROWSER_BOOTSTRAP__')
    expect(overlay).toContain('evolveEntry: __EVOFORGE_INSTALLED_ENTRY__')
    expect(overlay).not.toContain('name: !!js')
  })
})
