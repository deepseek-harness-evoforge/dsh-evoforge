import { createHash } from 'node:crypto'
import {
  CAPABILITY_GAP_AUTHORING_TOOL_CONTRACT_DIGEST_V1,
  capabilityGapIdV1,
  createCapabilityGapAuthoringQualificationV2,
  type CapabilityGap,
  type CapabilityGapInput,
} from '../../../packages/dsh-evolve/src/capability-gap-store.ts'
import type {} from '../../../packages/dsh-evolve/src/shadow-job-runner.ts'
import { ExperienceDrivenSkillOpportunityDiscovery } from '../../../packages/dsh-evolve/src/skill-opportunity-discovery.ts'
import { BENCHMARK_ID } from './contract-interaction-current-epoch-2.ts'

const WORKSPACE_ID = '8db5c24e-b9c3-4de5-8f53-d17f72856752'
const SKILL_NAME = 'recover-dsh-delivery'
const PINNED_EPOCH_2_MANIFEST_SHA256 = '7d5b52bb31266d42c8e8cfa7c9decdf30e46ff51a58469b3122fbfe998e7d4ea'

interface Epoch2Manifest {
  readonly schemaVersion: 1
  readonly id: typeof BENCHMARK_ID
  readonly scope: string
  readonly revisions: { readonly deepseekHarness: string }
  readonly scenario: {
    readonly skillName: string
    readonly goalCount: number
    readonly source: string
    readonly partitions: readonly string[]
  }
  readonly budget: {
    readonly proposerCalls: number
    readonly governanceCalls: number
    readonly maxOutputTokensPerCall: number
    readonly trialCountPerSubject: number
  }
  readonly hardGates: readonly string[]
}

/** Fail closed unless the complete reviewed manifest remains byte-exact. */
export function validateEpoch2ManifestSource(manifestSource: string): Epoch2Manifest {
  if (sha256(manifestSource) !== PINNED_EPOCH_2_MANIFEST_SHA256) {
    throw new Error('RP-1 epoch-2 manifest contract drift')
  }
  return JSON.parse(manifestSource) as Epoch2Manifest
}

/**
 * Resolve the deterministic epoch-2 fixture before any provider access. This
 * is fixture evidence only; the current epoch has no executable paid path.
 */
export function discoverModelDeclaredGapFixtureOpportunityBeforeProviderAccess() {
  const gaps = interactionScenarioGaps()
  const discovery = new ExperienceDrivenSkillOpportunityDiscovery({ list: () => gaps })
  const opportunities = discovery.discover(WORKSPACE_ID)
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    skillName: SKILL_NAME,
    gaps,
    opportunities,
  })
}

function interactionScenarioGaps(): CapabilityGap[] {
  return ['a', 'b', 'c', 'd', 'e'].map((suffix, index) => {
    const input: CapabilityGapInput = {
      observedAt: index + 1,
      workspaceId: WORKSPACE_ID,
      sessionId: `rp1-epoch-2-session-${suffix}`,
      requestedSkill: SKILL_NAME,
      catalogHash: sha256(JSON.stringify([BENCHMARK_ID, 'model-declared-gap-fixture-catalog-v1'])),
      catalogSize: 3,
      goal: {
        id: `rp1-epoch-2-goal-${suffix}`,
        revision: 1,
        objective: `Recover one distinct failed DSH delivery scenario ${suffix} without repeating external effects.`,
      },
      evidence: {
        kind: 'model-declared-skill-gap',
        catalog: 'complete',
        routing: 'model-declared-no-applicable-skill',
        providers: 'settled',
      },
    }
    const gap: CapabilityGap = {
      schemaVersion: 1,
      id: capabilityGapIdV1(input),
      ...input,
      status: 'confirmed',
    }
    const authoringQualification = createCapabilityGapAuthoringQualificationV2(gap, {
      sourceDialect: 'deepseek-harness@0.1.2-alpha.5' as const,
      subject: {
        sessionLifecycleDigest: sha256(JSON.stringify([BENCHMARK_ID, 'session-lifecycle', suffix])),
        prefixDigest: sha256(JSON.stringify([BENCHMARK_ID, 'prefix', suffix])),
        turnDigest: sha256(JSON.stringify([BENCHMARK_ID, 'turn', suffix])),
        turn: 1,
        turnStartSeq: 1,
        turnEndSeq: 8,
        triggerKind: 'successful-gap-report' as const,
        triggerRequestSeq: 4,
        triggerCallSeq: 5,
        triggerResultSeq: 6,
      },
      provenance: {
        authorityEpochDigest: sha256(JSON.stringify([BENCHMARK_ID, 'authority', suffix])),
        registrationEpochDigest: sha256(JSON.stringify([BENCHMARK_ID, 'registration', suffix])),
        executionEpochDigest: sha256(JSON.stringify([BENCHMARK_ID, 'execution', suffix])),
        lifecycleCutoffDigest: sha256(JSON.stringify([BENCHMARK_ID, 'lifecycle-cutoff', suffix])),
        bodyValueDigest: sha256(JSON.stringify([BENCHMARK_ID, 'body-value', suffix])),
        finalResultDigest: sha256(JSON.stringify([BENCHMARK_ID, 'final-result', suffix])),
        toolContractDigest: CAPABILITY_GAP_AUTHORING_TOOL_CONTRACT_DIGEST_V1,
      },
    })
    return Object.freeze({ ...gap, authoringQualification })
  })
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
