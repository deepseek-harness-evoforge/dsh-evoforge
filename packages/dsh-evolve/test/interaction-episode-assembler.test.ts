import { describe, expect, it } from 'vitest'
import {
  assembleInteractionEpisodeInputV1,
  type InteractionEpisodeEvidenceDimensionV1,
  type InteractionEpisodeHostBindingV1,
} from '../src/interaction-episode-assembler.ts'
import type { InteractionEpisodeTranscriptProofV1 } from '../src/interaction-episode-projector.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

describe('Interaction Episode evidence assembler', () => {
  it('assembles an explicit native Skill miss only from one complete exact Host binding', () => {
    const proof = transcriptProof('skill-tool-error')
    const binding = hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    })

    const result = assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding },
    })

    expect(result).toEqual({
      status: 'assembled',
      input: {
        workspaceId: WORKSPACE_ID,
        session: {
          id: 'session-1',
          formatVersion: 0,
          createdAt: 1_789_000_000_000,
          inheritedEventCount: 0,
          agentPreset: 'default',
        },
        source: {
          turn: 1,
          prefixThroughSeq: null,
          enqueueSeq: 0,
          turnStartSeq: 1,
          claimSeq: 2,
          initiatingMessageSeq: 4,
          triggerCallSeq: 8,
          triggerResultSeq: 9,
          turnEndSeq: 13,
          completedAt: 1_789_000_001_000,
        },
        ingress: {
          messageId: 'message-1',
          source: 'user',
          digest: '1'.repeat(64),
        },
        trigger: {
          kind: 'native-skill-miss',
          callId: 'skill-call-1',
          requestedSkill: 'publish-dsh-plugin',
          catalogHash: '2'.repeat(64),
          catalogSize: 3,
        },
        replay: {
          availability: 'source-dependent',
          transcript: 'exact',
          environment: 'sealed',
          prefixDigest: '3'.repeat(64),
          turnDigest: '4'.repeat(64),
          workspaceSnapshotDigest: '5'.repeat(64),
          compositionDigest: '6'.repeat(64),
          modelDigest: '7'.repeat(64),
          permissionDigest: '8'.repeat(64),
          sandboxDigest: '9'.repeat(64),
          budgetDigest: 'a'.repeat(64),
          dshRevision: 'b'.repeat(40),
          externalEffects: 'none',
        },
      },
    })
    if (result.status !== 'assembled') throw new Error('expected an assembled Episode input')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.input)).toBe(true)
    expect(Object.isFrozen(result.input.replay)).toBe(true)
    expect('generationId' in result.input.trigger).toBe(false)
  })

  it('maps a successful Gap report to the exact evolved Generation selected for the Session', () => {
    const proof = transcriptProof(
      'successful-gap-report',
      { id: 'goal-1', revision: 2 },
    )
    const binding = hostBinding(proof, {
      generation: {
        kind: 'evolved',
        pin: 'settled',
        generationId: 'c'.repeat(64),
      },
      routing: {
        rawTrigger: 'successful-gap-report',
        conclusion: 'model-declared-no-applicable-skill',
      },
    })

    const result = assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding },
    })

    expect(result).toMatchObject({
      status: 'assembled',
      input: {
        trigger: {
          kind: 'model-declared-skill-gap',
          generationId: 'c'.repeat(64),
        },
        goal: { id: 'goal-1', revision: 2 },
      },
    })
  })

  it('preserves the proven parent Session lineage in the assembled input', () => {
    const proof = mutableCopy(transcriptProof('skill-tool-error'))
    proof.session.parentSessionId = 'session-parent'
    const binding = hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    })

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding },
    })).toMatchObject({
      status: 'assembled',
      input: {
        session: { parentSessionId: 'session-parent' },
      },
    })
  })

  it('abstains when the Host binding is correlated to a different transcript proof', () => {
    const proof = transcriptProof('skill-tool-error')
    const binding = hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    })
    const mismatched = mutableCopy(binding)
    mismatched.subject.transcript.trigger.callId = 'another-call'

    const result = assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding: mismatched },
    })

    expect(result).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
      dimensions: ['subject'],
    })
    expect('input' in result).toBe(false)
  })

  it('abstains when the durable Host cut does not reach the proven turn end', () => {
    const proof = transcriptProof('skill-tool-error')
    const binding = hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    })
    const mismatched = mutableCopy(binding)
    mismatched.durability.throughSeq = 12

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding: mismatched },
    })).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
      dimensions: ['session-durability'],
    })
  })

  it('abstains unless external-effect coverage spans the entire Episode source cut', () => {
    const proof = transcriptProof('successful-gap-report')
    const binding = hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'successful-gap-report',
        conclusion: 'model-declared-no-applicable-skill',
      },
    })
    const mismatched = mutableCopy(binding)
    mismatched.externalEffects.fromSeq = 1

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding: mismatched },
    })).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
      dimensions: ['external-effects'],
    })
  })

  it('abstains when catalog absence was proven for a different requested Skill', () => {
    const proof = transcriptProof('skill-tool-error')
    const binding = hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    })
    const mismatched = mutableCopy(binding)
    mismatched.capability.catalog.requestedSkill.name = 'another-skill'

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding: mismatched },
    })).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
      dimensions: ['catalog'],
    })
  })

  it('abstains when the Host diagnosis contradicts the raw transcript trigger', () => {
    const proof = transcriptProof('skill-tool-error')
    const binding = hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'successful-gap-report',
        conclusion: 'model-declared-no-applicable-skill',
      },
    })

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding },
    })).toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
      dimensions: ['routing'],
    })
  })

  it('keeps a missing Host evidence dimension explicit instead of assembling a partial input', () => {
    const proof = transcriptProof('skill-tool-error')
    const binding = hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    })
    const partial = structuredClone(binding) as unknown as {
      environment: { sandboxDigest?: string }
    }
    delete partial.environment.sandboxDigest

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: {
        status: 'resolved',
        binding: partial as unknown as InteractionEpisodeHostBindingV1,
      },
    })).toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
      dimensions: ['sandbox'],
    })
  })

  it('rejects a Host abstention that does not identify any unavailable evidence', () => {
    const proof = transcriptProof('skill-tool-error')

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: {
        status: 'abstained',
        reason: 'evidence-unavailable',
        dimensions: [],
      },
    })).toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
      dimensions: ['binding'],
    })
  })

  it('preserves and freezes explicit Host abstention instead of manufacturing defaults', () => {
    const proof = transcriptProof('successful-gap-report')
    const dimensions: ('catalog' | 'sandbox')[] = ['sandbox', 'catalog']

    const result = assembleInteractionEpisodeInputV1({
      proof,
      host: {
        status: 'abstained',
        reason: 'evidence-unavailable',
        dimensions,
      },
    })
    dimensions.push('sandbox')

    expect(result).toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
      dimensions: ['catalog', 'sandbox'],
    })
    if (result.status !== 'abstained') throw new Error('expected Host evidence abstention')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.dimensions)).toBe(true)
    expect('input' in result).toBe(false)
  })

  it('does not treat an unknown Host resolution status as resolved evidence', () => {
    const proof = transcriptProof('skill-tool-error')
    const binding = hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    })

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'forged', binding } as never,
    })).toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
      dimensions: ['binding'],
    })
  })

  it('rejects malformed Host abstention diagnostics', () => {
    const proof = transcriptProof('skill-tool-error')
    const sparseDimensions = new Array<string>(1)
    const malformed: readonly unknown[] = [
      { status: 'abstained', reason: 'evidence-unavailable', dimensions: sparseDimensions },
      { status: 'abstained', reason: 'evidence-unavailable', dimensions: 'sandbox' },
      { status: 'abstained', reason: 'evidence-unavailable', dimensions: ['sandbox', 'sandbox'] },
      { status: 'abstained', reason: 'evidence-unavailable', dimensions: ['unknown'] },
      { status: 'abstained', reason: 'unknown', dimensions: ['sandbox'] },
    ]

    for (const host of malformed) {
      expect(assembleInteractionEpisodeInputV1({
        proof,
        host: host as never,
      })).toEqual({
        status: 'abstained',
        reason: 'evidence-conflict',
        dimensions: ['binding'],
      })
    }
  })

  it('never labels an Episode input assembled when the transcript proof violates the store contract', () => {
    const proof = mutableCopy(transcriptProof('skill-tool-error'))
    proof.replay.turnDigest = 'not-a-digest'
    const binding = hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    })

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding },
    })).toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
      dimensions: ['subject'],
    })
  })

  it('compares every declared proof field even when a Host object hides it from enumeration', () => {
    const proof = transcriptProof('skill-tool-error')
    const boundProof = structuredClone(proof)
    Object.defineProperty(proof.replay, 'turnDigest', {
      configurable: true,
      enumerable: false,
      value: '4'.repeat(64),
    })
    Object.defineProperty(boundProof.replay, 'turnDigest', {
      configurable: true,
      enumerable: false,
      value: 'd'.repeat(64),
    })
    const binding = hostBinding(boundProof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    })

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding },
    })).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
      dimensions: ['subject'],
    })
  })

  it('requires an explicit Host authorization for retaining Interaction evidence', () => {
    const proof = transcriptProof('skill-tool-error')
    const binding = mutableCopy(hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    })) as unknown as Record<string, unknown>
    const environment = binding.environment as Record<string, unknown>
    delete environment.permissionDigest
    environment.permission = {
      evidenceRetention: 'authorized',
      digest: '8'.repeat(64),
    }

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: {
        status: 'resolved',
        binding: binding as unknown as InteractionEpisodeHostBindingV1,
      },
    })).toMatchObject({
      status: 'assembled',
      input: { replay: { permissionDigest: '8'.repeat(64) } },
    })
  })

  it('binds catalog and Generation evidence to the trigger execution and mounted composition', () => {
    const proof = transcriptProof('successful-gap-report')
    const binding = mutableCopy(hostBinding(proof, {
      generation: {
        kind: 'evolved',
        pin: 'settled',
        generationId: 'c'.repeat(64),
      },
      routing: {
        rawTrigger: 'successful-gap-report',
        conclusion: 'model-declared-no-applicable-skill',
      },
    })) as unknown as Record<string, unknown>
    const capability = binding.capability as Record<string, unknown>
    capability.observation = {
      boundary: 'trigger-assistant-and-tool-pair',
      triggerRequestSeq: 7,
      triggerCallSeq: 8,
      triggerResultSeq: 9,
      compositionDigest: '6'.repeat(64),
    }
    const generation = capability.generation as Record<string, unknown>
    generation.effectiveMount = {
      kind: 'evolved',
      generationId: 'c'.repeat(64),
    }

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: {
        status: 'resolved',
        binding: binding as unknown as InteractionEpisodeHostBindingV1,
      },
    })).toMatchObject({
      status: 'assembled',
      input: {
        trigger: {
          kind: 'model-declared-skill-gap',
          generationId: 'c'.repeat(64),
        },
      },
    })
  })

  it('accepts external-effect absence only after exhaustive execution coverage settles', () => {
    const proof = transcriptProof('skill-tool-error')
    const binding = mutableCopy(hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    })) as unknown as Record<string, unknown>
    binding.externalEffects = {
      coverage: 'all-effect-capable-tools-and-providers',
      compositionDigest: '6'.repeat(64),
      fromSeq: 0,
      throughSeq: 13,
      pending: 'none',
      uncertain: 'none',
      result: 'none',
    }

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: {
        status: 'resolved',
        binding: binding as unknown as InteractionEpisodeHostBindingV1,
      },
    })).toMatchObject({
      status: 'assembled',
      input: { replay: { externalEffects: 'none' } },
    })
  })

  it('rejects every weakened semantic Host evidence literal', () => {
    const proof = transcriptProof('skill-tool-error')
    const cases: readonly {
      readonly path: readonly string[]
      readonly value: unknown
      readonly dimension: InteractionEpisodeEvidenceDimensionV1
    }[] = [
      { path: ['schemaVersion'], value: 2, dimension: 'binding' },
      { path: ['kind'], value: 'other-binding', dimension: 'binding' },
      { path: ['durability', 'session'], value: 'memory-only', dimension: 'session-durability' },
      {
        path: ['capability', 'observation', 'boundary'],
        value: 'latest-observation',
        dimension: 'capability-boundary',
      },
      { path: ['capability', 'catalog', 'status'], value: 'incomplete', dimension: 'catalog' },
      { path: ['capability', 'catalog', 'providers'], value: 'pending', dimension: 'catalog' },
      {
        path: ['capability', 'catalog', 'requestedSkill', 'presence'],
        value: 'present',
        dimension: 'catalog',
      },
      { path: ['capability', 'generation', 'pin'], value: 'pending', dimension: 'generation' },
      {
        path: ['capability', 'generation', 'effectiveMount', 'kind'],
        value: 'evolved',
        dimension: 'generation',
      },
      {
        path: ['capability', 'routing', 'conclusion'],
        value: 'model-declared-no-applicable-skill',
        dimension: 'routing',
      },
      {
        path: ['environment', 'coverage'],
        value: 'partial-replay-cut',
        dimension: 'replay-environment',
      },
      {
        path: ['environment', 'workspaceSnapshot', 'at'],
        value: 'after-turn',
        dimension: 'workspace-snapshot',
      },
      {
        path: ['environment', 'permission', 'evidenceRetention'],
        value: 'denied',
        dimension: 'permissions',
      },
      {
        path: ['externalEffects', 'coverage'],
        value: 'host-journal-only',
        dimension: 'external-effects',
      },
      { path: ['externalEffects', 'pending'], value: 'present', dimension: 'external-effects' },
      { path: ['externalEffects', 'uncertain'], value: 'present', dimension: 'external-effects' },
      { path: ['externalEffects', 'result'], value: 'observed', dimension: 'external-effects' },
    ]

    for (const testCase of cases) {
      const binding = mutableCopy(hostBinding(proof, {
        generation: { kind: 'native', pin: 'settled' },
        routing: {
          rawTrigger: 'skill-tool-error',
          conclusion: 'requested-skill-absent',
        },
      }))
      setAtPath(binding, testCase.path, testCase.value)

      expect(assembleInteractionEpisodeInputV1({
        proof,
        host: { status: 'resolved', binding },
      })).toEqual({
        status: 'abstained',
        reason: 'evidence-conflict',
        dimensions: [testCase.dimension],
      })
    }
  })

  it('rejects weakened literals in the evolved Generation and successful Gap route', () => {
    const proof = transcriptProof('successful-gap-report')
    const cases: readonly {
      readonly path: readonly string[]
      readonly value: unknown
      readonly dimension: InteractionEpisodeEvidenceDimensionV1
    }[] = [
      { path: ['capability', 'generation', 'pin'], value: 'pending', dimension: 'generation' },
      {
        path: ['capability', 'generation', 'effectiveMount', 'kind'],
        value: 'native',
        dimension: 'generation',
      },
      {
        path: ['capability', 'routing', 'conclusion'],
        value: 'requested-skill-absent',
        dimension: 'routing',
      },
    ]

    for (const testCase of cases) {
      const binding = mutableCopy(hostBinding(proof, {
        generation: {
          kind: 'evolved',
          pin: 'settled',
          generationId: 'c'.repeat(64),
        },
        routing: {
          rawTrigger: 'successful-gap-report',
          conclusion: 'model-declared-no-applicable-skill',
        },
      }))
      setAtPath(binding, testCase.path, testCase.value)

      expect(assembleInteractionEpisodeInputV1({
        proof,
        host: { status: 'resolved', binding },
      })).toEqual({
        status: 'abstained',
        reason: 'evidence-conflict',
        dimensions: [testCase.dimension],
      })
    }
  })

  it('requires the evolved Generation and successful Gap route literals', () => {
    const proof = transcriptProof('successful-gap-report')
    const paths: readonly {
      readonly path: readonly string[]
      readonly dimension: InteractionEpisodeEvidenceDimensionV1
    }[] = [
      { path: ['capability', 'generation', 'pin'], dimension: 'generation' },
      {
        path: ['capability', 'generation', 'effectiveMount', 'kind'],
        dimension: 'generation',
      },
      { path: ['capability', 'routing', 'conclusion'], dimension: 'routing' },
    ]

    for (const testCase of paths) {
      const binding = mutableCopy(hostBinding(proof, {
        generation: {
          kind: 'evolved',
          pin: 'settled',
          generationId: 'c'.repeat(64),
        },
        routing: {
          rawTrigger: 'successful-gap-report',
          conclusion: 'model-declared-no-applicable-skill',
        },
      }))
      deleteAtPath(binding, testCase.path)

      expect(assembleInteractionEpisodeInputV1({
        proof,
        host: { status: 'resolved', binding },
      })).toEqual({
        status: 'abstained',
        reason: 'evidence-unavailable',
        dimensions: [testCase.dimension],
      })
    }
  })

  it('reports every absent Host evidence dimension instead of silently defaulting it', () => {
    const proof = transcriptProof('skill-tool-error')
    const cases: readonly {
      readonly path: readonly string[]
      readonly dimension: InteractionEpisodeEvidenceDimensionV1
    }[] = [
      { path: ['schemaVersion'], dimension: 'binding' },
      { path: ['kind'], dimension: 'binding' },
      { path: ['subject', 'workspaceId'], dimension: 'workspace' },
      { path: ['subject', 'transcript'], dimension: 'subject' },
      { path: ['durability', 'session'], dimension: 'session-durability' },
      { path: ['durability', 'throughSeq'], dimension: 'session-durability' },
      { path: ['capability', 'observation'], dimension: 'capability-boundary' },
      { path: ['capability', 'observation', 'boundary'], dimension: 'capability-boundary' },
      { path: ['capability', 'catalog', 'hash'], dimension: 'catalog' },
      { path: ['capability', 'catalog', 'status'], dimension: 'catalog' },
      { path: ['capability', 'catalog', 'providers'], dimension: 'catalog' },
      {
        path: ['capability', 'catalog', 'requestedSkill', 'presence'],
        dimension: 'catalog',
      },
      { path: ['capability', 'generation'], dimension: 'generation' },
      { path: ['capability', 'generation', 'pin'], dimension: 'generation' },
      {
        path: ['capability', 'generation', 'effectiveMount', 'kind'],
        dimension: 'generation',
      },
      { path: ['capability', 'routing'], dimension: 'routing' },
      { path: ['capability', 'routing', 'conclusion'], dimension: 'routing' },
      { path: ['environment', 'coverage'], dimension: 'replay-environment' },
      { path: ['environment', 'workspaceSnapshot', 'at'], dimension: 'workspace-snapshot' },
      { path: ['environment', 'workspaceSnapshot', 'digest'], dimension: 'workspace-snapshot' },
      { path: ['environment', 'compositionDigest'], dimension: 'composition' },
      { path: ['environment', 'modelDigest'], dimension: 'model' },
      { path: ['environment', 'permission'], dimension: 'permissions' },
      { path: ['environment', 'permission', 'evidenceRetention'], dimension: 'permissions' },
      { path: ['environment', 'sandboxDigest'], dimension: 'sandbox' },
      { path: ['environment', 'budgetDigest'], dimension: 'budget' },
      { path: ['environment', 'dshRevision'], dimension: 'dsh-revision' },
      { path: ['externalEffects'], dimension: 'external-effects' },
      { path: ['externalEffects', 'coverage'], dimension: 'external-effects' },
      { path: ['externalEffects', 'fromSeq'], dimension: 'external-effects' },
      { path: ['externalEffects', 'throughSeq'], dimension: 'external-effects' },
      { path: ['externalEffects', 'pending'], dimension: 'external-effects' },
      { path: ['externalEffects', 'uncertain'], dimension: 'external-effects' },
    ]

    for (const testCase of cases) {
      const binding = mutableCopy(hostBinding(proof, {
        generation: { kind: 'native', pin: 'settled' },
        routing: {
          rawTrigger: 'skill-tool-error',
          conclusion: 'requested-skill-absent',
        },
      }))
      deleteAtPath(binding, testCase.path)

      expect(assembleInteractionEpisodeInputV1({
        proof,
        host: { status: 'resolved', binding },
      })).toEqual({
        status: 'abstained',
        reason: 'evidence-unavailable',
        dimensions: [testCase.dimension],
      })
    }
  })

  it('accepts durability and effect evidence that covers beyond the target turn', () => {
    const proof = transcriptProof('successful-gap-report')
    const binding = mutableCopy(hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'successful-gap-report',
        conclusion: 'model-declared-no-applicable-skill',
      },
    }))
    binding.durability.throughSeq = 20
    binding.externalEffects.throughSeq = 20

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding },
    })).toMatchObject({ status: 'assembled' })
  })

  it('rejects external-effect evidence that stops before the target turn completes', () => {
    const proof = transcriptProof('skill-tool-error')
    const binding = mutableCopy(hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    }))
    binding.externalEffects.throughSeq = 12

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding },
    })).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
      dimensions: ['external-effects'],
    })
  })

  it('rejects stale execution coordinates and composition evidence', () => {
    const proof = transcriptProof('successful-gap-report')
    const cases: readonly {
      readonly path: readonly string[]
      readonly value: unknown
      readonly reason: 'subject-mismatch' | 'evidence-conflict'
      readonly dimensions: readonly InteractionEpisodeEvidenceDimensionV1[]
    }[] = [
      {
        path: ['capability', 'observation', 'triggerRequestSeq'],
        value: 6,
        reason: 'subject-mismatch',
        dimensions: ['capability-boundary'],
      },
      {
        path: ['capability', 'observation', 'triggerRequestSeq'],
        value: 8,
        reason: 'subject-mismatch',
        dimensions: ['capability-boundary'],
      },
      {
        path: ['capability', 'observation', 'triggerCallSeq'],
        value: 7,
        reason: 'subject-mismatch',
        dimensions: ['capability-boundary'],
      },
      {
        path: ['capability', 'observation', 'triggerCallSeq'],
        value: 9,
        reason: 'subject-mismatch',
        dimensions: ['capability-boundary'],
      },
      {
        path: ['capability', 'observation', 'triggerResultSeq'],
        value: 10,
        reason: 'subject-mismatch',
        dimensions: ['capability-boundary'],
      },
      {
        path: ['capability', 'observation', 'triggerResultSeq'],
        value: 8,
        reason: 'subject-mismatch',
        dimensions: ['capability-boundary'],
      },
      {
        path: ['capability', 'observation', 'compositionDigest'],
        value: 'e'.repeat(64),
        reason: 'evidence-conflict',
        dimensions: ['capability-boundary', 'composition'],
      },
      {
        path: ['externalEffects', 'compositionDigest'],
        value: 'e'.repeat(64),
        reason: 'evidence-conflict',
        dimensions: ['external-effects'],
      },
    ]

    for (const testCase of cases) {
      const binding = mutableCopy(hostBinding(proof, {
        generation: { kind: 'native', pin: 'settled' },
        routing: {
          rawTrigger: 'successful-gap-report',
          conclusion: 'model-declared-no-applicable-skill',
        },
      }))
      setAtPath(binding, testCase.path, testCase.value)

      expect(assembleInteractionEpisodeInputV1({
        proof,
        host: { status: 'resolved', binding },
      })).toEqual({
        status: 'abstained',
        reason: testCase.reason,
        dimensions: testCase.dimensions,
      })
    }
  })

  it('rejects a matching capability observation outside the trigger causal interval', () => {
    const requestSeqs = [3, 4, 8, 14]

    for (const requestSeq of requestSeqs) {
      const proof = mutableCopy(transcriptProof('successful-gap-report'))
      proof.witness.triggerRequestSeq = requestSeq
      proof.witness.assistantRequestRoutes[0]!.assistantMessageSeq = requestSeq
      const binding = mutableCopy(hostBinding(proof, {
        generation: { kind: 'native', pin: 'settled' },
        routing: {
          rawTrigger: 'successful-gap-report',
          conclusion: 'model-declared-no-applicable-skill',
        },
      }))
      binding.capability.observation.triggerRequestSeq = requestSeq

      expect(assembleInteractionEpisodeInputV1({
        proof,
        host: { status: 'resolved', binding },
      })).toEqual({
        status: 'abstained',
        reason: 'evidence-conflict',
        dimensions: ['capability-boundary'],
      })
    }
  })

  it('rejects a trigger request coordinate that is absent from the proven assistant routes', () => {
    const proof = mutableCopy(transcriptProof('successful-gap-report'))
    proof.witness.triggerRequestSeq = 6
    const binding = mutableCopy(hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'successful-gap-report',
        conclusion: 'model-declared-no-applicable-skill',
      },
    }))
    binding.capability.observation.triggerRequestSeq = 6

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding },
    })).toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
      dimensions: ['capability-boundary'],
    })
  })

  it('rejects an ambiguous trigger request coordinate shared by two assistant routes', () => {
    const proof = mutableCopy(transcriptProof('successful-gap-report'))
    proof.witness.assistantRequestRoutes.push({
      assistantMessageSeq: proof.witness.triggerRequestSeq,
      headerSeq: 1,
      contextSeq: 2,
    })
    const binding = hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'successful-gap-report',
        conclusion: 'model-declared-no-applicable-skill',
      },
    })

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding },
    })).toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
      dimensions: ['capability-boundary'],
    })
  })

  it('rejects an evolved Generation pin that differs from the effective mounted tree', () => {
    const proof = transcriptProof('successful-gap-report')
    const binding = mutableCopy(hostBinding(proof, {
      generation: {
        kind: 'evolved',
        pin: 'settled',
        generationId: 'c'.repeat(64),
      },
      routing: {
        rawTrigger: 'successful-gap-report',
        conclusion: 'model-declared-no-applicable-skill',
      },
    }))
    if (binding.capability.generation.kind !== 'evolved') throw new Error('expected evolved fixture')
    binding.capability.generation.effectiveMount.generationId = 'd'.repeat(64)

    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding },
    })).toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
      dimensions: ['generation'],
    })
  })

  it('converts hostile Host data access into a fail-closed result', () => {
    const proof = transcriptProof('skill-tool-error')
    const binding = hostBinding(proof, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    })
    const hostile = new Proxy(binding, {
      get() {
        throw new Error('host binding getter failed')
      },
    })

    expect(() => assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding: hostile },
    })).not.toThrow()
    expect(assembleInteractionEpisodeInputV1({
      proof,
      host: { status: 'resolved', binding: hostile },
    })).toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
      dimensions: ['binding'],
    })
  })

  it('snapshots the proof before correlation so a time-varying Proxy cannot swap output', () => {
    const original = transcriptProof('skill-tool-error')
    const swappedTrigger = {
      ...original.trigger,
      callId: 'swapped-call',
      requestedSkill: 'another-skill',
    }
    let triggerReads = 0
    const changingProof = new Proxy(original, {
      get(target, property, receiver) {
        if (property === 'trigger') {
          triggerReads += 1
          return triggerReads <= 2 ? target.trigger : swappedTrigger
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const baseBinding = hostBinding(original, {
      generation: { kind: 'native', pin: 'settled' },
      routing: {
        rawTrigger: 'skill-tool-error',
        conclusion: 'requested-skill-absent',
      },
    })
    const binding: InteractionEpisodeHostBindingV1 = {
      ...baseBinding,
      subject: {
        ...baseBinding.subject,
        transcript: changingProof,
      },
    }

    expect(assembleInteractionEpisodeInputV1({
      proof: changingProof,
      host: { status: 'resolved', binding },
    })).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
      dimensions: ['subject'],
    })
  })

  it('rejects malformed identities, coordinates, and content digests by evidence dimension', () => {
    const proof = transcriptProof('skill-tool-error')
    const cases: readonly {
      readonly path: readonly string[]
      readonly value: unknown
      readonly dimension: InteractionEpisodeEvidenceDimensionV1
      readonly evolved?: boolean
    }[] = [
      { path: ['subject', 'workspaceId'], value: 'not-a-workspace', dimension: 'workspace' },
      { path: ['durability', 'throughSeq'], value: -1, dimension: 'session-durability' },
      { path: ['durability', 'throughSeq'], value: 13.5, dimension: 'session-durability' },
      {
        path: ['durability', 'throughSeq'],
        value: Number.MAX_SAFE_INTEGER + 1,
        dimension: 'session-durability',
      },
      {
        path: ['capability', 'observation', 'triggerRequestSeq'],
        value: -1,
        dimension: 'capability-boundary',
      },
      { path: ['capability', 'catalog', 'hash'], value: 'bad', dimension: 'catalog' },
      { path: ['capability', 'catalog', 'size'], value: -1, dimension: 'catalog' },
      {
        path: ['capability', 'catalog', 'requestedSkill', 'name'],
        value: 'Bad Skill',
        dimension: 'catalog',
      },
      {
        path: ['capability', 'generation', 'generationId'],
        value: 'bad',
        dimension: 'generation',
        evolved: true,
      },
      {
        path: ['capability', 'generation', 'effectiveMount', 'generationId'],
        value: 'bad',
        dimension: 'generation',
        evolved: true,
      },
      {
        path: ['environment', 'workspaceSnapshot', 'digest'],
        value: 'bad',
        dimension: 'workspace-snapshot',
      },
      { path: ['environment', 'compositionDigest'], value: 'bad', dimension: 'composition' },
      { path: ['environment', 'modelDigest'], value: 'bad', dimension: 'model' },
      { path: ['environment', 'permission', 'digest'], value: 'bad', dimension: 'permissions' },
      { path: ['environment', 'sandboxDigest'], value: 'bad', dimension: 'sandbox' },
      { path: ['environment', 'budgetDigest'], value: 'bad', dimension: 'budget' },
      { path: ['environment', 'dshRevision'], value: 'bad', dimension: 'dsh-revision' },
      {
        path: ['externalEffects', 'compositionDigest'],
        value: 'bad',
        dimension: 'external-effects',
      },
      { path: ['externalEffects', 'fromSeq'], value: -1, dimension: 'external-effects' },
      { path: ['externalEffects', 'throughSeq'], value: -1, dimension: 'external-effects' },
    ]

    for (const testCase of cases) {
      const generation = testCase.evolved === true
        ? { kind: 'evolved' as const, pin: 'settled' as const, generationId: 'c'.repeat(64) }
        : { kind: 'native' as const, pin: 'settled' as const }
      const binding = mutableCopy(hostBinding(proof, {
        generation,
        routing: {
          rawTrigger: 'skill-tool-error',
          conclusion: 'requested-skill-absent',
        },
      }))
      setAtPath(binding, testCase.path, testCase.value)

      expect(assembleInteractionEpisodeInputV1({
        proof,
        host: { status: 'resolved', binding },
      })).toEqual({
        status: 'abstained',
        reason: 'evidence-conflict',
        dimensions: [testCase.dimension],
      })
    }
  })
})

function transcriptProof(
  kind: InteractionEpisodeTranscriptProofV1['trigger']['kind'],
  goal?: InteractionEpisodeTranscriptProofV1['goal'],
): InteractionEpisodeTranscriptProofV1 {
  return {
    session: {
      id: 'session-1',
      formatVersion: 0,
      createdAt: 1_789_000_000_000,
      inheritedEventCount: 0,
      agentPreset: 'default',
    },
    source: {
      turn: 1,
      prefixThroughSeq: null,
      enqueueSeq: 0,
      turnStartSeq: 1,
      claimSeq: 2,
      initiatingMessageSeq: 4,
      triggerCallSeq: 8,
      triggerResultSeq: 9,
      turnEndSeq: 13,
      completedAt: 1_789_000_001_000,
    },
    witness: {
      admissionStepStartSeq: 3,
      triggerRequestSeq: 7,
      assistantRequestRoutes: [{
        assistantMessageSeq: 7,
        headerSeq: 5,
        contextSeq: 6,
      }],
    },
    ingress: {
      messageId: 'message-1',
      source: 'user',
      digest: '1'.repeat(64),
    },
    trigger: {
      kind,
      callId: 'skill-call-1',
      requestedSkill: 'publish-dsh-plugin',
    },
    replay: {
      availability: 'source-dependent',
      transcript: 'exact',
      prefixDigest: '3'.repeat(64),
      turnDigest: '4'.repeat(64),
    },
    ...(goal === undefined ? {} : { goal }),
  }
}

function hostBinding(
  proof: InteractionEpisodeTranscriptProofV1,
  capability: HostBindingFixtureCapability,
): InteractionEpisodeHostBindingV1 {
  const generation: InteractionEpisodeHostBindingV1['capability']['generation'] =
    capability.generation.kind === 'native'
      ? {
        ...capability.generation,
        effectiveMount: { kind: 'native' },
      }
      : {
        ...capability.generation,
        effectiveMount: {
          kind: 'evolved',
          generationId: capability.generation.generationId,
        },
      }
  return {
    schemaVersion: 1,
    kind: 'interaction-episode-host-binding-v1',
    subject: { workspaceId: WORKSPACE_ID, transcript: structuredClone(proof) },
    durability: {
      session: 'flushed-through-turn-end',
      throughSeq: 13,
    },
    capability: {
      observation: {
        boundary: 'trigger-assistant-and-tool-pair',
        triggerRequestSeq: 7,
        triggerCallSeq: 8,
        triggerResultSeq: 9,
        compositionDigest: '6'.repeat(64),
      },
      catalog: {
        status: 'complete',
        providers: 'settled',
        hash: '2'.repeat(64),
        size: 3,
        requestedSkill: {
          name: 'publish-dsh-plugin',
          presence: 'absent',
        },
      },
      generation,
      routing: capability.routing,
    },
    environment: {
      coverage: 'complete-replay-cut',
      workspaceSnapshot: {
        at: 'before-inbox-insertion',
        digest: '5'.repeat(64),
      },
      compositionDigest: '6'.repeat(64),
      modelDigest: '7'.repeat(64),
      permission: {
        evidenceRetention: 'authorized',
        digest: '8'.repeat(64),
      },
      sandboxDigest: '9'.repeat(64),
      budgetDigest: 'a'.repeat(64),
      dshRevision: 'b'.repeat(40),
    },
    externalEffects: {
      coverage: 'all-effect-capable-tools-and-providers',
      compositionDigest: '6'.repeat(64),
      fromSeq: 0,
      throughSeq: 13,
      pending: 'none',
      uncertain: 'none',
      result: 'none',
    },
  }
}

interface HostBindingFixtureCapability {
  readonly generation:
    | { readonly kind: 'native'; readonly pin: 'settled' }
    | {
      readonly kind: 'evolved'
      readonly pin: 'settled'
      readonly generationId: string
    }
  readonly routing: InteractionEpisodeHostBindingV1['capability']['routing']
}

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T

function mutableCopy<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>
}

function setAtPath(root: object, path: readonly string[], value: unknown): void {
  let target: object = root
  for (const key of path.slice(0, -1)) {
    const child = Reflect.get(target, key)
    if (child === null || typeof child !== 'object') throw new Error(`missing fixture path '${key}'`)
    target = child
  }
  const finalKey = path.at(-1)
  if (finalKey === undefined) throw new Error('fixture mutation path must not be empty')
  Reflect.set(target, finalKey, value)
}

function deleteAtPath(root: object, path: readonly string[]): void {
  let target: object = root
  for (const key of path.slice(0, -1)) {
    const child = Reflect.get(target, key)
    if (child === null || typeof child !== 'object') throw new Error(`missing fixture path '${key}'`)
    target = child
  }
  const finalKey = path.at(-1)
  if (finalKey === undefined) throw new Error('fixture deletion path must not be empty')
  Reflect.deleteProperty(target, finalKey)
}
