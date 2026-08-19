import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')

describe('packed dsh-evolve runtime surface', () => {
  it('contains no runtime Git publication or static Skill-target workflow', async () => {
    const runtime = await readFile(resolve(packageRoot, 'dist/index.mjs'), 'utf8')

    expect(runtime).not.toMatch(
      /GitSkillSource|no configured Git source|refs\/evoforge\/generations|feedbackDraftRoot|shadowTargets|evaluatorTargets/u,
    )
  })
})
