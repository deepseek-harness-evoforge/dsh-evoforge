import { createHash } from 'node:crypto'
import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, vi } from 'vitest'
import type { DurableInteractionEpisodeSubjectV1 } from '../src/interaction-episode-evidence-resolver.ts'
import {
  compileInteractionGenerationEvidencePolicies,
  createInteractionGenerationEvidenceReceiptV1,
  createInteractionGenerationEvidenceSink,
  createInteractionGenerationEvidenceSource,
  INTERACTION_GENERATION_EVIDENCE_MAX_AGGREGATE_RECORDS,
  interactionGenerationSessionLifecycleDigest,
  openInteractionGenerationEvidenceVault,
  type InteractionGenerationBindingV1,
  type InteractionGenerationEvidenceReceiptV1,
} from '../src/interaction-generation-evidence.ts'
import { projectInteractionEpisodeTriggerRequestControlV1 } from '../src/interaction-trigger-request-control.ts'
import * as publicApi from '../src/index.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const GENERATION_ID = 'c'.repeat(64)
const SECOND_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'

describe('Interaction Generation evidence vault', () => {
  it('accepts only policy authorities compiled from bounded Host config', async () => {
    const memory = memoryFacility()
    await expect(openInteractionGenerationEvidenceVault(memory.facility, {
      authority: {
        allows: () => true,
        generationMaxRecords: () => Number.MAX_SAFE_INTEGER,
      },
    })).rejects.toThrow(/not compiled/u)
    expect(memory.closeCalls).toBe(0)
  })

  it('denies retention and positive reads by default until a Workspace opts in', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility)
    const sink = createInteractionGenerationEvidenceSink(vault)
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const receipt = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })

    expect(sink.allows(WORKSPACE_ID)).toBe(false)
    await expect(sink.retain(receipt)).rejects.toThrow(/not authorized/u)
    await expect(vault.resolveGenerationEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    expect(memory.table.size).toBe(0)
    await vault.close()
  })

  it('retains and resolves evidence only for an explicitly authorized Workspace', async () => {
    const memory = memoryFacility()
    const authority = compileInteractionGenerationEvidencePolicies([{
      workspaceId: WORKSPACE_ID,
      retention: { generationMaxRecords: 2 },
    }])
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, { authority })
    const sink = createInteractionGenerationEvidenceSink(vault)
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const receipt = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })

    expect(sink.allows(WORKSPACE_ID)).toBe(true)
    expect(sink.allows('22222222-2222-4222-8222-222222222222')).toBe(false)
    await sink.retain(receipt)
    await expect(vault.resolveGenerationEvidence(subject, derived)).resolves.toMatchObject({
      status: 'matched',
    })
    await vault.close()
  })

  it('applies policy withdrawal on reopen without purging previously retained evidence', async () => {
    const memory = memoryFacility()
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const receipt = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    const authorized = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    await authorized.retain(receipt)
    await authorized.close()

    const withdrawn = await openInteractionGenerationEvidenceVault(memory.facility)
    expect(withdrawn.allows(WORKSPACE_ID)).toBe(false)
    await expect(withdrawn.retain(receipt)).rejects.toThrow(/not authorized/u)
    await expect(withdrawn.resolveGenerationEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    expect(memory.table.size).toBe(1)
    await withdrawn.close()
  })

  it('builds and resolves a frozen raw-free native completed-turn receipt', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const sink = createInteractionGenerationEvidenceSink(vault)
    const source = createInteractionGenerationEvidenceSource(vault)
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const receipt = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      kind: 'interaction-generation-evidence-receipt-v1',
      observedAt: 1_022,
      sourceDialect: 'deepseek-harness@0.1.2-alpha.5',
      workspaceId: WORKSPACE_ID,
      subject: {
        sessionLifecycleDigest: interactionGenerationSessionLifecycleDigest(subject),
        turn: 1,
        turnStartSeq: 1,
        turnEndSeq: 22,
        triggerKind: 'successful-gap-report',
        triggerRequestSeq: 11,
        triggerCallSeq: 12,
        triggerResultSeq: 13,
      },
      generation: nativeGeneration(),
      provenance: {
        kind: 'native',
        binderEpochDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        lifecycleCutoffDigest: 'ccead6d27c994b81f4b73cb8236815d0265b073f2631280c414642e042a9aede',
      },
    })
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.subject)).toBe(true)
    const serialized = JSON.stringify(receipt)
    expect(serialized).not.toContain('private system control')
    expect(serialized).not.toContain('Find a reusable release audit method')
    expect(serialized).not.toContain('Capability Gap recorded')
    expect(serialized).not.toContain('/private/workspace')
    expect(receipt).not.toHaveProperty('events')
    expect(receipt).not.toHaveProperty('header')
    expect(receipt).not.toHaveProperty('callId')
    expect(receipt).not.toHaveProperty('lifecycleCutoff')
    expect(receipt.provenance).not.toHaveProperty('lifecycleCutoff')

    await sink.retain(receipt)
    await sink.drain()
    await expect(source.resolveGenerationEvidence(subject, derived)).resolves.toEqual({
      status: 'matched',
      fact: {
        schemaVersion: 1,
        kind: 'interaction-generation-fact-v1',
        workspaceId: WORKSPACE_ID,
        subject: {
          sessionLifecycleDigest: receipt.subject.sessionLifecycleDigest,
          prefixDigest: receipt.subject.prefixDigest,
          turnDigest: receipt.subject.turnDigest,
          turnEndSeq: 22,
          triggerRequestSeq: 11,
          triggerCallSeq: 12,
          triggerResultSeq: 13,
        },
        generation: nativeGeneration(),
      },
    })
    const matched = await source.resolveGenerationEvidence(subject, derived)
    expect(Object.isFrozen(matched)).toBe(true)
    if (matched.status !== 'matched') throw new Error('fixture receipt did not resolve')
    expect(Object.isFrozen(matched.fact)).toBe(true)
    expect(Object.isFrozen(matched.fact.generation)).toBe(true)
    expect(memory.table.size).toBe(1)

    await vault.close()
  })

  it('requires exact subject/control agreement and handles hostile queries without invoking accessors', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    await vault.retain(createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    }))

    const staleDerived = {
      triggerRequestControl: {
        ...derived.triggerRequestControl,
        loggedControlDigest: 'f'.repeat(64),
      },
    }
    await expect(vault.resolveGenerationEvidence(subject, staleDerived)).resolves.toEqual({
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
    await expect(vault.resolveGenerationEvidence(hostile as never, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    expect(getter).not.toHaveBeenCalled()

    const proxy = new Proxy(subject, {
      ownKeys() { throw new Error('hostile ownKeys') },
    })
    await expect(vault.resolveGenerationEvidence(proxy, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })

    const lifecycleDrift = structuredClone(subject) as unknown as MutableSubject
    lifecycleDrift.session.header.cwd = '/another/private/workspace'
    rebindReplayDigests(lifecycleDrift)
    const durableLifecycleDrift = lifecycleDrift as unknown as DurableInteractionEpisodeSubjectV1
    const driftDerived = derivedFor(durableLifecycleDrift)
    await expect(vault.resolveGenerationEvidence(durableLifecycleDrift, driftDerived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })

    const incompleteTurn = structuredClone(subject) as unknown as MutableSubject
    incompleteTurn.session.events[22]!.data.reason = { kind: 'interrupted' }
    rebindReplayDigests(incompleteTurn)
    const durableIncompleteTurn = incompleteTurn as unknown as DurableInteractionEpisodeSubjectV1
    expect(() => createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject: durableIncompleteTurn,
      derived: derivedFor(durableIncompleteTurn),
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })).toThrow(/subject coordinates/u)

    const completionDrift = structuredClone(subject) as unknown as MutableSubject
    completionDrift.transcript.source.completedAt = 9_999
    const durableCompletionDrift = completionDrift as unknown as DurableInteractionEpisodeSubjectV1
    expect(() => createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject: durableCompletionDrift,
      derived: derivedFor(durableCompletionDrift),
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })).toThrow(/subject coordinates/u)

    const crossTurnTrigger = structuredClone(subject) as unknown as MutableSubject
    for (const seq of [11, 12, 13]) crossTurnTrigger.session.events[seq]!.data.turn = 2
    rebindReplayDigests(crossTurnTrigger)
    const durableCrossTurnTrigger = crossTurnTrigger as unknown as DurableInteractionEpisodeSubjectV1
    expect(() => createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject: durableCrossTurnTrigger,
      derived: derivedFor(durableCrossTurnTrigger),
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })).toThrow(/subject coordinates/u)
    await vault.close()
  })

  it('builds evolved receipts only for a canonical matching Generation and mount epoch', () => {
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const receipt = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: evolvedGeneration(),
      generationDigest: GENERATION_ID,
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
      mountEpoch: 'mount-one',
    })

    expect(receipt).toMatchObject({
      generation: evolvedGeneration(),
      provenance: {
        kind: 'evolved',
        binderEpochDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        lifecycleCutoffDigest: 'ccead6d27c994b81f4b73cb8236815d0265b073f2631280c414642e042a9aede',
        mountEpochDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        generationDigest: GENERATION_ID,
      },
    })
    expect(() => createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: evolvedGeneration(),
      generationDigest: 'd'.repeat(64),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
      mountEpoch: 'mount-one',
    })).toThrow(/Generation digest/u)
    expect(() => createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: evolvedGeneration(),
      generationDigest: GENERATION_ID,
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    } as never)).toThrow(/mount epoch/u)
    expect(() => createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
      mountEpoch: 'forbidden',
    } as never)).toThrow(/cannot carry/u)
    expect(() => createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 2,
    })).toThrow(/lifecycle cutoff/u)
    expect(() => createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
    } as never)).toThrow(/lifecycle cutoff/u)
  })

  it('deduplicates exact receipts and makes a divergent binder or mount epoch a sticky conflict', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const first = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: evolvedGeneration(),
      generationDigest: GENERATION_ID,
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
      mountEpoch: 'mount-one',
    })
    await Promise.all([vault.retain(first), vault.retain(first)])
    expect(memory.table.size).toBe(1)

    const divergent = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: evolvedGeneration(),
      generationDigest: GENERATION_ID,
      binderEpoch: 'binder-two',
      lifecycleCutoff: 0,
      mountEpoch: 'mount-two',
    })
    await vault.retain(divergent)
    expect([...memory.table.entries()][0]?.[1]).toMatchObject({ state: 'conflict' })
    await expect(vault.resolveGenerationEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })

    await vault.retain(first)
    expect([...memory.table.entries()][0]?.[1]).toMatchObject({ state: 'conflict' })
    await vault.close()
  })

  it('hashes the exact lifecycle cutoff into provenance and conflicts divergent cutoffs', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const first = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    const divergent = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 1,
    })

    expect(first.provenance).toMatchObject({
      lifecycleCutoffDigest: 'ccead6d27c994b81f4b73cb8236815d0265b073f2631280c414642e042a9aede',
    })
    expect(divergent.provenance).toMatchObject({
      lifecycleCutoffDigest: '269f6c535bb7cd504fb24af60681b2ec002848b14357b81323fc803f80c7c4d0',
    })
    await vault.retain(first)
    expect(memory.table.size).toBe(1)
    await vault.retain(divergent)
    expect(memory.table.size).toBe(1)
    expect([...memory.table.entries()][0]?.[1]).toMatchObject({ state: 'conflict' })
    await expect(vault.resolveGenerationEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await vault.close()
  })

  it('poisons contradictory Workspace claims while retaining sorted ownership metadata', async () => {
    const memory = memoryFacility()
    const authority = compileInteractionGenerationEvidencePolicies([
      { workspaceId: WORKSPACE_ID, retention: { generationMaxRecords: 1 } },
      { workspaceId: SECOND_WORKSPACE_ID, retention: { generationMaxRecords: 1 } },
    ])
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, { authority })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const first = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    await vault.retain(first)
    await vault.retain({ ...first, workspaceId: SECOND_WORKSPACE_ID })

    expect([...memory.table.entries()].map(([, record]) => record)).toEqual([
      expect.objectContaining({
        state: 'conflict',
        workspaceIds: [WORKSPACE_ID, SECOND_WORKSPACE_ID].sort(),
      }),
    ])
    await expect(vault.resolveGenerationEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await vault.close()
  })

  it('fails authority closed instead of dropping conflict ownership after policy rotation', async () => {
    const memory = memoryFacility()
    const historicalOwners = Array.from({ length: 100 }, (_, index) =>
      workspaceIdForIndex(index))
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: compileInteractionGenerationEvidencePolicies(historicalOwners.map(workspaceId => ({
        workspaceId,
        retention: { generationMaxRecords: 1 },
      }))),
    })
    const subject = fixtureSubject()
    const first = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: historicalOwners[0]!,
      subject,
      derived: derivedFor(subject),
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    for (const workspaceId of historicalOwners) {
      await vault.retain({ ...first, workspaceId })
    }
    await vault.close()

    const nextOwner = workspaceIdForIndex(100)
    const reopened = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: compileInteractionGenerationEvidencePolicies([{
        workspaceId: nextOwner,
        retention: { generationMaxRecords: 1 },
      }]),
    })
    await expect(reopened.retain({ ...first, workspaceId: nextOwner }))
      .rejects.toThrow(/owner metadata/u)
    expect(reopened.allows(nextOwner)).toBe(false)
    await expect(reopened.close()).rejects.toThrow(/owner metadata/u)
  })

  it('keys distinct trigger boundaries in one completed turn independently', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const first = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    const second: InteractionGenerationEvidenceReceiptV1 = {
      ...first,
      subject: {
        ...first.subject,
        triggerKind: 'skill-tool-error',
        triggerRequestSeq: 16,
        triggerCallSeq: 17,
        triggerResultSeq: 18,
      },
    }

    await vault.retain(first)
    await vault.retain(second)

    expect(memory.table.size).toBe(2)
    expect([...memory.table.entries()].every(([, record]) =>
      isRecord(record) && record.state === 'resolved')).toBe(true)
    await expect(vault.resolveGenerationEvidence(subject, derived)).resolves.toMatchObject({
      status: 'matched',
    })
    await vault.close()
  })

  it('fails the live authority closed when a conflict tombstone cannot be committed', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const first = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    const divergent = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-two',
      lifecycleCutoff: 0,
    })
    await vault.retain(first)
    memory.table.failPut = value => isRecord(value) && value.state === 'conflict'

    await expect(vault.retain(divergent)).rejects.toThrow(/injected put failure/u)
    expect(memory.table.size).toBe(1)
    expect([...memory.table.entries()][0]?.[1]).toMatchObject({ state: 'resolved' })
    expect(vault.allows(WORKSPACE_ID)).toBe(false)
    await expect(vault.resolveGenerationEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await expect(vault.retain(shiftedReceipt(first, 'd', 2_000)))
      .rejects.toThrow(/authority is unavailable/u)
    await expect(vault.drain()).rejects.toThrow(/conflict tombstone/u)
    await expect(vault.close()).rejects.toThrow(/conflict tombstone/u)
    expect(memory.closeCalls).toBe(1)

    // The contradictory observation was rejected before durability. Reopen
    // can therefore recover only the previously committed positive record.
    memory.table.failPut = undefined
    const reopened = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    await expect(reopened.resolveGenerationEvidence(subject, derived)).resolves.toMatchObject({
      status: 'matched',
    })
    await reopened.close()
  })

  it('keeps an already-enrolled unrelated write durable when a conflict then fails', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const first = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived: derivedFor(subject),
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    await vault.retain(first)
    memory.table.failPut = value => isRecord(value) && value.state === 'conflict'

    const conflict = vault.retain({
      ...first,
      provenance: { ...first.provenance, binderEpochDigest: 'f'.repeat(64) },
    })
    const later = vault.retain(shiftedReceipt(first, 'd', 2_000))

    await expect(conflict).rejects.toThrow(/conflict tombstone/u)
    await expect(later).resolves.toBeUndefined()
    expect(memory.table.size).toBe(2)
    expect(vault.allows(WORKSPACE_ID)).toBe(false)
    await expect(vault.resolveGenerationEvidence(subject, derivedFor(subject))).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await expect(vault.close()).rejects.toThrow(/conflict tombstone/u)
  })

  it('accepts a conflict tombstone found on readback after an uncertain put and keeps it on reopen', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const first = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    await vault.retain(first)
    memory.table.failPutAfter = value => isRecord(value) && value.state === 'conflict'

    await expect(vault.retain({
      ...first,
      provenance: { ...first.provenance, binderEpochDigest: 'f'.repeat(64) },
    })).resolves.toBeUndefined()
    await expect(vault.resolveGenerationEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await vault.close()

    memory.table.failPutAfter = undefined
    const reopened = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    await expect(reopened.resolveGenerationEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await reopened.close()
  })

  it('keeps prior evidence when a new resolved put fails before quota pruning', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const first = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    await vault.retain(first)
    memory.table.failPut = value => isRecord(value) && value.state === 'resolved'

    await expect(vault.retain(shiftedReceipt(first, 'd', 2_000)))
      .rejects.toThrow(/injected put failure/u)
    expect(memory.table.size).toBe(1)
    await expect(vault.resolveGenerationEvidence(subject, derived)).resolves.toMatchObject({
      status: 'matched',
    })

    memory.table.failPut = undefined
    memory.table.failPutAfter = value => isRecord(value) && value.state === 'resolved'
    await expect(vault.retain(shiftedReceipt(first, 'd', 2_000))).resolves.toBeUndefined()
    expect(memory.table.size).toBe(1)
    expect([...memory.table.entries()][0]?.[1]).toMatchObject({ observedAt: 2_000 })
    await vault.close()
  })

  it('fails the live authority closed when a committed write cannot be quota-pruned', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const first = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    await vault.retain(first)
    memory.table.failDelete = true

    await expect(vault.retain(shiftedReceipt(first, 'd', 2_000)))
      .rejects.toThrow(/pruning/u)
    expect(memory.table.size).toBe(2)
    expect(vault.allows(WORKSPACE_ID)).toBe(false)
    await expect(vault.resolveGenerationEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await expect(vault.drain()).rejects.toThrow(/pruning/u)
    await expect(vault.close()).rejects.toThrow(/pruning/u)

    memory.table.failDelete = false
    const reopened = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    expect(memory.table.size).toBe(1)
    await reopened.close()
  })

  it('recomputes pruning after an earlier projected put fails', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(2),
    })
    const subject = fixtureSubject()
    const first = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived: derivedFor(subject),
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    const second = shiftedReceipt(first, 'd', 2_000)
    const rejected = shiftedReceipt(first, 'e', 3_000)
    const accepted = shiftedReceipt(first, 'f', 4_000)
    await vault.retain(first)
    await vault.retain(second)
    memory.table.failPut = value => isRecord(value)
      && value.state === 'resolved'
      && value.observedAt === 3_000

    const failed = vault.retain(rejected)
    const later = vault.retain(accepted)
    await expect(failed).rejects.toThrow(/later receipts were projected/u)
    await expect(later).resolves.toBeUndefined()
    await expect(vault.close()).rejects.toThrow(/later receipts were projected/u)

    memory.table.failPut = undefined
    const reopened = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(2),
    })
    expect([...memory.table.entries()].map(([, record]) =>
      isRecord(record) ? record.observedAt : undefined).sort((a, b) => (a ?? 0) - (b ?? 0)))
      .toEqual([2_000, 4_000])
    await reopened.close()
  })

  it('does not let an exact duplicate outrun a fatal prune for the same identity', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    const firstSubject = fixtureSubject()
    const secondSubject = fixtureSubjectWithSessionId('same-id-prune-session')
    const first = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject: firstSubject,
      derived: derivedFor(firstSubject),
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    const second = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject: secondSubject,
      derived: derivedFor(secondSubject),
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    await vault.retain(first)
    memory.table.failDelete = true

    const inserted = vault.retain(second)
    const duplicate = vault.retain(second)
    const resolved = vault.resolveGenerationEvidence(secondSubject, derivedFor(secondSubject))
    await expect(inserted).rejects.toThrow(/pruning/u)
    await expect(duplicate).resolves.toBeUndefined()
    await expect(resolved).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await expect(vault.close()).rejects.toThrow(/pruning/u)
  })

  it('revalidates every queued prune victim before a concurrent conflict can erase it', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    const subjects = [
      fixtureSubject(),
      fixtureSubjectWithSessionId('multi-prune-second'),
      fixtureSubjectWithSessionId('multi-prune-third'),
      fixtureSubjectWithSessionId('multi-prune-fourth'),
    ]
    const receipts = subjects.map((subject, index) => createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived: derivedFor(subject),
      generation: nativeGeneration(),
      binderEpoch: `binder-${index}`,
      lifecycleCutoff: 0,
    }))
    const [first, second, third, fourth] = receipts
    if (first === undefined || second === undefined || third === undefined || fourth === undefined
      || third.provenance.kind !== 'native') {
      throw new Error('expected four native evidence fixtures')
    }
    await vault.retain(first)

    const secondDeleteStarted = deferred<void>()
    const secondDeleteGate = deferred<void>()
    memory.table.beforeDelete = async () => {
      if (memory.table.deleteCalls === 2) {
        secondDeleteStarted.resolve()
        await secondDeleteGate.promise
      }
    }
    const retained = [
      vault.retain(second),
      vault.retain(third),
      vault.retain(fourth),
    ]
    await secondDeleteStarted.promise
    const conflicted = vault.retain({
      ...third,
      provenance: { ...third.provenance, binderEpochDigest: 'f'.repeat(64) },
    })
    secondDeleteGate.resolve()
    await Promise.all([...retained, conflicted])
    await vault.close()

    expect([...memory.table.entries()].map(([, record]) => record)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'conflict', recordedSeq: 3 }),
        expect.objectContaining({ state: 'resolved', recordedSeq: 4 }),
      ]),
    )
    expect(memory.table.size).toBe(2)
    const reopened = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    await expect(reopened.resolveGenerationEvidence(subjects[2]!, derivedFor(subjects[2]!)))
      .resolves.toEqual({ status: 'abstained', reason: 'evidence-conflict' })
    expect(memory.table.size).toBe(2)
    await reopened.close()
  })

  it('rolls back a failed exact rewrite queued behind its successful prune deletion', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    const firstSubject = fixtureSubject()
    const secondSubject = fixtureSubjectWithSessionId('exact-rewrite-prune-session')
    const first = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject: firstSubject,
      derived: derivedFor(firstSubject),
      generation: nativeGeneration(),
      binderEpoch: 'binder-first',
      lifecycleCutoff: 0,
    })
    const second = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject: secondSubject,
      derived: derivedFor(secondSubject),
      generation: nativeGeneration(),
      binderEpoch: 'binder-second',
      lifecycleCutoff: 0,
    })
    await vault.retain(first)

    const deleteStarted = deferred<void>()
    const deleteGate = deferred<void>()
    memory.table.beforeDelete = async () => {
      if (memory.table.deleteCalls === 1) {
        deleteStarted.resolve()
        await deleteGate.promise
      }
    }
    const inserted = vault.retain(second)
    await deleteStarted.promise
    memory.table.failPut = value => isRecord(value) && value.observedAt === first.observedAt
    const failedRewrite = vault.retain(first)
    deleteGate.resolve()
    await expect(inserted).resolves.toBeUndefined()
    await expect(failedRewrite).rejects.toThrow(/injected put failure/u)

    memory.table.failPut = undefined
    await vault.retain(first)
    const onlyRecord = [...memory.table.entries()][0]?.[1]
    expect(memory.table.size).toBe(1)
    expect(recordRecordSequence(onlyRecord)).toBe(3)
    await expect(vault.resolveGenerationEvidence(firstSubject, derivedFor(firstSubject)))
      .resolves.toMatchObject({ status: 'matched' })
    await vault.close()

    const reopened = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    await expect(reopened.resolveGenerationEvidence(firstSubject, derivedFor(firstSubject)))
      .resolves.toMatchObject({ status: 'matched' })
    await reopened.close()
  })

  it('never matches a retained timestamp that disagrees with the exact turn end', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const receipt = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    await vault.retain({ ...receipt, observedAt: receipt.observedAt + 1 })

    await expect(vault.resolveGenerationEvidence(subject, derived)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await vault.close()
  })

  it('enforces each Workspace quota by host insertion order without evicting another Workspace', async () => {
    const memory = memoryFacility()
    const authority = compileInteractionGenerationEvidencePolicies([
      { workspaceId: WORKSPACE_ID, retention: { generationMaxRecords: 2 } },
      { workspaceId: SECOND_WORKSPACE_ID, retention: { generationMaxRecords: 1 } },
    ])
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, { authority })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const base = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    const first = shiftedReceipt(base, 'd', 9_000)
    const second = shiftedReceipt(base, 'e', 8_000)
    const otherWorkspace = shiftedReceipt(base, 'f', 1, SECOND_WORKSPACE_ID)
    const newest = shiftedReceipt(base, '9', 2)
    await vault.retain(first)
    await vault.retain(second)
    await vault.retain(otherWorkspace)
    await vault.retain(newest)

    const records = [...memory.table.entries()].map(([, record]) => record)
    expect(records).toHaveLength(3)
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ observedAt: 8_000, workspaceIds: [WORKSPACE_ID] }),
      expect.objectContaining({ observedAt: 1, workspaceIds: [SECOND_WORKSPACE_ID] }),
      expect.objectContaining({ observedAt: 2, workspaceIds: [WORKSPACE_ID] }),
    ]))
    expect(records).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ observedAt: 9_000 }),
    ]))
    expect(records.map(record => recordRecordSequence(record)).sort((a, b) => a - b))
      .toEqual([2, 3, 4])
    await vault.close()
  })

  it('never quota-prunes a conflict tombstone or lets it revive after reopen', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(2),
    })
    const subject = fixtureSubject()
    const base = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived: derivedFor(subject),
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    await vault.retain(base)
    if (base.provenance.kind !== 'native') throw new Error('expected native fixture receipt')
    await vault.retain({
      ...base,
      provenance: { ...base.provenance, binderEpochDigest: 'f'.repeat(64) },
    })
    await vault.retain(shiftedReceipt(base, 'd', 1))
    await vault.retain(shiftedReceipt(base, 'e', 2))
    await vault.retain(shiftedReceipt(base, '9', 3))
    expect([...memory.table.entries()].filter(([, record]) =>
      isRecord(record) && record.state === 'conflict')).toHaveLength(1)
    await vault.close()

    const reopened = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(1),
    })
    expect(memory.table.size).toBe(2)
    expect([...memory.table.entries()].filter(([, record]) =>
      isRecord(record) && record.state === 'conflict')).toHaveLength(1)
    await expect(reopened.resolveGenerationEvidence(subject, derivedFor(subject))).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await reopened.retain(base)
    expect([...memory.table.entries()].filter(([, record]) =>
      isRecord(record) && record.state === 'conflict')).toHaveLength(1)
    await reopened.close()
  })

  it('makes resolve, drain, and close wait for writes accepted before their call', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const derived = derivedFor(subject)
    const receipt = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    const gate = deferred<void>()
    memory.table.beforePut = async () => gate.promise
    const retained = vault.retain(receipt)
    const resolved = vault.resolveGenerationEvidence(subject, derived)
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

  it('does not make an unrelated identity resolution wait for a slow accepted write', async () => {
    const memory = memoryFacility()
    const authority = compileInteractionGenerationEvidencePolicies([
      { workspaceId: WORKSPACE_ID, retention: { generationMaxRecords: 2 } },
      { workspaceId: SECOND_WORKSPACE_ID, retention: { generationMaxRecords: 2 } },
    ])
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, { authority })
    const firstSubject = fixtureSubject()
    const secondSubject = fixtureSubjectWithSessionId('second-session')
    const secondDerived = derivedFor(secondSubject)
    await vault.retain(createInteractionGenerationEvidenceReceiptV1({
      workspaceId: SECOND_WORKSPACE_ID,
      subject: secondSubject,
      derived: secondDerived,
      generation: nativeGeneration(),
      binderEpoch: 'binder-two',
      lifecycleCutoff: 0,
    }))

    const gate = deferred<void>()
    memory.table.beforePut = async () => gate.promise
    const retained = vault.retain(createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject: firstSubject,
      derived: derivedFor(firstSubject),
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    }))
    const outcome = await Promise.race([
      vault.resolveGenerationEvidence(secondSubject, secondDerived),
      new Promise<'blocked'>(resolve => setTimeout(() => resolve('blocked'), 20)),
    ])
    gate.resolve()
    await retained

    expect(outcome).toMatchObject({ status: 'matched' })
    await vault.close()
  })

  it('audits durable keys and content on open and closes the domain on failure', async () => {
    const keyDrift = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(keyDrift.facility, {
      authority: authorizedAuthority(),
    })
    const subject = fixtureSubject()
    const receipt = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived: derivedFor(subject),
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    await vault.retain(receipt)
    await vault.close()
    const entry = [...keyDrift.table.entries()][0]
    if (entry === undefined) throw new Error('expected one retained receipt')
    keyDrift.table.replace(new Map([['f'.repeat(64), entry[1]]]))

    await expect(openInteractionGenerationEvidenceVault(keyDrift.facility, {
      authority: authorizedAuthority(),
    }))
      .rejects.toThrow(/key/u)
    expect(keyDrift.closeCalls).toBe(2)

    const contentDrift = memoryFacility()
    const contentVault = await openInteractionGenerationEvidenceVault(contentDrift.facility, {
      authority: authorizedAuthority(),
    })
    await contentVault.retain(receipt)
    await contentVault.close()
    const contentEntry = [...contentDrift.table.entries()][0]
    if (contentEntry === undefined || !isRecord(contentEntry[1])
      || contentEntry[1].state !== 'resolved') throw new Error('expected resolved receipt')
    contentEntry[1].receipt.workspaceId = '22222222-2222-4222-8222-222222222222'
    contentDrift.table.replace(new Map([[contentEntry[0], contentEntry[1]]]))

    await expect(openInteractionGenerationEvidenceVault(contentDrift.facility, {
      authority: authorizedAuthority(),
    }))
      .rejects.toThrow(/owner|integrity audit/u)
    expect(contentDrift.closeCalls).toBe(2)

    const sequenceDrift = memoryFacility()
    const sequenceVault = await openInteractionGenerationEvidenceVault(sequenceDrift.facility, {
      authority: authorizedAuthority(),
    })
    await sequenceVault.retain(receipt)
    await sequenceVault.retain(shiftedReceipt(receipt, 'd', 2_000))
    await sequenceVault.close()
    const sequenceRows = [...sequenceDrift.table.entries()]
    const firstSequence = sequenceRows[0]?.[1]
    const duplicateSequence = structuredClone(sequenceRows[1]?.[1])
    if (!isRecord(firstSequence) || !isRecord(duplicateSequence)) {
      throw new Error('expected two sequenced evidence rows')
    }
    duplicateSequence.recordedSeq = firstSequence.recordedSeq
    const duplicateContent = { ...duplicateSequence }
    delete duplicateContent.recordDigest
    duplicateSequence.recordDigest = testHashCanonical({
      domain: 'evoforge_interaction_generation_evidence',
      version: 1,
      record: duplicateContent,
    })
    sequenceDrift.table.replace(new Map([
      sequenceRows[0]!,
      [sequenceRows[1]![0], duplicateSequence],
    ]))

    await expect(openInteractionGenerationEvidenceVault(sequenceDrift.facility, {
      authority: authorizedAuthority(),
    })).rejects.toThrow(/insertion sequence/u)
    expect(sequenceDrift.closeCalls).toBe(2)
  })

  it('rejects an over-cap durable vault without evicting rows and keeps internal seams private', async () => {
    const memory = memoryFacility()
    memory.table.reportedSize = INTERACTION_GENERATION_EVIDENCE_MAX_AGGREGATE_RECORDS + 1
    await expect(openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(),
    })).rejects.toThrow(/aggregate safety cap/u)
    expect(memory.closeCalls).toBe(1)
    expect(memory.table.deleteCalls).toBe(0)
    expect(publicApi).not.toHaveProperty('openInteractionGenerationEvidenceVault')
    expect(publicApi).not.toHaveProperty('compileInteractionGenerationEvidencePolicies')
    expect(publicApi).not.toHaveProperty('createInteractionGenerationEvidenceReceiptV1')
    expect(publicApi).not.toHaveProperty('createInteractionGenerationEvidenceSink')
    expect(publicApi).not.toHaveProperty('createInteractionGenerationEvidenceSource')
    expect(publicApi).not.toHaveProperty('interactionGenerationSessionLifecycleDigest')
  })

  it('can poison an existing row at the aggregate cap but never evicts a tombstone for capacity', async () => {
    const memory = memoryFacility()
    const vault = await openInteractionGenerationEvidenceVault(memory.facility, {
      authority: authorizedAuthority(2),
    })
    const subject = fixtureSubject()
    const receipt = createInteractionGenerationEvidenceReceiptV1({
      workspaceId: WORKSPACE_ID,
      subject,
      derived: derivedFor(subject),
      generation: nativeGeneration(),
      binderEpoch: 'binder-one',
      lifecycleCutoff: 0,
    })
    await vault.retain(receipt)
    memory.table.reportedSize = INTERACTION_GENERATION_EVIDENCE_MAX_AGGREGATE_RECORDS
    await vault.retain({
      ...receipt,
      provenance: { ...receipt.provenance, binderEpochDigest: 'f'.repeat(64) },
    })
    await expect(vault.retain(shiftedReceipt(receipt, 'd', 2_000)))
      .rejects.toThrow(/aggregate safety cap/u)
    expect(memory.table.deleteCalls).toBe(0)
    expect([...memory.table.entries()][0]?.[1]).toMatchObject({ state: 'conflict' })
    memory.table.reportedSize = undefined
    await vault.close()
  })
})

function nativeGeneration(): Extract<InteractionGenerationBindingV1, { readonly kind: 'native' }> {
  return { kind: 'native', pin: 'settled', effectiveMount: { kind: 'native' } }
}

function authorizedAuthority(generationMaxRecords = 10_000) {
  return compileInteractionGenerationEvidencePolicies([{
    workspaceId: WORKSPACE_ID,
    retention: { generationMaxRecords },
  }])
}

function evolvedGeneration(): Extract<InteractionGenerationBindingV1, { readonly kind: 'evolved' }> {
  return {
    kind: 'evolved',
    pin: 'settled',
    generationId: GENERATION_ID,
    effectiveMount: { kind: 'evolved', generationId: GENERATION_ID },
  }
}

function derivedFor(subject: DurableInteractionEpisodeSubjectV1) {
  const projection = projectInteractionEpisodeTriggerRequestControlV1(subject)
  if (projection.status !== 'projected') throw new Error('fixture did not project')
  return { triggerRequestControl: projection.fact }
}

function shiftedReceipt(
  receipt: InteractionGenerationEvidenceReceiptV1,
  hashCharacter: string,
  observedAt: number,
  workspaceId = receipt.workspaceId,
): InteractionGenerationEvidenceReceiptV1 {
  return {
    ...receipt,
    observedAt,
    workspaceId,
    subject: {
      ...receipt.subject,
      sessionLifecycleDigest: hashCharacter.repeat(64),
      prefixDigest: hashCharacter.repeat(64),
      turnDigest: hashCharacter.repeat(64),
    },
  }
}

function workspaceIdForIndex(index: number): string {
  return `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`
}

interface MutableEvidenceRecord {
  state: 'resolved' | 'conflict'
  recordedSeq: number
  observedAt: number
  workspaceIds: string[]
  receipt: { workspaceId: string }
  [key: string]: unknown
}

function isRecord(value: unknown): value is MutableEvidenceRecord {
  return value !== null && typeof value === 'object' && 'state' in value
}

function recordRecordSequence(value: unknown): number {
  if (!isRecord(value)) throw new Error('expected retained evidence record')
  return value.recordedSeq
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
  let globalValue = { nextRecordedSeq: 0 }
  const state = {
    closeCalls: 0,
    table,
    facility: {
      async open() {
        return {
          name: 'interaction-generation-evidence-test',
          global: {
            get: () => globalValue,
            async set(value: { nextRecordedSeq: number }) {
              globalValue = structuredClone(value)
            },
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
  beforePut: ((key: string, value: V) => Promise<void>) | undefined
  beforeDelete: ((key: string) => Promise<void>) | undefined
  failPut: ((value: V) => boolean) | undefined
  failPutAfter: ((value: V) => boolean) | undefined
  failDelete = false

  get size(): number { return this.reportedSize ?? this.records.size }
  get(key: string): V | undefined { return this.records.get(key) }
  entries(): IterableIterator<[string, V]> { return this.records.entries() }
  keys(): IterableIterator<string> { return this.records.keys() }
  replace(records: Map<string, V>): void { this.records = records }

  put(key: string, value: V): Promise<void> {
    return this.enqueue(async () => {
      await this.beforePut?.(key, value)
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
          provider: 'fixture',
          model: 'fixture-model',
          reasoningEffort: 'high',
          temperature: 0.2,
          maxTokens: 4_096,
          stop: ['END', 'STOP'],
        },
        adapterDefaults: { maxTokens: true },
        system: 'private system control',
        tools: [
          {
            name: 'ordered-tool',
            description: 'First tool.',
            parameters: { type: 'object', properties: { value: { type: 'string' } } },
          },
          {
            name: 'second-tool',
            description: 'Second tool.',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
      reason: 'initial',
    },
  }
  events[6] = {
    type: 'request/context',
    seq: 6,
    time: 1_006,
    data: { provider: 'fixture', model: 'fixture-model', contextWindow: 32_768 },
  }
  events[7] = {
    type: 'assistant/chunk',
    seq: 7,
    time: 1_007,
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
        type: 'block-end',
        index: 0,
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
