import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')
const requiredStaticPeers = {
  '@deepseek-ai/dsh-goal': '0.1.2-alpha.5',
  '@deepseek-ai/dsh-tools': '0.1.2-alpha.5',
} as const

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

    expect(runtime).toMatch(/^import .* from ["']@deepseek-ai\/dsh-goal["'];?$/mu)
    expect(runtime).toMatch(/^import .* from ["']@deepseek-ai\/dsh-tools["'];?$/mu)
    expect(manifest.peerDependencies).toMatchObject(requiredStaticPeers)
    for (const peer of Object.keys(requiredStaticPeers)) {
      expect(manifest.peerDependenciesMeta?.[peer]).toBeUndefined()
    }
  })
})
