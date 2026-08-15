import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function hashTree(root: string): Promise<string> {
  const hash = createHash('sha256')
  const files = await walkFiles(root)
  for (const file of files) {
    const path = relative(root, file).split(sep).join('/')
    hash.update(path)
    hash.update('\0')
    hash.update(await readFile(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)))
      continue
    }
    const stats = await lstat(path)
    if (!stats.isFile()) throw new Error(`unsupported non-file entry: ${path}`)
    files.push(path)
  }
  return files
}
