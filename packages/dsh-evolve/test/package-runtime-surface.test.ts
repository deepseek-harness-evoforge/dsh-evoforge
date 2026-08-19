import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')

describe('packed dsh-evolve runtime surface', () => {
  it('contains no runtime Git publication or static Skill-target workflow', async () => {
    const runtime = await readFile(resolve(packageRoot, 'dist/index.mjs'), 'utf8')

    expect(runtime).not.toMatch(
      /GitSkillSource|no configured Git source|refs\/evoforge\/generations|feedbackDraftRoot|shadowTargets|evaluatorTargets|feedback-guided Shadow|Feedback Case Draft/u,
    )

    const shadow = await readFile(resolve(packageRoot, 'src/shadow.ts'), 'utf8')
    expect(shadow).not.toMatch(/DSH_EVOLVE_MODEL_|requestProposal|fetch\(/u)
  })
})
