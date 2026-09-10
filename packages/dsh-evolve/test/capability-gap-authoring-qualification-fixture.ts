import { createHash } from 'node:crypto'
import {
  CAPABILITY_GAP_AUTHORING_TOOL_CONTRACT_DIGEST_V1,
  capabilityGapIdV1,
  createCapabilityGapAuthoringQualificationV2,
  type CapabilityGap,
  type CapabilityGapAuthoringQualification,
  type CapabilityGapV1,
} from '../src/capability-gap-store.ts'

type CapabilityGapFixtureInput = Omit<CapabilityGapV1, 'schemaVersion' | 'id' | 'status'>

export function qualifiedCapabilityGap(
  input: CapabilityGapFixtureInput,
  marker: string | number,
): CapabilityGap {
  const gap: CapabilityGap = {
    schemaVersion: 1,
    id: capabilityGapIdV1(input),
    ...structuredClone(input),
    status: 'confirmed',
  }
  return {
    ...gap,
    authoringQualification: completedOwnedGapTurnQualification(gap, marker),
  }
}

export function completedOwnedGapTurnQualification(
  gap: CapabilityGap,
  marker: string | number,
): CapabilityGapAuthoringQualification {
  return createCapabilityGapAuthoringQualificationV2(gap, {
    sourceDialect: 'deepseek-harness@0.1.2-alpha.5',
    subject: {
      sessionLifecycleDigest: digest('session-lifecycle', marker),
      prefixDigest: digest('prefix', marker),
      turnDigest: digest('turn', marker),
      turn: 1,
      turnStartSeq: 1,
      turnEndSeq: 8,
      triggerKind: 'successful-gap-report',
      triggerRequestSeq: 4,
      triggerCallSeq: 5,
      triggerResultSeq: 6,
    },
    provenance: {
      authorityEpochDigest: digest('authority', marker),
      registrationEpochDigest: digest('registration', marker),
      executionEpochDigest: digest('execution', marker),
      lifecycleCutoffDigest: digest('lifecycle-cutoff', marker),
      bodyValueDigest: digest('body-value', marker),
      finalResultDigest: digest('final-result', marker),
      toolContractDigest: CAPABILITY_GAP_AUTHORING_TOOL_CONTRACT_DIGEST_V1,
    },
  })
}

function digest(domain: string, marker: string | number): string {
  return createHash('sha256').update(`${domain}\0${marker}`).digest('hex')
}
