import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { validateReleaseWorkflow } from './check-release-workflow.mjs'

test('release workflow preserves the protected, gate-first publication contract', async () => {
  const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
  const workflow = await readFile(join(repositoryRoot, '.github/workflows/release.yml'), 'utf8')
  assert.deepEqual(validateReleaseWorkflow(workflow), [])
})
