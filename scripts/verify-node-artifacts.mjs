import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const workspace = resolve(import.meta.dirname, '..')
const artifacts = process.argv.slice(2)
if (artifacts.length === 0) throw new Error('verify-node-artifacts requires at least one workspace-relative artifact')
for (const artifact of artifacts) {
  execFileSync(process.execPath, ['--check', resolve(workspace, artifact)], { stdio: 'pipe' })
}
