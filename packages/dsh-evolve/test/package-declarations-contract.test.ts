import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')

describe('published declaration surface', () => {
  it('does not retain declarations for deleted runtime modules', async () => {
    const sourceModules = new Set((await readdir(resolve(packageRoot, 'src')))
      .filter(name => name.endsWith('.ts'))
      .map(name => name.slice(0, -3)))
    const orphaned = (await readdir(resolve(packageRoot, 'lib/types')))
      .filter(name => name.endsWith('.d.ts') || name.endsWith('.d.ts.map'))
      .map(name => name.endsWith('.d.ts.map') ? name.slice(0, -9) : name.slice(0, -5))
      .filter(name => !sourceModules.has(name))
      .sort()

    expect(orphaned).toEqual([])
  })
})
