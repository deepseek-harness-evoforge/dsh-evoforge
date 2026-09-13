import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)

describe('packed dsh-evolve runtime surface', () => {
  it('contains no runtime Git publication or static Skill-target workflow', async () => {
    const runtime = await readFile(resolve(packageRoot, 'dist/index.mjs'), 'utf8')

    expect(runtime).not.toMatch(
      /GitSkillSource|no configured Git source|refs\/evoforge\/generations|feedbackDraftRoot|shadowTargets|evaluatorTargets|feedback-guided Shadow|Feedback Case Draft/u,
    )

    const shadow = await readFile(resolve(packageRoot, 'src/shadow.ts'), 'utf8')
    expect(shadow).not.toMatch(/DSH_EVOLVE_MODEL_|requestProposal|fetch\(/u)
  })

  it('declares the statically imported Goal and Tools packages as required peers', async () => {
    const runtime = await readFile(resolve(packageRoot, 'dist/index.mjs'), 'utf8')
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
    // Compare declarations with the independently installed native cohort.
    // This is a packaging invariant, not a declaration of release support.
    const native = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh-session/package.json'), 'utf8'))
    expect(native.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
    const requiredStaticPeers = {
      '@deepseek-ai/dsh-goal': native.version,
      '@deepseek-ai/dsh-tools': native.version,
    }

    expect(runtime).toMatch(/^import .* from ["']@deepseek-ai\/dsh-goal["'];?$/mu)
    expect(runtime).toMatch(/^import .* from ["']@deepseek-ai\/dsh-tools["'];?$/mu)
    expect(manifest.peerDependencies).toMatchObject(requiredStaticPeers)
    expect(manifest.devDependencies).toMatchObject(requiredStaticPeers)
    for (const peer of Object.keys(requiredStaticPeers)) {
      const installed = JSON.parse(await readFile(require.resolve(`${peer}/package.json`), 'utf8'))
      expect(installed.version).toBe(native.version)
      expect(manifest.peerDependenciesMeta?.[peer]).toBeUndefined()
    }
  })
})
