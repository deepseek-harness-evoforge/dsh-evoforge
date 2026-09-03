import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

test('local release tag creation checks live npm name ownership before gates', async () => {
  const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
  const source = await readFile(join(repositoryRoot, 'scripts/create-release-tag.mjs'), 'utf8')
  const nameCheck = source.indexOf("runNode('scripts/check-npm-package-names.mjs')")
  const gateCheck = source.indexOf("runNode('scripts/check-release-gates.mjs')")
  assert.notEqual(nameCheck, -1)
  assert.notEqual(gateCheck, -1)
  assert.ok(nameCheck < gateCheck, 'npm name ownership must be checked before release gates/tag creation')
})
