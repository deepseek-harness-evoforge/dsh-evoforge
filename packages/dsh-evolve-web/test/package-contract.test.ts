import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('installable DSH bundle', () => {
  it('installs the host runtime and global Web adapter as one removable profile layer', async () => {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
    expect(manifest.dsh?.bundle).toEqual({ patch: './cordis.patch.yml' })
    expect(manifest.dependencies?.['dsh-evolve']).toBeUndefined()
    expect(manifest.peerDependencies?.['dsh-evolve']).toBe('0.1.0-alpha.1')
    expect(manifest.files).toContain('cordis.patch.yml')

    expect(await readFile(resolve(packageRoot, 'cordis.patch.yml'), 'utf8')).toBe(
      "- insert:\n"
      + "    - id: evoforge-evolution-web\n"
      + "      name: dsh-evolve-web\n",
    )
  })

  it('keeps the real-browser bootstrap test-only and loads the installed host artifact', async () => {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
    expect(manifest.files).not.toContain('test')

    const bootstrap = await readFile(resolve(packageRoot, 'test/fixtures/browser-workspace-bootstrap.mjs'), 'utf8')
    expect(bootstrap).toContain('pathToFileURL(config.evolveEntry)')
    expect(bootstrap).not.toContain("from 'dsh-evolve'")

    const overlay = await readFile(resolve(packageRoot, 'test/fixtures/cordis.patch.yml'), 'utf8')
    expect(overlay).toContain("- id: typert-loader\n  name: '@deepseek-ai/dsh-typert-loader'")
    expect(overlay).toContain('packages:\n      - dsh-evolve')
    expect(overlay).toContain('name: __EVOFORGE_BROWSER_BOOTSTRAP__')
    expect(overlay).toContain('evolveEntry: __EVOFORGE_INSTALLED_ENTRY__')
    expect(overlay).toContain('agentEntry: __EVOFORGE_DSH_AGENT_ENTRY__')
    expect(overlay).toContain('seedGoalMetrics: true')
    expect(overlay).toContain('seedCapabilityGaps: true')
    expect(overlay).toContain('seedSkillEvaluationRuns: true')
    expect(overlay).toContain('seedExistingSkillHoldoutEvaluation: true')
    expect(overlay).toContain('seedExistingSkillRetentionEvaluation: true')
    expect(overlay).toContain('seedExistingSkillRelease: true')
    expect(overlay).toContain('seedExistingSkillCounterfactualCanary: true')
    expect(overlay).toContain('retentionStatus: retained')
    expect(overlay).toContain('governanceRoot: __EVOFORGE_GOVERNANCE_ROOT__')
    expect(overlay).not.toContain('name: !!js')

    expect(bootstrap).toContain('if (config.seedGoalMetrics === true)')
    expect(bootstrap).toContain('const capabilitySeedTask = config.seedCapabilityGaps === true')
    expect(bootstrap).toContain('if (config.seedSkillEvaluationRuns === true)')
    expect(bootstrap).toContain('seedExactSkillEvaluationRuns')
    expect(bootstrap).toContain('seedExistingSkillHoldoutEvaluation')
    expect(bootstrap).toContain('seedExistingSkillRetentionEvaluation')
    expect(bootstrap).toContain('seedExistingSkillReleaseCandidate')
    expect(bootstrap).toContain('seedExistingSkillCounterfactualCanary')
    expect(bootstrap).toContain('existing-skill-counterfactual-canary-result-v1')
    expect(bootstrap).toContain('evoforge_existing_skill_candidates')
    expect(bootstrap).toContain("join(config.governanceRoot, 'candidate-vault')")
    expect(bootstrap).toContain('existing-skill-candidate-admission-state-v1')
    expect(bootstrap).toContain("item.status === 'eligible'")
    expect(bootstrap).toContain("item.status === 'approved'")
    expect(bootstrap).not.toContain('.approveExistingSkill(')
    expect(bootstrap).not.toContain('.rejectExistingSkill(')
    expect(bootstrap).not.toContain('.promoteExistingSkill(')
    expect(bootstrap).not.toContain('.rollbackExistingSkill(')
    expect(bootstrap).toContain('existing-skill-holdout-evaluation-result-v1')
    expect(bootstrap).toContain('existing-skill-retention-evaluation-result-v1')
    expect(bootstrap).toContain('const runRoot = resolve(config.runRoot)')
    expect(bootstrap.match(/const runRoot = await realpath\(config\.runRoot\)/gu)).toBeNull()
    expect(bootstrap).toContain("../../../dsh-evolve/node_modules/tar-stream/index.js")
    expect(bootstrap).toContain('assembleBrowserSkillBundle')
    expect(bootstrap).toContain("config.retentionStatus === 'regressed'")
    expect(bootstrap).toContain("expectedPromotionStatus = retentionStatus === 'retained'")
    expect(bootstrap).toContain("ctx.get('evoforge.evolutionControl')")
    expect(bootstrap).toContain('.approveReview(workspaceId, reviewId,')
    expect(bootstrap).toContain('promotion.status !== expectedPromotionStatus')
    expect(bootstrap).toContain('promotion.reason !== expectedPromotionReason')
    expect(bootstrap).toContain('const canonicalRunRoot = await realpath(config.runRoot)')
    expect(bootstrap).toContain("ctx.emit('tools/result'")
    expect(bootstrap).toContain("agentEvents(ctx, gapAgent).waterfall(")
    expect(bootstrap).toContain("readiness?.status === 'ready-to-seal'")
    expect(bootstrap).toContain("ctx.get('evoforge.evolutionControl')")
    expect(bootstrap).toContain('ctx.agents.resume({ resumeSessionId: config.sessionId')
  })
})
