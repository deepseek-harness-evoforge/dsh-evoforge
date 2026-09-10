import { createHash } from 'node:crypto'
import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, vi } from 'vitest'
import type { DurableInteractionEpisodeSubjectV1 } from '../src/interaction-episode-evidence-resolver.ts'
import {
  compileInteractionRoutingEvidencePolicies,
  createInteractionRoutingEvidenceReceiptV1,
  createInteractionRoutingEvidenceSink,
  createInteractionRoutingEvidenceSource,
  INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1,
  INTERACTION_ROUTING_EVIDENCE_MAX_AGGREGATE_RECORDS,
  INTERACTION_ROUTING_EVIDENCE_MAX_POLICIES,
  INTERACTION_ROUTING_EVIDENCE_MAX_RECORDS_PER_WORKSPACE,
  interactionRoutingEvidenceQueryIdentityIdV1,
  interactionRoutingSessionLifecycleDigest,
  openInteractionRoutingEvidenceVault,
  type InteractionRoutingEvidenceReceiptV1,
} from '../src/interaction-routing-evidence.ts'
import { projectInteractionEpisodeTriggerRequestControlV1 } from '../src/interaction-trigger-request-control.ts'
import * as publicApi from '../src/index.ts'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'

describe('Interaction Routing evidence vault', () => {
  it('derives getter-free complete canonical query identities for producer barriers', () => {
    const first = fixtureSubject()
    const second = fixtureSubjectWithSessionId('other-routing-session')
    const firstId = interactionRoutingEvidenceQueryIdentityIdV1(first, derivedFor(first))
    const secondId = interactionRoutingEvidenceQueryIdentityIdV1(second, derivedFor(second))

    expect(firstId).toMatch(/^[a-f0-9]{64}$/u)
    expect(secondId).toMatch(/^[a-f0-9]{64}$/u)
    expect(secondId).not.toBe(firstId)

    let getterCalls = 0
    const hostile = Object.create(null) as Record<string, unknown>
    Object.defineProperty(hostile, 'session', {
      enumerable: true,
      get() {
        getterCalls += 1
        throw new Error('query identity must not invoke accessors')
      },
    })
    expect(interactionRoutingEvidenceQueryIdentityIdV1(hostile as never, {} as never))
      .toBeUndefined()
    expect(getterCalls).toBe(0)
  })

  it('compiles bounded Host policy into a default-deny authority', () => {
    const denied = compileInteractionRoutingEvidencePolicies()
    expect(denied.allows(WORKSPACE_ID)).toBe(false)
    expect(denied.routingMaxRecords(WORKSPACE_ID)).toBeUndefined()

    const allowed = compileInteractionRoutingEvidencePolicies([{
      workspaceId: WORKSPACE_ID,
      retention: { routingMaxRecords: 2 },
    }])
    expect(allowed.allows(WORKSPACE_ID)).toBe(true)
    expect(allowed.routingMaxRecords(WORKSPACE_ID)).toBe(2)
    expect(Object.isFrozen(allowed)).toBe(true)

    expect(INTERACTION_ROUTING_EVIDENCE_MAX_POLICIES).toBe(100)
    expect(INTERACTION_ROUTING_EVIDENCE_MAX_RECORDS_PER_WORKSPACE).toBe(10_000)
    expect(INTERACTION_ROUTING_EVIDENCE_MAX_AGGREGATE_RECORDS).toBe(100_000)
    expect(() => compileInteractionRoutingEvidencePolicies([
      { workspaceId: WORKSPACE_ID, retention: { routingMaxRecords: 1 } },
      { workspaceId: WORKSPACE_ID, retention: { routingMaxRecords: 2 } },
    ])).toThrow(/duplicate/u)
  })

  it('retains one frozen raw-free successful Tool receipt and resolves only Routing', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const sink = createInteractionRoutingEvidenceSink(vault)
    const source = createInteractionRoutingEvidenceSource(vault)
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const bodyValue = successfulBodyValue()
    const receipt = createInteractionRoutingEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      authorityEpoch: 'authority-one',
      registrationEpoch: 'registration-one',
      executionEpoch: 'execution-one',
      lifecycleCutoff: 0,
      bodyValue,
      finalResult: successfulFinalResult(bodyValue),
    })

    expect(Object.isFrozen(INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1)).toBe(true)
    expect(Object.isFrozen(INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1.parameters)).toBe(true)
    expect(Object.isFrozen(INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1.output)).toBe(true)
    expect(Reflect.set(
      INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1 as unknown as Record<string, unknown>,
      'name',
      'poisoned',
    )).toBe(false)
    expect(publicApi).not.toHaveProperty('INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1')

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      kind: 'interaction-routing-evidence-receipt-v1',
      observedAt: 1_022,
      sourceDialect: 'deepseek-harness@0.1.2-alpha.5',
      workspaceId: WORKSPACE_ID,
      subject: {
        sessionLifecycleDigest: interactionRoutingSessionLifecycleDigest(subject),
        loggedControlDigest: derived.triggerRequestControl.loggedControlDigest,
        turn: 1,
        turnStartSeq: 1,
        turnEndSeq: 22,
        triggerKind: 'successful-gap-report',
        triggerRequestSeq: 11,
        triggerCallSeq: 12,
        triggerResultSeq: 13,
      },
      routing: {
        rawTrigger: 'successful-gap-report',
        conclusion: 'model-declared-no-applicable-skill',
      },
      provenance: {
        authorityEpochDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        registrationEpochDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        executionEpochDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        lifecycleCutoffDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        bodyValueDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        finalResultDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        toolContractDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    })
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.subject)).toBe(true)
    const serialized = JSON.stringify(receipt)
    for (const raw of [
      'authority-one',
      'registration-one',
      'execution-one',
      'release-audit',
      'gap-call',
      'Capability Gap recorded',
      'private system control',
      '/private/workspace',
    ]) expect(serialized).not.toContain(raw)
    expect(receipt).not.toHaveProperty('events')
    expect(receipt).not.toHaveProperty('header')
    expect(receipt).not.toHaveProperty('bodyValue')
    expect(receipt).not.toHaveProperty('finalResult')

    await expect(sink.retain({
      ...receipt,
      provenance: { ...receipt.provenance, toolContractDigest: 'f'.repeat(64) },
    })).rejects.toThrow(/fixed Tool contract/u)

    expect(sink.allows(WORKSPACE_ID)).toBe(true)
    await sink.retain(receipt)
    await sink.drain()
    await expect(source.resolveRoutingEvidence(subject, derived)).resolves.toEqual({
      status: 'matched',
      fact: {
        schemaVersion: 1,
        kind: 'interaction-routing-fact-v1',
        workspaceId: WORKSPACE_ID,
        subject: {
          sessionLifecycleDigest: receipt.subject.sessionLifecycleDigest,
          prefixDigest: receipt.subject.prefixDigest,
          turnDigest: receipt.subject.turnDigest,
          loggedControlDigest: receipt.subject.loggedControlDigest,
          turnEndSeq: 22,
          triggerRequestSeq: 11,
          triggerCallSeq: 12,
          triggerResultSeq: 13,
        },
        routing: receipt.routing,
      },
    })
    expect(memory.table.size).toBe(1)
    await vault.close()
  })

  it('does not reuse a receipt across material Tool-schema key ordering', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const original = fixtureSubject()
    const originalDerived = derivedFor(original)
    await vault.retain(receiptFor(original))

    const reordered = reorderFirstToolSchemaKeys(original)
    const reorderedDerived = derivedFor(reordered)
    expect(reordered.transcript.replay.turnDigest)
      .toBe(original.transcript.replay.turnDigest)
    expect(reorderedDerived.triggerRequestControl.loggedControlDigest)
      .not.toBe(originalDerived.triggerRequestControl.loggedControlDigest)
    await expect(vault.resolveRoutingEvidence(reordered, reorderedDerived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await vault.close()
  })

  it('reopens a pre-control-digest receipt without granting it to a current query', async () => {
    const memory = memoryFacility()
    const authority = authorizedAuthority()
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const receipt = receiptFor(subject)
    const writer = await openInteractionRoutingEvidenceVault(memory.facility, { authority })
    await writer.retain(receipt)
    await writer.close()

    const entry = [...memory.table.entries()][0]
    if (entry === undefined) throw new Error('expected retained Routing receipt')
    const legacy = legacyRecordWithoutLoggedControlDigest(
      entry[1],
      'evoforge_interaction_routing_evidence',
    )
    memory.table.replace(new Map([[legacy.id, legacy]]))

    const reopened = await openInteractionRoutingEvidenceVault(memory.facility, { authority })
    await expect(reopened.resolveRoutingEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    expect(memory.table.size).toBe(1)

    await reopened.retain(receipt)
    await expect(reopened.resolveRoutingEvidence(subject, derived)).resolves.toMatchObject({
      status: 'matched',
    })
    expect(memory.table.size).toBe(2)
    await reopened.close()
  })

  it('keeps a direct resolution read failure sticky after the backend recovers', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    await vault.retain(receiptFor(subject))
    memory.table.failGetOnceForKey = [...memory.table.keys()][0]

    await expect(vault.resolveRoutingEvidence(subject, derived))
      .rejects.toThrow(/evidence read failed/u)
    await expect(vault.resolveRoutingEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    expect(vault.allows(WORKSPACE_ID)).toBe(false)
    await expect(vault.drain()).rejects.toThrow(/evidence read failed/u)
    await expect(vault.close()).rejects.toThrow(/evidence read failed/u)
    expect(memory.closeCalls).toBe(1)
  })

  it('keeps a post-prune resolution read failure sticky after the backend recovers', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(2),
    })
    const subjects = [
      fixtureSubjectWithSessionId('post-prune-first'),
      fixtureSubjectWithSessionId('post-prune-survivor'),
      fixtureSubjectWithSessionId('post-prune-third'),
    ]
    await vault.retain(receiptFor(subjects[0]!))
    await vault.retain(receiptFor(subjects[1]!))

    const deleteStarted = deferred<void>()
    const deleteGate = deferred<void>()
    memory.table.beforeDelete = async () => {
      deleteStarted.resolve()
      await deleteGate.promise
    }
    const pruning = vault.retain(receiptFor(subjects[2]!))
    await deleteStarted.promise
    const survivorKey = [...memory.table.keys()][1]!
    const initialRead = deferred<void>()
    memory.table.afterGet = key => {
      if (key === survivorKey) initialRead.resolve()
    }
    const resolution = vault.resolveRoutingEvidence(subjects[1]!, derivedFor(subjects[1]!))
    await initialRead.promise
    memory.table.failGetOnceForKey = survivorKey
    deleteGate.resolve()

    await expect(pruning).resolves.toBeUndefined()
    await expect(resolution).rejects.toThrow(/read failed after quota pruning/u)
    await expect(vault.resolveRoutingEvidence(subjects[1]!, derivedFor(subjects[1]!)))
      .resolves.toEqual({ status: 'abstained', reason: 'evidence-unavailable' })
    expect(vault.allows(WORKSPACE_ID)).toBe(false)
    await expect(vault.drain()).rejects.toThrow(/read failed after quota pruning/u)
    await expect(vault.close()).rejects.toThrow(/read failed after quota pruning/u)
    expect(memory.closeCalls).toBe(1)
  })

  it('rejects non-success outcomes and never trusts a mismatched Tool body value', () => {
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const bodyValue = successfulBodyValue()
    const base = {
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      authorityEpoch: 'authority-one',
      registrationEpoch: 'registration-one',
      executionEpoch: 'execution-one',
      lifecycleCutoff: 0,
      bodyValue,
    }

    expect(() => createInteractionRoutingEvidenceReceiptV1({
      ...base,
      finalResult: { isError: true, error: { message: 'no' }, content: [] },
    })).toThrow(/successful final result/u)
    expect(() => createInteractionRoutingEvidenceReceiptV1({
      ...base,
      finalResult: successfulFinalResult({ ...bodyValue, status: 'already-recorded' }),
    })).toThrow(/successful final result/u)
    expect(() => createInteractionRoutingEvidenceReceiptV1({
      ...base,
      finalResult: { ...successfulFinalResult(bodyValue), unexpected: true },
    })).toThrow(/successful final result/u)
    expect(() => createInteractionRoutingEvidenceReceiptV1({
      ...base,
      finalResult: { ...successfulFinalResult(bodyValue), concludesTurn: false },
    })).toThrow(/successful final result/u)
    expect(() => createInteractionRoutingEvidenceReceiptV1({
      ...base,
      lifecycleCutoff: 2,
      finalResult: successfulFinalResult(bodyValue),
    })).toThrow(/lifecycle cutoff/u)
  })

  it('rejects matching body/final values outside the fixed Tool output contract', () => {
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const base = {
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      authorityEpoch: 'authority-one',
      registrationEpoch: 'registration-one',
      executionEpoch: 'execution-one',
      lifecycleCutoff: 0,
    }
    const malformed = [
      { status: 'unknown', gapId: '5'.repeat(64), requestedSkill: 'release-audit' },
      { status: 'queued', gapId: 'not-a-content-id', requestedSkill: 'release-audit' },
      { status: 'queued', gapId: '5'.repeat(64), requestedSkill: 'Release Audit' },
      { status: 'queued', gapId: '5'.repeat(64), requestedSkill: 'release-audit', extra: true },
      {
        status: 'abstained', gapId: '5'.repeat(64), requestedSkill: 'release-audit',
        reason: 'some-other-reason',
      },
    ]
    for (const bodyValue of malformed) {
      expect(() => createInteractionRoutingEvidenceReceiptV1({
        ...base,
        bodyValue,
        finalResult: successfulFinalResult(bodyValue),
      })).toThrow(/Tool body value/u)
    }
  })

  it('returns unavailable for a valid native Skill miss and conflict for malformed queries', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const skillMiss = fixtureSkillMissSubject()
    await expect(vault.resolveRoutingEvidence(skillMiss, derivedFor(skillMiss))).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    expect(() => receiptFor(skillMiss)).toThrow(/successful gap report/u)

    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const inconsistent = {
      triggerRequestControl: {
        ...derived.triggerRequestControl,
        loggedControlDigest: 'f'.repeat(64),
      },
    }
    await expect(vault.resolveRoutingEvidence(subject, inconsistent)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    const getter = vi.fn(() => fixtureSubject().session)
    const hostile = {
      schemaVersion: 1,
      kind: 'durable-interaction-episode-subject-v1',
      get session() { return getter() },
      transcript: subject.transcript,
    }
    await expect(vault.resolveRoutingEvidence(hostile as never, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    expect(getter).not.toHaveBeenCalled()
    await vault.close()
  })

  it('deduplicates exact receipts and makes any divergent provenance sticky', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const first = receiptFor(subject)
    await Promise.all([vault.retain(first), vault.retain(first)])
    expect(memory.table.size).toBe(1)

    const bodyValue = successfulBodyValue()
    const divergent = createInteractionRoutingEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived: derivedFor(subject),
      authorityEpoch: 'authority-two',
      registrationEpoch: 'registration-one',
      executionEpoch: 'execution-one',
      lifecycleCutoff: 0,
      bodyValue,
      finalResult: successfulFinalResult(bodyValue),
    })
    await vault.retain(divergent)
    expect([...memory.table.entries()][0]?.[1]).toMatchObject({ state: 'conflict' })
    await expect(vault.resolveRoutingEvidence(subject, derivedFor(subject))).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await vault.retain(first)
    expect([...memory.table.entries()][0]?.[1]).toMatchObject({ state: 'conflict' })
    await vault.close()
  })

  it('keys distinct successful trigger boundaries in one completed turn independently', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const first = receiptFor(subject)
    const second: InteractionRoutingEvidenceReceiptV1 = {
      ...first,
      subject: {
        ...first.subject,
        triggerRequestSeq: 16,
        triggerCallSeq: 17,
        triggerResultSeq: 18,
      },
    }

    await vault.retain(first)
    await vault.retain(second)

    expect(memory.table.size).toBe(2)
    expect([...memory.table.values()].every(record =>
      isRecord(record) && record.state === 'resolved')).toBe(true)
    await expect(vault.resolveRoutingEvidence(subject, derived)).resolves.toMatchObject({
      status: 'matched',
    })
    await vault.close()
  })

  it('never matches a retained timestamp that disagrees with the exact turn end', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const receipt = receiptFor(subject)
    await vault.retain({ ...receipt, observedAt: receipt.observedAt + 1 })

    await expect(vault.resolveRoutingEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await vault.close()
  })

  it('records an owned ambiguity as a sticky conflict without inventing a receipt', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const input = { workspaceId: WORKSPACE_ID, subject, derived: derivedFor(subject) }
    await vault.recordConflict(input)
    expect([...memory.table.values()][0]).toMatchObject({
      state: 'conflict',
      workspaceIds: [WORKSPACE_ID],
    })
    expect([...memory.table.values()][0]).not.toHaveProperty('receipt')
    await expect(vault.resolveRoutingEvidence(subject, input.derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await vault.retain(receiptFor(subject))
    await expect(vault.resolveRoutingEvidence(subject, input.derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await vault.close()
  })

  it('poisons contradictory Workspace ownership and keeps owners sorted', async () => {
    const memory = memoryFacility()
    const authority = compileInteractionRoutingEvidencePolicies([
      { workspaceId: WORKSPACE_ID, retention: { routingMaxRecords: 2 } },
      { workspaceId: SECOND_WORKSPACE_ID, retention: { routingMaxRecords: 2 } },
    ])
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, { authority })
    const subject = fixtureSubject()
    await vault.retain(receiptFor(subject))
    const second = {
      ...receiptFor(subject),
      workspaceId: SECOND_WORKSPACE_ID,
    }
    await vault.retain(second)
    expect([...memory.table.values()][0]).toMatchObject({
      state: 'conflict',
      workspaceIds: [WORKSPACE_ID, SECOND_WORKSPACE_ID],
    })
    await vault.close()
  })

  it('applies policy withdrawal without purging and prunes oldest resolved rows per Workspace', async () => {
    const memory = memoryFacility()
    const firstSubject = fixtureSubjectWithSessionId('first-session')
    const secondSubject = fixtureSubjectWithSessionId('second-session')
    const authorized = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    await authorized.retain(receiptFor(firstSubject))
    await authorized.retain(receiptFor(secondSubject))
    expect(memory.table.size).toBe(1)
    await expect(authorized.resolveRoutingEvidence(
      firstSubject,
      derivedFor(firstSubject),
    )).resolves.toEqual({ status: 'abstained', reason: 'evidence-unavailable' })
    await expect(authorized.resolveRoutingEvidence(
      secondSubject,
      derivedFor(secondSubject),
    )).resolves.toMatchObject({ status: 'matched' })
    await authorized.close()

    const withdrawn = await openInteractionRoutingEvidenceVault(memory.facility)
    expect(withdrawn.allows(WORKSPACE_ID)).toBe(false)
    await expect(withdrawn.resolveRoutingEvidence(
      secondSubject,
      derivedFor(secondSubject),
    )).resolves.toEqual({ status: 'abstained', reason: 'evidence-unavailable' })
    expect(memory.table.size).toBe(1)
    await withdrawn.close()
  })

  it('makes identity reads, drain, and close wait for already accepted writes', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const receipt = receiptFor(subject)
    const gate = deferred<void>()
    memory.table.beforePut = async () => gate.promise

    const retained = vault.retain(receipt)
    const resolved = vault.resolveRoutingEvidence(subject, derived)
    const drained = vault.drain()
    const closed = vault.close()
    let settled = false
    void Promise.all([retained, resolved, drained, closed]).then(() => { settled = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(memory.closeCalls).toBe(0)

    gate.resolve()
    await expect(retained).resolves.toBeUndefined()
    await expect(resolved).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await expect(drained).resolves.toBeUndefined()
    await expect(closed).resolves.toBeUndefined()
    expect(memory.closeCalls).toBe(1)
    await expect(vault.retain(receipt)).rejects.toThrow(/closing/u)
  })

  it('enrolls a write before storage can synchronously re-enter close', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const gate = deferred<void>()
    let closing: Promise<void> | undefined
    let closeSettled = false
    memory.table.onPut = () => {
      closing = vault.close()
      void closing.then(() => { closeSettled = true })
    }
    memory.table.beforePut = async () => {
      await gate.promise
    }

    const retained = vault.retain(receiptFor(fixtureSubject()))
    expect(closing).toBeDefined()
    await Promise.resolve()
    await Promise.resolve()
    expect(closeSettled).toBe(false)
    expect(memory.closeCalls).toBe(0)

    gate.resolve()
    await expect(retained).resolves.toBeUndefined()
    await expect(closing).resolves.toBeUndefined()
    expect(memory.closeCalls).toBe(1)
  })

  it('does not block an unrelated identity behind a slow accepted write', async () => {
    const memory = memoryFacility()
    const authority = compileInteractionRoutingEvidencePolicies([
      { workspaceId: WORKSPACE_ID, retention: { routingMaxRecords: 2 } },
      { workspaceId: SECOND_WORKSPACE_ID, retention: { routingMaxRecords: 2 } },
    ])
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, { authority })
    const firstSubject = fixtureSubject()
    const secondSubject = fixtureSubjectWithSessionId('already-retained-session')
    const secondDerived = derivedFor(secondSubject)
    await vault.retain({ ...receiptFor(secondSubject), workspaceId: SECOND_WORKSPACE_ID })

    const gate = deferred<void>()
    memory.table.beforePut = async () => gate.promise
    const retained = vault.retain(receiptFor(firstSubject))
    const outcome = await Promise.race([
      vault.resolveRoutingEvidence(secondSubject, secondDerived),
      new Promise<'blocked'>(resolve => setTimeout(() => resolve('blocked'), 20)),
    ])
    gate.resolve()
    await retained

    expect(outcome).toMatchObject({ status: 'matched' })
    await vault.close()
  })

  it('keeps prior evidence when a new resolved put fails before quota pruning', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    const firstSubject = fixtureSubjectWithSessionId('prior-evidence')
    const secondSubject = fixtureSubjectWithSessionId('new-evidence')
    await vault.retain(receiptFor(firstSubject))
    memory.table.failPut = value => isRecord(value) && value.state === 'resolved'

    await expect(vault.retain(receiptFor(secondSubject))).rejects.toThrow(/injected put failure/u)
    expect(memory.table.size).toBe(1)
    await expect(vault.resolveRoutingEvidence(
      firstSubject,
      derivedFor(firstSubject),
    )).resolves.toMatchObject({ status: 'matched' })

    memory.table.failPut = undefined
    memory.table.failPutAfter = value => isRecord(value) && value.state === 'resolved'
    await expect(vault.retain(receiptFor(secondSubject))).resolves.toBeUndefined()
    expect(memory.table.size).toBe(1)
    await expect(vault.resolveRoutingEvidence(
      secondSubject,
      derivedFor(secondSubject),
    )).resolves.toMatchObject({ status: 'matched' })
    await vault.close()
  })

  it('fails the live authority closed when a committed write cannot be quota-pruned', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    const firstSubject = fixtureSubjectWithSessionId('prune-first')
    const secondSubject = fixtureSubjectWithSessionId('prune-second')
    await vault.retain(receiptFor(firstSubject))
    memory.table.failDelete = true

    await expect(vault.retain(receiptFor(secondSubject))).rejects.toThrow(/pruning/u)
    expect(memory.table.size).toBe(2)
    expect(vault.allows(WORKSPACE_ID)).toBe(false)
    await expect(vault.resolveRoutingEvidence(
      secondSubject,
      derivedFor(secondSubject),
    )).resolves.toEqual({ status: 'abstained', reason: 'evidence-unavailable' })
    await expect(vault.drain()).rejects.toThrow(/pruning/u)
    await expect(vault.close()).rejects.toThrow(/pruning/u)

    memory.table.failDelete = false
    const reopened = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    expect(memory.table.size).toBe(1)
    await reopened.close()
  })

  it('fails closed when quota-enforcement reads become uncertain after commit', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    const firstSubject = fixtureSubjectWithSessionId('prune-read-first')
    const secondSubject = fixtureSubjectWithSessionId('prune-read-second')
    await vault.retain(receiptFor(firstSubject))
    memory.table.failEntries = true

    await expect(vault.retain(receiptFor(secondSubject))).rejects.toThrow(/quota pruning read failed/u)
    memory.table.failEntries = false
    const allowsAfterFailure = vault.allows(WORKSPACE_ID)
    const resolution = await vault.resolveRoutingEvidence(secondSubject, derivedFor(secondSubject))
    let drainRejected = false
    try {
      await vault.drain()
    } catch {
      drainRejected = true
    }
    let closeRejected = false
    try {
      await vault.close()
    } catch {
      closeRejected = true
    }

    expect({ allowsAfterFailure, resolution, drainRejected, closeRejected }).toEqual({
      allowsAfterFailure: false,
      resolution: { status: 'abstained', reason: 'evidence-unavailable' },
      drainRejected: true,
      closeRejected: true,
    })
  })

  it('fails closed when the selected quota victim cannot be re-read', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    const firstSubject = fixtureSubjectWithSessionId('victim-read-first')
    const secondSubject = fixtureSubjectWithSessionId('victim-read-second')
    await vault.retain(receiptFor(firstSubject))
    memory.table.failGetOnceForKey = [...memory.table.keys()][0]

    await expect(vault.retain(receiptFor(secondSubject)))
      .rejects.toThrow(/quota pruning read failed/u)
    expect(vault.allows(WORKSPACE_ID)).toBe(false)
    await expect(vault.resolveRoutingEvidence(secondSubject, derivedFor(secondSubject)))
      .resolves.toEqual({ status: 'abstained', reason: 'evidence-unavailable' })
    await expect(vault.drain()).rejects.toThrow(/quota pruning read failed/u)
    await expect(vault.close()).rejects.toThrow(/quota pruning read failed/u)
  })

  it('never quota-prunes a conflict tombstone', async () => {
    const memory = memoryFacility()
    const conflictSubject = fixtureSubjectWithSessionId('conflict-session')
    const secondSubject = fixtureSubjectWithSessionId('second-session')
    const thirdSubject = fixtureSubjectWithSessionId('third-session')
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    await vault.recordConflict({
      workspaceId: WORKSPACE_ID,
      subject: conflictSubject,
      derived: derivedFor(conflictSubject),
    })
    await vault.retain(receiptFor(secondSubject))
    await vault.retain(receiptFor(thirdSubject))
    expect(memory.table.size).toBe(2)
    expect([...memory.table.values()].filter(record =>
      isRecord(record) && record.state === 'conflict')).toHaveLength(1)
    await expect(vault.resolveRoutingEvidence(
      conflictSubject,
      derivedFor(conflictSubject),
    )).resolves.toEqual({ status: 'abstained', reason: 'evidence-conflict' })
    await vault.close()
  })

  it('revalidates queued prune victims before a concurrent conflict can erase one', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    const subjects = [
      fixtureSubjectWithSessionId('race-first'),
      fixtureSubjectWithSessionId('race-second'),
      fixtureSubjectWithSessionId('race-third'),
      fixtureSubjectWithSessionId('race-fourth'),
    ]
    await vault.retain(receiptFor(subjects[0]!))

    const secondDeleteStarted = deferred<void>()
    const secondDeleteGate = deferred<void>()
    memory.table.beforeDelete = async () => {
      if (memory.table.deleteCalls === 2) {
        secondDeleteStarted.resolve()
        await secondDeleteGate.promise
      }
    }
    const retained = subjects.slice(1).map(subject => vault.retain(receiptFor(subject)))
    await secondDeleteStarted.promise
    const conflicted = vault.recordConflict({
      workspaceId: WORKSPACE_ID,
      subject: subjects[2]!,
      derived: derivedFor(subjects[2]!),
    })
    secondDeleteGate.resolve()
    await Promise.all([...retained, conflicted])
    await vault.close()

    expect([...memory.table.values()]).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: 'conflict', recordedSeq: 3 }),
      expect.objectContaining({ state: 'resolved', recordedSeq: 4 }),
    ]))
    expect(memory.table.size).toBe(2)
    const reopened = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    await expect(reopened.resolveRoutingEvidence(subjects[2]!, derivedFor(subjects[2]!)))
      .resolves.toEqual({ status: 'abstained', reason: 'evidence-conflict' })
    expect(memory.table.size).toBe(2)
    await reopened.close()
  })

  it('fails the live authority closed when a conflict tombstone is uncertain', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    await vault.retain(receiptFor(subject))
    memory.table.failPut = value => isRecord(value) && value.state === 'conflict'
    await expect(vault.recordConflict({
      workspaceId: WORKSPACE_ID,
      subject,
      derived: derivedFor(subject),
    })).rejects.toThrow(/not committed/u)
    expect(vault.allows(WORKSPACE_ID)).toBe(false)
    await expect(vault.resolveRoutingEvidence(subject, derivedFor(subject))).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await expect(vault.drain()).rejects.toThrow(/not committed/u)
    await expect(vault.close()).rejects.toThrow(/not committed/u)
  })

  it('accepts an exact conflict tombstone found after an uncertain put and never revives it', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const receipt = receiptFor(subject)
    await vault.retain(receipt)
    memory.table.failPutAfter = value => isRecord(value) && value.state === 'conflict'

    await expect(vault.retain({
      ...receipt,
      provenance: { ...receipt.provenance, executionEpochDigest: 'f'.repeat(64) },
    })).resolves.toBeUndefined()
    await expect(vault.resolveRoutingEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await vault.close()

    memory.table.failPutAfter = undefined
    const reopened = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    await expect(reopened.resolveRoutingEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await reopened.retain(receipt)
    expect([...memory.table.values()]).toEqual([
      expect.objectContaining({ state: 'conflict' }),
    ])
    await reopened.close()
  })

  it('fails closed when an uncommitted conflict rejects with a hostile Error message', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    await vault.retain(receiptFor(subject))
    const hostile = new Error('hidden')
    Object.defineProperty(hostile, 'message', {
      configurable: true,
      get() { throw new Error('hostile message getter') },
    })
    memory.table.failPutWith = value =>
      isRecord(value) && value.state === 'conflict' ? hostile : undefined

    let rejected = false
    try {
      await vault.recordConflict({
        workspaceId: WORKSPACE_ID,
        subject,
        derived: derivedFor(subject),
      })
    } catch {
      rejected = true
    }
    const allowsAfterFailure = vault.allows(WORKSPACE_ID)
    let closeRejected = false
    try {
      await vault.close()
    } catch {
      closeRejected = true
    }

    // The backend rejected the tombstone before commit, so a fresh authority
    // may recover only the previously durable positive row.
    memory.table.failPutWith = undefined
    const reopened = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const reopenedResolution = await reopened.resolveRoutingEvidence(subject, derivedFor(subject))
    await reopened.close()

    expect({ rejected, allowsAfterFailure, closeRejected }).toEqual({
      rejected: true,
      allowsAfterFailure: false,
      closeRejected: true,
    })
    expect(reopenedResolution).toMatchObject({ status: 'matched' })
  })

  it('never invokes non-Error rejection hooks while rendering diagnostics', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    await vault.retain(receiptFor(subject))
    let hookCalls = 0
    const hostileTarget = Object.create(null) as Record<string, unknown>
    Object.defineProperty(hostileTarget, 'toJSON', {
      enumerable: true,
      get() {
        hookCalls += 1
        return () => {
          hookCalls += 1
          return { disguised: 'backend rejection' }
        }
      },
    })
    const hostile = new Proxy(hostileTarget, {
      get(target, key, receiver) {
        hookCalls += 1
        return Reflect.get(target, key, receiver)
      },
      getPrototypeOf(target) {
        hookCalls += 1
        return Reflect.getPrototypeOf(target)
      },
      ownKeys(target) {
        hookCalls += 1
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor(target, key) {
        hookCalls += 1
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
    })
    memory.table.failPutWith = value =>
      isRecord(value) && value.state === 'conflict' ? hostile : undefined

    await expect(vault.recordConflict({
      workspaceId: WORKSPACE_ID,
      subject,
      derived: derivedFor(subject),
    })).rejects.toThrow(/not committed/u)
    expect(hookCalls).toBe(0)
    expect(vault.allows(WORKSPACE_ID)).toBe(false)
    await expect(vault.close()).rejects.toThrow(/not committed/u)
  })

  it('fails closed when a resolved put rejects hostilely after leaving a different row', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const hostile = new Error('hidden')
    Object.defineProperty(hostile, 'message', {
      configurable: true,
      get() { throw new Error('hostile message getter') },
    })
    memory.table.replacePutAndFail = (_key, value) => {
      if (!isRecord(value) || value.state !== 'resolved') return undefined
      return {
        durable: { ...value, recordDigest: 'f'.repeat(64) },
        error: hostile,
      }
    }

    let rejected = false
    try {
      await vault.retain(receiptFor(subject))
    } catch {
      rejected = true
    }
    const resolution = await vault.resolveRoutingEvidence(subject, derivedFor(subject))
    let closeRejected = false
    try {
      await vault.close()
    } catch {
      closeRejected = true
    }

    expect({ rejected, allows: vault.allows(WORKSPACE_ID), resolution, closeRejected }).toEqual({
      rejected: true,
      allows: false,
      resolution: { status: 'abstained', reason: 'evidence-unavailable' },
      closeRejected: true,
    })
  })

  it('rejects forged authority and closes a corrupt durable domain on audit failure', async () => {
    const unopened = memoryFacility()
    await expect(openInteractionRoutingEvidenceVault(unopened.facility, {
      authority: { allows: () => true, routingMaxRecords: () => 10 },
    })).rejects.toThrow(/not compiled/u)
    expect(unopened.closeCalls).toBe(0)

    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    await vault.retain(receiptFor(fixtureSubject()))
    await vault.close()
    const [id, raw] = [...memory.table.entries()][0]!
    memory.table.replace(new Map([[id, {
      ...(raw as Record<string, unknown>),
      recordDigest: 'f'.repeat(64),
    }]]))
    await expect(openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })).rejects.toThrow(/integrity audit/u)
    expect(memory.closeCalls).toBe(2)
  })

  it('enforces the aggregate cap without evicting and can still poison an existing row', async () => {
    const overCap = memoryFacility()
    overCap.table.reportedSize = INTERACTION_ROUTING_EVIDENCE_MAX_AGGREGATE_RECORDS + 1
    await expect(openInteractionRoutingEvidenceVault(overCap.facility, {
      authority: authorizedAuthority(),
    })).rejects.toThrow(/aggregate safety cap/u)
    expect(overCap.closeCalls).toBe(1)
    expect(overCap.table.deleteCalls).toBe(0)

    const memory = memoryFacility()
    const vault = await openInteractionRoutingEvidenceVault(memory.facility, {
      authority: authorizedAuthority(2),
    })
    const subject = fixtureSubject()
    const receipt = receiptFor(subject)
    await vault.retain(receipt)
    memory.table.reportedSize = INTERACTION_ROUTING_EVIDENCE_MAX_AGGREGATE_RECORDS
    await vault.retain({
      ...receipt,
      provenance: { ...receipt.provenance, executionEpochDigest: 'f'.repeat(64) },
    })
    await expect(vault.retain(receiptFor(
      fixtureSubjectWithSessionId('aggregate-overflow'),
    ))).rejects.toThrow(/aggregate safety cap/u)
    expect(memory.table.deleteCalls).toBe(0)
    expect([...memory.table.values()][0]).toMatchObject({ state: 'conflict' })
    memory.table.reportedSize = undefined
    await vault.close()

    for (const name of [
      'openInteractionRoutingEvidenceVault',
      'compileInteractionRoutingEvidencePolicies',
      'createInteractionRoutingEvidenceReceiptV1',
      'createInteractionRoutingEvidenceSink',
      'createInteractionRoutingEvidenceSource',
      'interactionRoutingSessionLifecycleDigest',
      'INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1',
    ]) expect(publicApi).not.toHaveProperty(name)
  })
})

function authorizedAuthority(routingMaxRecords = 10_000) {
  return compileInteractionRoutingEvidencePolicies([{
    workspaceId: WORKSPACE_ID,
    retention: { routingMaxRecords },
  }])
}

function derivedFor(subject: DurableInteractionEpisodeSubjectV1) {
  const projection = projectInteractionEpisodeTriggerRequestControlV1(subject)
  if (projection.status !== 'projected') throw new Error('fixture did not project')
  return { triggerRequestControl: projection.fact }
}

function successfulBodyValue() {
  return {
    status: 'queued' as const,
    gapId: '5'.repeat(64),
    requestedSkill: 'release-audit',
  }
}

function successfulFinalResult<T>(value: T) {
  return {
    isError: false as const,
    value,
    content: [{ type: 'text', text: 'Capability Gap recorded.' }],
  }
}

function receiptFor(
  subject: DurableInteractionEpisodeSubjectV1,
): InteractionRoutingEvidenceReceiptV1 {
  const bodyValue = successfulBodyValue()
  return createInteractionRoutingEvidenceReceiptV1({
    workspaceId: WORKSPACE_ID,
    subject,
    derived: derivedFor(subject),
    authorityEpoch: 'authority-one',
    registrationEpoch: 'registration-one',
    executionEpoch: 'execution-one',
    lifecycleCutoff: 0,
    bodyValue,
    finalResult: successfulFinalResult(bodyValue),
  })
}

interface MutableEvidenceRecord {
  state: 'resolved' | 'conflict'
  [key: string]: unknown
}

function isRecord(value: unknown): value is MutableEvidenceRecord {
  return value !== null && typeof value === 'object' && 'state' in value
}

function legacyRecordWithoutLoggedControlDigest(
  value: unknown,
  domain: string,
): Record<string, any> & { id: string } {
  const legacy = structuredClone(value) as Record<string, any>
  delete legacy.identity.subject.loggedControlDigest
  delete legacy.receipt.subject.loggedControlDigest
  legacy.id = testHashCanonical({ domain, version: 1, identity: legacy.identity })
  delete legacy.recordDigest
  legacy.recordDigest = testHashCanonical({ domain, version: 1, record: legacy })
  return legacy as Record<string, any> & { id: string }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function memoryFacility() {
  const table = new MemoryTable<unknown>()
  const state = {
    closeCalls: 0,
    table,
    facility: {
      async open() {
        return {
          name: 'interaction-routing-evidence-test',
          global: {
            get: () => undefined,
            async set() {},
          },
          table() { return table },
          async close() { state.closeCalls += 1 },
        }
      },
    } as unknown as DomainFacility,
  }
  return state
}

class MemoryTable<V> implements KvTable<string, V> {
  private records = new Map<string, V>()
  private chain = Promise.resolve()
  reportedSize: number | undefined
  deleteCalls = 0
  failPut: ((value: V) => boolean) | undefined
  failPutWith: ((value: V) => unknown | undefined) | undefined
  failPutAfter: ((value: V) => boolean) | undefined
  replacePutAndFail: ((key: string, value: V) => {
    readonly durable: V
    readonly error: unknown
  } | undefined) | undefined
  beforePut: ((key: string, value: V) => Promise<void>) | undefined
  onPut: ((key: string, value: V) => void) | undefined
  beforeDelete: ((key: string) => Promise<void>) | undefined
  afterGet: ((key: string) => void) | undefined
  failDelete = false
  failEntries = false
  failGetOnceForKey: string | undefined

  get size(): number { return this.reportedSize ?? this.records.size }
  get(key: string): V | undefined {
    if (this.failGetOnceForKey === key) {
      this.failGetOnceForKey = undefined
      throw new Error('injected get failure')
    }
    this.afterGet?.(key)
    return this.records.get(key)
  }
  entries(): IterableIterator<[string, V]> {
    if (this.failEntries) throw new Error('injected entries failure')
    return this.records.entries()
  }
  keys(): IterableIterator<string> { return this.records.keys() }
  values(): IterableIterator<V> { return this.records.values() }
  replace(records: Map<string, V>): void { this.records = records }

  put(key: string, value: V): Promise<void> {
    this.onPut?.(key, value)
    return this.enqueue(async () => {
      await this.beforePut?.(key, value)
      const replacementFailure = this.replacePutAndFail?.(key, value)
      if (replacementFailure !== undefined) {
        this.records.set(key, structuredClone(replacementFailure.durable))
        throw replacementFailure.error
      }
      const failure = this.failPutWith?.(value)
      if (failure !== undefined) throw failure
      if (this.failPut?.(value) === true) throw new Error('injected put failure')
      this.records.set(key, structuredClone(value))
      if (this.failPutAfter?.(value) === true) throw new Error('injected post-commit put failure')
    })
  }

  delete(key: string): Promise<boolean> {
    return this.enqueue(async () => {
      this.deleteCalls += 1
      await this.beforeDelete?.(key)
      if (this.failDelete) return false
      return this.records.delete(key)
    })
  }

  update(key: string, transform: (current: V) => V): Promise<V> {
    return this.enqueue(async () => {
      const current = this.records.get(key)
      if (current === undefined) throw new Error(`missing key ${key}`)
      const next = structuredClone(transform(structuredClone(current)))
      this.records.set(key, next)
      return next
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation)
    this.chain = result.then(() => {}, () => {})
    return result
  }
}

function fixtureSubject(): DurableInteractionEpisodeSubjectV1 {
  const events = Array.from({ length: 23 }, (_, seq) => fixtureEvent(seq))
  const human = {
    id: 'human-message',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Find a reusable release audit method.' }],
  }
  events[0] = {
    type: 'agent/inbox/spliced',
    seq: 0,
    time: 1_000,
    data: { target: 'next-turn', start: 0, inserted: [human] },
  }
  events[1] = { type: 'turn/start', seq: 1, time: 1_001, data: { turn: 1 } }
  events[2] = {
    type: 'agent/inbox/spliced',
    seq: 2,
    time: 1_002,
    data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] },
  }
  events[3] = { type: 'step/start', seq: 3, time: 1_003, data: { turn: 1, step: 1 } }
  events[4] = { type: 'user/message', seq: 4, time: 1_004, data: human, surfaceOp: 'append' }
  events[5] = {
    type: 'request/header',
    seq: 5,
    time: 1_005,
    data: {
      header: {
        config: {
          provider: 'fixture', model: 'fixture-model', reasoningEffort: 'high',
          temperature: 0.2, maxTokens: 4_096, stop: ['END', 'STOP'],
        },
        adapterDefaults: { maxTokens: true },
        system: 'private system control',
        tools: [{
          name: 'report_capability_gap',
          description: 'private Tool contract',
          parameters: { type: 'object', properties: { name: { type: 'string' } } },
        }],
      },
      reason: 'initial',
    },
  }
  events[6] = {
    type: 'request/context', seq: 6, time: 1_006,
    data: { provider: 'fixture', model: 'fixture-model', contextWindow: 32_768 },
  }
  events[7] = {
    type: 'assistant/chunk', seq: 7, time: 1_007,
    data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } },
  }
  events[8] = {
    type: 'assistant/chunk',
    seq: 8,
    time: 1_008,
    data: {
      turn: 1,
      step: 1,
      chunk: {
        type: 'tool-call-delta', index: 0, id: 'gap-call', name: 'report_capability_gap',
        argumentsDelta: '{"name":"release-audit"}',
      },
    },
  }
  events[9] = {
    type: 'assistant/chunk',
    seq: 9,
    time: 1_009,
    data: {
      turn: 1,
      step: 1,
      chunk: {
        type: 'block-end', index: 0,
        block: {
          type: 'tool-call', id: 'gap-call', name: 'report_capability_gap',
          arguments: '{"name":"release-audit"}',
        },
      },
    },
  }
  events[10] = {
    type: 'assistant/chunk', seq: 10, time: 1_010,
    data: { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } },
  }
  events[11] = {
    type: 'assistant/message',
    seq: 11,
    time: 1_011,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: 'trigger-assistant', role: 'assistant',
        source: { kind: 'model', provider: 'fixture', model: 'fixture-model' },
        content: [{
          type: 'tool-call', id: 'gap-call', name: 'report_capability_gap',
          arguments: '{"name":"release-audit"}',
        }],
      },
    },
    sourceEventSeqs: [7, 8, 9, 10],
    surfaceOp: 'append',
  }
  events[12] = {
    type: 'tool/call',
    seq: 12,
    time: 1_012,
    data: {
      turn: 1, step: 1, callId: 'gap-call', name: 'report_capability_gap',
      arguments: '{"name":"release-audit"}',
    },
  }
  events[13] = {
    type: 'tool/result',
    seq: 13,
    time: 1_013,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: 'gap-result', role: 'user', source: { kind: 'tool', callId: 'gap-call' },
        content: [{
          type: 'tool-result', toolCallId: 'gap-call', isError: false,
          content: [{ type: 'text', text: 'Capability Gap recorded.' }],
        }],
      },
    },
    sourceEventSeqs: [12],
    surfaceOp: 'append',
  }
  events[14] = { type: 'step/end', seq: 14, time: 1_014, data: { turn: 1, step: 1 } }
  events[15] = { type: 'step/start', seq: 15, time: 1_015, data: { turn: 1, step: 2 } }
  events[16] = {
    type: 'assistant/chunk', seq: 16, time: 1_016,
    data: { turn: 1, step: 2, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
  }
  events[17] = {
    type: 'assistant/chunk', seq: 17, time: 1_017,
    data: { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'The gap was recorded.' } },
  }
  events[18] = {
    type: 'assistant/chunk', seq: 18, time: 1_018,
    data: {
      turn: 1, step: 2,
      chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'The gap was recorded.' } },
    },
  }
  events[19] = {
    type: 'assistant/chunk', seq: 19, time: 1_019,
    data: { turn: 1, step: 2, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  }
  events[20] = {
    type: 'assistant/message',
    seq: 20,
    time: 1_020,
    data: {
      turn: 1,
      step: 2,
      message: {
        id: 'terminal-assistant', role: 'assistant',
        source: { kind: 'model', provider: 'fixture', model: 'fixture-model' },
        content: [{ type: 'text', text: 'The gap was recorded.' }],
      },
    },
    sourceEventSeqs: [16, 17, 18, 19],
    surfaceOp: 'append',
  }
  events[21] = { type: 'step/end', seq: 21, time: 1_021, data: { turn: 1, step: 2 } }
  events[22] = {
    type: 'turn/end', seq: 22, time: 1_022,
    data: { turn: 1, reason: { kind: 'completed' } },
  }
  const subject = {
    schemaVersion: 1,
    kind: 'durable-interaction-episode-subject-v1',
    session: {
      header: {
        version: 0, id: 'episode-session', createdAt: 1_000,
        cwd: '/private/workspace', isSeeded: false, agentPreset: 'default',
      },
      inheritedEventCount: 0,
      throughSeq: 22,
      events,
    },
    transcript: {
      session: {
        id: 'episode-session', formatVersion: 0, createdAt: 1_000,
        inheritedEventCount: 0, agentPreset: 'default',
      },
      source: {
        turn: 1, prefixThroughSeq: null, enqueueSeq: 0, turnStartSeq: 1,
        claimSeq: 2, initiatingMessageSeq: 4, triggerCallSeq: 12,
        triggerResultSeq: 13, turnEndSeq: 22, completedAt: 1_022,
      },
      witness: {
        admissionStepStartSeq: 3,
        triggerRequestSeq: 11,
        assistantRequestRoutes: [
          { assistantMessageSeq: 11, headerSeq: 5, contextSeq: 6 },
          { assistantMessageSeq: 20, headerSeq: 5, contextSeq: 6 },
        ],
      },
      ingress: { messageId: 'human-message', source: 'user', digest: 'a'.repeat(64) },
      trigger: {
        kind: 'successful-gap-report', callId: 'gap-call', requestedSkill: 'release-audit',
      },
      replay: {
        availability: 'source-dependent', transcript: 'exact',
        prefixDigest: 'a'.repeat(64), turnDigest: 'b'.repeat(64),
      },
    },
  } as unknown as MutableSubject
  rebindReplayDigests(subject)
  return subject as unknown as DurableInteractionEpisodeSubjectV1
}

function fixtureSubjectWithSessionId(sessionId: string): DurableInteractionEpisodeSubjectV1 {
  const subject = structuredClone(fixtureSubject()) as unknown as MutableSubject
  subject.session.header.id = sessionId
  subject.transcript.session.id = sessionId
  rebindReplayDigests(subject)
  return subject as unknown as DurableInteractionEpisodeSubjectV1
}

function reorderFirstToolSchemaKeys(
  source: DurableInteractionEpisodeSubjectV1,
): DurableInteractionEpisodeSubjectV1 {
  const subject = structuredClone(source) as unknown as MutableSubject
  const header = subject.session.events[5]!.data.header as Record<string, any>
  const firstTool = (header.tools as Array<Record<string, any>>)[0]!
  const parameters = firstTool.parameters as Record<string, any>
  firstTool.parameters = {
    properties: structuredClone(parameters.properties),
    type: parameters.type,
  }
  rebindReplayDigests(subject)
  return subject as unknown as DurableInteractionEpisodeSubjectV1
}

function fixtureSkillMissSubject(): DurableInteractionEpisodeSubjectV1 {
  const subject = structuredClone(fixtureSubject()) as unknown as MutableSubject
  subject.transcript.trigger.kind = 'skill-tool-error'
  for (const seq of [8, 9]) {
    const chunk = subject.session.events[seq]!.data.chunk as Record<string, unknown>
    chunk.name = 'skill'
    if (chunk.block !== undefined) {
      (chunk.block as Record<string, unknown>).name = 'skill'
    }
  }
  const assistant = subject.session.events[11]!.data.message as Record<string, any>
  assistant.content[0].name = 'skill'
  subject.session.events[12]!.data.name = 'skill'
  const result = subject.session.events[13]!.data.message as Record<string, any>
  result.content[0].isError = true
  rebindReplayDigests(subject)
  return subject as unknown as DurableInteractionEpisodeSubjectV1
}

function fixtureEvent(seq: number): MutableEvent {
  return { type: 'fixture/event', seq, time: 1_000 + seq, data: {} }
}

type MutableEvent = {
  type: string
  seq: number
  time: number
  data: Record<string, any>
  sourceEventSeqs?: number[]
  surfaceOp?: string
}

type MutableSubject = {
  schemaVersion: number
  kind: string
  session: {
    header: Record<string, any>
    inheritedEventCount: number
    throughSeq: number
    events: MutableEvent[]
  }
  transcript: {
    session: Record<string, any>
    source: Record<string, any>
    witness: Record<string, any>
    replay: Record<string, any>
    trigger: Record<string, any>
    [key: string]: any
  }
}

function rebindReplayDigests(subject: MutableSubject | DurableInteractionEpisodeSubjectV1): void {
  const mutable = subject as unknown as MutableSubject
  const enqueueSeq = mutable.transcript.source.enqueueSeq as number
  const turnEndSeq = mutable.transcript.source.turnEndSeq as number
  mutable.transcript.replay.prefixDigest = testHashCanonical({
    domain: 'evoforge_interaction_episode_prefix',
    version: 1,
    session: {
      header: mutable.session.header,
      inheritedEventCount: mutable.session.inheritedEventCount,
    },
    throughSeq: enqueueSeq === 0 ? null : enqueueSeq - 1,
    events: mutable.session.events.slice(0, enqueueSeq),
  })
  mutable.transcript.replay.turnDigest = testHashCanonical({
    domain: 'evoforge_interaction_episode_turn',
    version: 1,
    session: {
      id: mutable.transcript.session.id,
      formatVersion: mutable.transcript.session.formatVersion,
      createdAt: mutable.transcript.session.createdAt,
    },
    fromSeq: enqueueSeq,
    throughSeq: turnEndSeq,
    events: mutable.session.events.slice(enqueueSeq, turnEndSeq + 1),
  })
}

function testHashCanonical(value: unknown): string {
  return createHash('sha256').update(testCanonicalJson(value)).digest('hex')
}

function testCanonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(testCanonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key =>
      `${JSON.stringify(key)}:${testCanonicalJson(record[key])}`).join(',')}}`
  }
  throw new TypeError('test fixture is not canonical JSON')
}
