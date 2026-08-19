import { readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const packageRoot = resolve(process.argv[2] ?? '')
const sourceRoot = resolve(packageRoot, 'src')
const declarationRoot = resolve(packageRoot, 'lib/types')
const sourceModules = new Set((await readdir(sourceRoot))
  .filter(name => name.endsWith('.ts'))
  .map(name => name.slice(0, -3)))

for (const name of await readdir(declarationRoot)) {
  const moduleName = name.endsWith('.d.ts.map')
    ? name.slice(0, -9)
    : name.endsWith('.d.ts')
      ? name.slice(0, -5)
      : undefined
  if (moduleName !== undefined && !sourceModules.has(moduleName)) {
    await rm(resolve(declarationRoot, name), { force: true })
  }
}
