import { access, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUPPORTED_DSH_TARGETS } from './run-dsh-compatibility-matrix.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const workflowPath = join(repositoryRoot, '.github/workflows/ci.yml')
const workflow = await readFile(workflowPath, 'utf8')
const rootPackage = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
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

const workflowRevisions = [...workflow.matchAll(/^\s+revision:\s+([0-9a-f]{40})\s*$/gmu)]
  .map(match => match[1])
  .filter((value, index, values) => values.indexOf(value) === index)
const supportedRevisions = Object.keys(SUPPORTED_DSH_TARGETS)
if (workflowRevisions.length !== supportedRevisions.length
  || workflowRevisions.some(revision => !supportedRevisions.includes(revision))) {
  throw new Error(`CI DSH matrix must exactly match the audited compatibility allowlist. CI=${workflowRevisions.join(',')} allowlist=${supportedRevisions.join(',')}`)
}

if (!/^\s+run: pnpm --dir \.evoforge\/deepseek-harness build:lib\s*$/mu.test(workflow)) {
  throw new Error('assembled DSH CI job must run build:lib (host and client); host-only builds omit client-declared package entrypoints used by clean-profile loading')
}

if (!rootPackage.scripts?.pretypecheck?.includes('dsh-control-center')) {
  throw new Error('root pretypecheck must build dsh-control-center before recursive package typechecks; consumers import its published client entry')
}

if (!workflow.includes('prepare-dsh-case-packs.mjs')) {
  throw new Error('assembled DSH CI job must materialize Case Packs for the matrix revision; a fixed epoch would fail closed on the other audited target')
}

process.stdout.write(`CI test path, DSH target, assembled build, typecheck-preflight, and revision-matched fixture checks passed for ${paths.length} referenced files.\n`)
