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

const artifactContractPackages = {
  'dsh-control-center': 'pnpm run build',
  'dsh-doctor': 'pnpm run build',
  'dsh-evolve': 'pnpm run build',
  'dsh-gateway': 'pnpm run build',
  'dsh-feishu': 'pnpm run build',
  'dsh-telegram': 'pnpm run build',
}
for (const [packageName, requiredPretest] of Object.entries(artifactContractPackages)) {
  const manifest = JSON.parse(await readFile(join(repositoryRoot, 'packages', packageName, 'package.json'), 'utf8'))
  if (!manifest.scripts?.pretest?.includes(requiredPretest)) {
    throw new Error(`${packageName} reads built artifacts in its tests and must declare pretest '${requiredPretest}'`)
  }
}

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

if (!/^\s+run: pnpm --dir \.evoforge\/deepseek-harness build\s*$/mu.test(workflow)) {
  throw new Error('assembled DSH CI job must run the full DSH build; clean Web profiles require frontend dist and all runtime package entrypoints')
}

if (!workflow.includes('ref: db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5')) {
  throw new Error('Node CI jobs must checkout the latest audited DSH alpha.5 revision for package tests that exercise native DSH paths')
}

if (!workflow.includes('DSH_EVOLVE_DSH_SOURCE_DIR: ${{ github.workspace }}/.evoforge/deepseek-harness')) {
  throw new Error('Node CI repository checks must point native DSH tests at the checked-out DSH source')
}

const integrationBuild = workflow.match(/- name: Build EvoForge integration packages\n([\s\S]*?)(?=\n\s*- name: Materialize DSH-revision-matched Case Packs)/u)?.[1] ?? ''
if (/pnpm --filter dsh-telegram build/u.test(integrationBuild)) {
  throw new Error('assembled CI must not build dsh-telegram directly beside dsh-evolve-attention: its shared peer build can race and remove dist/index.mjs')
}

if (!rootPackage.scripts?.pretypecheck?.includes('dsh-control-center')) {
  throw new Error('root pretypecheck must build dsh-control-center before recursive package typechecks; consumers import its published client entry')
}

if (!rootPackage.scripts?.test?.includes('--workspace-concurrency=1')) {
  throw new Error('root test must serialize workspace package pretest/build/test lifecycles; shared packed artifacts are not safe to rebuild concurrently')
}

if (!workflow.includes('prepare-dsh-case-packs.mjs')) {
  throw new Error('assembled DSH CI job must materialize Case Packs for the matrix revision; a fixed epoch would fail closed on the other audited target')
}

process.stdout.write(`CI test path, DSH target, assembled build, typecheck-preflight, and revision-matched fixture checks passed for ${paths.length} referenced files.\n`)
