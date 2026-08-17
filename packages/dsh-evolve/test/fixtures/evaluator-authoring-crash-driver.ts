import { join, resolve } from 'node:path'
import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { EvaluatorDraftInbox } from '../../src/evaluator-draft-inbox.ts'
import { AutomaticEvaluatorDraftService } from '../../src/automatic-evaluator-draft.ts'
import { AutomaticEvolutionBudget } from '../../src/automatic-evolution-budget.ts'
import { hashTree } from '../../src/hash.ts'
import { WORKSPACE_ID } from '../workspace-fixture.ts'

const [fixtureRoot] = process.argv.slice(2)
if (fixtureRoot === undefined) {
  throw new Error('usage: evaluator-authoring-crash-driver <fixture-root>')
}

const root = resolve(fixtureRoot)
const signalId = '1'.repeat(64)
const sourceDraftId = '2'.repeat(64)
const generationId = '3'.repeat(64)
const skillName = 'build-dsh-plugin'
const skillDir = join(root, 'skill')
const ownedRoot = join(root, 'owned')
const contentHash = await hashTree(skillDir)
const artifact = {
  kind: 'skill' as const,
  name: skillName,
  gitCommit: '5'.repeat(40),
  treeHash: '6'.repeat(40),
}
const hooks: JobHooks[] = []
const starts: JobStart[] = []
const inbox = new EvaluatorDraftInbox({
  targets: [{
    id: 'plugin-delivery',
    workspaceId: WORKSPACE_ID,
    skill: skillName,
    root: ownedRoot,
    dshRevision: '4'.repeat(40),
  }],
  drafts: () => ({
    create: async () => ({
      created: true,
      path: join(root, 'source-draft.json'),
      draft: {
        schemaVersion: 2 as const,
        id: sourceDraftId,
        status: 'draft' as const,
        source: {
          workspaceId: WORKSPACE_ID,
          signalId,
          sessionId: 'session-private',
          messageId: 'message-private',
          feedbackVersion: '00000000-0000-4000-8000-000000000001',
          generationId,
          assistantSeq: 10,
          turn: 1,
          prefixHash: '7'.repeat(64),
        },
        target: {
          kind: 'skill' as const,
          name: skillName,
          artifact,
          contentHash,
        },
        sample: {
          userText: 'A private failing request',
          correction: 'Do the corrected behavior',
        },
        limitations: ['private'],
      },
    }),
  }),
  source: {
    resolveArtifact: async () => ({
      artifact,
      repository: root,
      path: 'skill',
      resourceBase: skillDir,
    }),
  },
})

inbox.attachJobs({
  start(spec: JobStart) {
    starts.push(spec)
    hooks.push(spec.run())
    return `evolution-${starts.length}`
  },
} as never)

const automatic = new AutomaticEvaluatorDraftService({
  evolution: {
    getGeneration: () => ({
      schemaVersion: 2,
      workspaceId: WORKSPACE_ID,
      id: generationId,
      createdAt: 1,
      artifacts: [artifact],
      evaluatorVersion: 'fixture-v1',
      policyVersion: 'fixture-v1',
      compositionFingerprint: '8'.repeat(64),
    }),
  },
  evaluator: inbox,
  signals: {
    list: () => [{
      schemaVersion: 2,
      workspaceId: WORKSPACE_ID,
      id: signalId,
      observedAt: 1,
      sessionId: 'session-private',
      messageId: 'message-private',
      feedbackVersion: '00000000-0000-4000-8000-000000000001',
      sourceUpdatedAt: 2,
      generationId,
    }],
  },
  targets: [{
    id: 'plugin-delivery',
    workspaceId: WORKSPACE_ID,
    skill: skillName,
    root: ownedRoot,
    maxAttemptsPerUtcDay: 1,
  }],
  inflight: [inbox],
  budget: new AutomaticEvolutionBudget(),
})
const receipt = await automatic.scanOnce(WORKSPACE_ID)
process.stdout.write(`${JSON.stringify(receipt)}\n`)
if (hooks[0] !== undefined) {
  const result = await hooks[0].done
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
