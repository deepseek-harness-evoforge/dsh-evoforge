import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

export function validateReleaseWorkflow(workflow) {
  const errors = []
  if (!/^\s+tags:\s*\n\s+- ['"]?dsh-v\*['"]?\s*$/mu.test(workflow)) {
    errors.push('release workflow must trigger only from dsh-v* tags')
  }
  if (/workflow_dispatch/u.test(workflow)) errors.push('release workflow must not expose an un-gated manual dispatch')
  if (!/environment:[\s\S]{0,300}\n\s+name: npm\s*$/mu.test(workflow)) {
    errors.push('release workflow must publish through the protected npm Environment')
  }
  if (!/permissions:[\s\S]*?id-token:\s+write/u.test(workflow)) {
    errors.push('release workflow must request id-token: write for npm provenance')
  }
  for (const required of [
    'scripts/check-release-tag-version.mjs',
    'run: pnpm check',
    'run: pnpm run check:release',
    'run: pnpm run check:release:gates',
    'npm publish',
  ]) {
    if (!workflow.includes(required)) errors.push(`release workflow is missing ${required}`)
  }
  const gateIndex = workflow.indexOf('run: pnpm run check:release:gates')
  const publishIndex = workflow.indexOf('npm publish')
  if (gateIndex >= 0 && publishIndex >= 0 && gateIndex > publishIndex) {
    errors.push('all required release gates must run before npm publish')
  }
  const actionLines = [...workflow.matchAll(/^\s+uses:\s+[^\s]+@([^\s#]+).*$/gmu)]
  if (actionLines.length === 0) errors.push('release workflow must contain pinned GitHub Actions')
  for (const match of actionLines) {
    if (!/^[0-9a-f]{40}$/u.test(match[1])) errors.push(`GitHub Action is not pinned to a commit: ${match[0].trim()}`)
  }
  return errors
}

if (isMainModule()) {
  const workflow = await readFile(join(repositoryRoot, '.github/workflows/release.yml'), 'utf8')
  const errors = validateReleaseWorkflow(workflow)
  if (errors.length > 0) throw new Error(errors.join('\n'))
  console.log('Release workflow is tag-only, protected, gate-ordered, and commit-pinned.')
}

function isMainModule() {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
}
