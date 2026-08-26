import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const revision = valueAfter('--revision')
const output = valueAfter('--out')
if (!/^[a-f0-9]{40}$/u.test(revision ?? '') || output === undefined || output.trim() === '') {
  throw new Error('usage: prepare-dsh-case-packs --revision <40-hex-git-object> --out <directory>')
}

const root = resolve(new URL('..', import.meta.url).pathname)
const sourceRoot = join(root, 'examples', 'case-packs')
const outputRoot = resolve(output)
await mkdir(outputRoot, { recursive: true })

const entries = await readdir(sourceRoot, { withFileTypes: true })
for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const sourceDir = join(sourceRoot, entry.name)
  const targetDir = join(outputRoot, entry.name)
  await cp(sourceDir, targetDir, { recursive: true })
  const manifestPath = join(targetDir, 'manifest.json')
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    continue
  }
  if (manifest?.epoch?.dshRevision === undefined) continue
  manifest.epoch.dshRevision = revision
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

process.stdout.write(`Prepared DSH-revision-matched Case Packs at ${outputRoot}.\n`)

function valueAfter(flag) {
  const index = args.indexOf(flag)
  return index < 0 ? undefined : args[index + 1]
}
