import { access, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const workflowPath = join(repositoryRoot, '.github/workflows/ci.yml')
const workflow = await readFile(workflowPath, 'utf8')
const paths = [...workflow.matchAll(/(?:^|\s)(test\/[A-Za-z0-9._/-]+\.test\.ts)/gu)]
  .map(match => match[1])
  .filter((value, index, values) => values.indexOf(value) === index)

const packageDirectories = (await readdir(join(repositoryRoot, 'packages'), { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => join(repositoryRoot, 'packages', entry.name))

const missing = []
for (const testPath of paths) {
  let found = false
  for (const packageDirectory of packageDirectories) {
    try {
      await access(join(packageDirectory, testPath))
      found = true
      break
    } catch {
      // The same workflow path is resolved against the package selected by its command.
    }
  }
  if (!found) missing.push(testPath)
}

if (missing.length > 0) {
  throw new Error(`CI references missing package test files:\n${missing.join('\n')}`)
}

process.stdout.write(`CI test path check passed for ${paths.length} referenced files.\n`)
