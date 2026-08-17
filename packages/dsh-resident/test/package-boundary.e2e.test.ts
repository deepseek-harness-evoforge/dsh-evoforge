import { execFile as execFileCallback } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('packed dsh-resident Bundle boundary', () => {
  it('publishes one DSH Bundle and no executable or second runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-resident-package-'))
    temporaryRoots.push(root)
    const installRoot = join(root, 'install')
    await mkdir(installRoot, { recursive: true })
    await writeFile(join(installRoot, 'package.json'), '{"private":true}\n')

    await execFile('pnpm', ['pack', '--pack-destination', root], {
      cwd: packageRoot,
      encoding: 'utf8',
      timeout: 30_000,
    })
    const tarball = join(root, 'dsh-resident-0.1.0-alpha.1.tgz')
    await execFile('pnpm', ['add', tarball, '--ignore-scripts', '--offline'], {
      cwd: installRoot,
      encoding: 'utf8',
      timeout: 30_000,
    })
    const binary = join(installRoot, 'node_modules', '.bin', 'dsh-resident')
    await expect(access(binary)).rejects.toThrow()

    const installedRoot = join(installRoot, 'node_modules', 'dsh-resident')
    const manifest = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8')) as {
      bin?: unknown
      exports?: Record<string, unknown>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.bin).toBeUndefined()
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.exports?.['./cordis.patch.yml']).toBe('./cordis.patch.yml')
    expect(await readFile(join(installedRoot, 'cordis.patch.yml'), 'utf8'))
      .toContain('name: dsh-resident')
    expect(await readFile(join(installedRoot, 'dist', 'index.mjs'), 'utf8'))
      .toContain('const name = "dsh-resident"')
  }, 60_000)
})
