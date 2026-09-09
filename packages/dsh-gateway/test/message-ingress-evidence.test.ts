import { createHash } from 'node:crypto'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import type { GatewayIngressJournal, GatewayIngressRecord } from '../src/ingress-journal.js'
import {
  createGatewayIngressEvidenceSource,
  openGatewayIngressEvidenceVault,
  type GatewayIngressEvidenceObservationV1,
  type GatewayIngressEvidenceQueryV1,
} from '../src/message-ingress-evidence.js'

describe('gateway message ingress evidence', () => {
  it('resolves only the exact retained ingress, Session lifecycle, message, and enqueue', async () => {
    const fixture = ingressFixture('a', 1_000)
    const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
    await vault.retain(fixture.observation)
    const source = createGatewayIngressEvidenceSource(vault, journalReturning(fixture.settled))

    await expect(source.resolveIngressEvidence(fixture.query)).resolves.toEqual({
      status: 'matched',
      fact: {
        schemaVersion: 1,
        kind: 'gateway-ingress-workspace-fact-v1',
        workspaceId: fixture.settled.workspaceId,
      },
    })
  })

  it('waits for previously accepted retention before resolving against the journal', async () => {
    const fixture = ingressFixture('a', 1_000)
    const memory = memoryFacility()
    const vault = await openGatewayIngressEvidenceVault(memory.facility)
    let markWriteStarted!: () => void
    const writeStarted = new Promise<void>(resolve => { markWriteStarted = resolve })
    let releaseWrite!: () => void
    const writeRelease = new Promise<void>(resolve => { releaseWrite = resolve })
    memory.table.beforeNextPut(async () => {
      markWriteStarted()
      await writeRelease
    })

    const retaining = vault.retain(fixture.observation)
    await writeStarted

    let journalReads = 0
    const source = createGatewayIngressEvidenceSource(vault, {
      get(id: string) {
        journalReads += 1
        return id === fixture.settled.id
          ? structuredClone(fixture.settled)
          : undefined
      },
    } as GatewayIngressJournal)
    let querySettled = false
    const resolving = source.resolveIngressEvidence(fixture.query)
    void resolving.then(
      () => { querySettled = true },
      () => { querySettled = true },
    )

    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(querySettled).toBe(false)
    expect(journalReads).toBe(0)

    releaseWrite()
    await expect(retaining).resolves.toBeUndefined()
    await expect(resolving).resolves.toEqual({
      status: 'matched',
      fact: {
        schemaVersion: 1,
        kind: 'gateway-ingress-workspace-fact-v1',
        workspaceId: fixture.settled.workspaceId,
      },
    })
    expect(journalReads).toBe(1)
  })

  it('keeps a rejected contradictory transition fail-closed for only the affected id', async () => {
    const fixture = ingressFixture('a', 1_000)
    const unrelated = ingressFixture('d', 2_000)
    const memory = memoryFacility()
    const vault = await openGatewayIngressEvidenceVault(memory.facility)
    await vault.retain(fixture.observation)
    await vault.retain(unrelated.observation)
    let markWriteStarted!: () => void
    const writeStarted = new Promise<void>(resolve => { markWriteStarted = resolve })
    let releaseWrite!: () => void
    const writeRelease = new Promise<void>(resolve => { releaseWrite = resolve })
    memory.table.beforeNextPut(async () => {
      markWriteStarted()
      await writeRelease
      throw new Error('evidence write failed')
    })
    const rejectedRetention = vault.retain({
      ...fixture.observation,
      workspace: {
        ...fixture.observation.workspace,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    })
    await writeStarted

    let journalReads = 0
    const source = createGatewayIngressEvidenceSource(vault, {
      get(id: string) {
        journalReads += 1
        if (id === fixture.settled.id) return structuredClone(fixture.settled)
        if (id === unrelated.settled.id) return structuredClone(unrelated.settled)
        return undefined
      },
    } as GatewayIngressJournal)
    let querySettled = false
    const resolving = source.resolveIngressEvidence(fixture.query)
    void resolving.then(
      () => { querySettled = true },
      () => { querySettled = true },
    )

    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(querySettled).toBe(false)
    expect(journalReads).toBe(0)

    releaseWrite()
    await expect(rejectedRetention).rejects.toThrow('evidence write failed')
    await expect(resolving).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await expect(vault.retain(fixture.observation)).resolves.toBeUndefined()
    await expect(source.resolveIngressEvidence(fixture.query)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await expect(source.resolveIngressEvidence(unrelated.query)).resolves.toMatchObject({
      status: 'matched',
      fact: { workspaceId: unrelated.settled.workspaceId },
    })
    expect(journalReads).toBe(1)
  })

  it('keeps retained evidence usable after unrelated table read and write failures', async () => {
    const fixture = ingressFixture('a', 1_000)
    const unrelated = ingressFixture('d', 2_000)
    const memory = memoryFacility()
    const vault = await openGatewayIngressEvidenceVault(memory.facility)
    await vault.retain(fixture.observation)
    const source = createGatewayIngressEvidenceSource(vault, journalReturning(fixture.settled))

    memory.table.beforeNextGet(() => { throw new Error('unrelated evidence read failed') })
    await expect(vault.retain(unrelated.observation)).rejects.toThrow(
      'unrelated evidence read failed',
    )
    await expect(source.resolveIngressEvidence(fixture.query)).resolves.toMatchObject({
      status: 'matched',
      fact: { workspaceId: fixture.settled.workspaceId },
    })

    memory.table.beforeNextPut(async () => { throw new Error('unrelated evidence write failed') })
    await expect(vault.retain(unrelated.observation)).rejects.toThrow(
      'unrelated evidence write failed',
    )
    await expect(source.resolveIngressEvidence(fixture.query)).resolves.toMatchObject({
      status: 'matched',
      fact: { workspaceId: fixture.settled.workspaceId },
    })
  })

  it.each([
    ['an accessor', (query: MutableQuery) => {
      const kind = query.kind
      Object.defineProperty(query, 'kind', {
        configurable: true,
        enumerable: true,
        get() { return kind },
      })
    }],
    ['a non-enumerable field', (query: MutableQuery) => {
      Object.defineProperty(query, 'privateState', {
        configurable: true,
        enumerable: false,
        value: 'must-not-be-ignored',
      })
    }],
    ['a symbol field', (query: MutableQuery) => {
      Object.defineProperty(query, Symbol('privateState'), {
        configurable: true,
        enumerable: true,
        value: 'must-not-be-ignored',
      })
    }],
    ['a non-enumerable required field balanced by an extra field', (query: MutableQuery) => {
      Object.defineProperty(query, 'kind', {
        configurable: true,
        enumerable: false,
        value: query.kind,
      })
      Object.assign(query, { extra: 'must-not-balance-a-required-field' })
    }],
  ] satisfies ReadonlyArray<readonly [string, (query: MutableQuery) => void]>) (
    'rejects a query object with %s',
    async (_name, decorate) => {
      const fixture = ingressFixture('a', 1_000)
      const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
      await vault.retain(fixture.observation)
      const source = createGatewayIngressEvidenceSource(vault, journalReturning(fixture.settled))
      const query = mutateQuery(fixture.query, decorate)

      await expect(source.resolveIngressEvidence(query)).resolves.toEqual({
        status: 'abstained',
        reason: 'evidence-conflict',
      })
    },
  )

  it('rejects a nested accessor without evaluating it', async () => {
    const fixture = ingressFixture('a', 1_000)
    const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
    await vault.retain(fixture.observation)
    const source = createGatewayIngressEvidenceSource(vault, journalReturning(fixture.settled))
    const query = mutateQuery(fixture.query, () => {}) as MutableQuery
    const id = query.session.header.id
    let reads = 0
    Object.defineProperty(query.session.header, 'id', {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1
        return id
      },
    })

    await expect(source.resolveIngressEvidence(query)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    expect(reads).toBe(0)
  })

  it.each([
    ['Session subject', (query: MutableQuery) => {
      Object.defineProperty(query.session, 'privateState', {
        configurable: true,
        enumerable: false,
        value: true,
      })
    }],
    ['enqueue data', (query: MutableQuery) => {
      Object.defineProperty(query.enqueue.data, Symbol('privateState'), {
        configurable: true,
        enumerable: true,
        value: true,
      })
    }],
    ['message source', (query: MutableQuery) => {
      Object.defineProperty(query.enqueue.data.inserted[0]!.source, 'privateState', {
        configurable: true,
        enumerable: false,
        value: true,
      })
    }],
    ['content block', (query: MutableQuery) => {
      Object.defineProperty(query.enqueue.data.inserted[0]!.content[0]!, Symbol('privateState'), {
        configurable: true,
        enumerable: true,
        value: true,
      })
    }],
  ] satisfies ReadonlyArray<readonly [string, (query: MutableQuery) => void]>) (
    'rejects a decorated nested %s',
    async (_name, decorate) => {
      const fixture = ingressFixture('a', 1_000)
      const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
      await vault.retain(fixture.observation)
      const source = createGatewayIngressEvidenceSource(vault, journalReturning(fixture.settled))

      await expect(source.resolveIngressEvidence(
        mutateQuery(fixture.query, decorate),
      )).resolves.toEqual({
        status: 'abstained',
        reason: 'evidence-conflict',
      })
    },
  )

  it.each([
    ['message content', (query: MutableQuery) => query.enqueue.data.inserted[0]!.content],
    ['enqueue insertion', (query: MutableQuery) => query.enqueue.data.inserted],
  ] satisfies ReadonlyArray<readonly [string, (query: MutableQuery) => unknown[]]>) (
    'rejects a custom %s array key',
    async (_name, select) => {
      const fixture = ingressFixture('a', 1_000)
      const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
      await vault.retain(fixture.observation)
      const source = createGatewayIngressEvidenceSource(vault, journalReturning(fixture.settled))
      const query = mutateQuery(fixture.query, query => {
        Object.assign(select(query), {
          privateState: { ignoredByCanonicalArrayHash: true },
        })
      })

      await expect(source.resolveIngressEvidence(query)).resolves.toEqual({
        status: 'abstained',
        reason: 'evidence-conflict',
      })
    },
  )

  it.each(['eventHash', 'contentHash'] as const)(
    'rejects a same-id settled intent whose %s changed across an ABA replacement',
    async field => {
      const fixture = ingressFixture('a', 1_000)
      const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
      await vault.retain(fixture.observation)
      const replaced = {
        ...fixture.settled,
        [field]: hash(field === 'eventHash' ? 'd' : 'e'),
      }
      const source = createGatewayIngressEvidenceSource(vault, journalReturning(replaced))

      await expect(source.resolveIngressEvidence(fixture.query)).resolves.toEqual({
        status: 'abstained',
        reason: 'evidence-conflict',
      })
    },
  )

  it('abstains as unavailable for missing, non-settled, and non-channel ingress', async () => {
    const fixture = ingressFixture('a', 1_000)
    const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
    await vault.retain(fixture.observation)

    for (const record of [
      undefined,
      { ...fixture.settled, status: 'prepared' as const },
      { ...fixture.settled, status: 'executing' as const },
      { ...fixture.settled, status: 'uncertain' as const, error: 'outcome unknown' },
    ]) {
      const source = createGatewayIngressEvidenceSource(vault, journalReturning(record))
      await expect(source.resolveIngressEvidence(fixture.query)).resolves.toEqual({
        status: 'abstained',
        reason: 'evidence-unavailable',
      })
    }

    const nonChannel = mutateQuery(fixture.query, query => {
      query.enqueue.data.inserted[0]!.id = MessageId('ordinary-user-message')
    })
    const source = createGatewayIngressEvidenceSource(vault, journalReturning(fixture.settled))
    await expect(source.resolveIngressEvidence(nonChannel)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
  })

  it('treats a same-id settled command as contradictory retained evidence', async () => {
    const fixture = ingressFixture('a', 1_000)
    const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
    await vault.retain(fixture.observation)
    const source = createGatewayIngressEvidenceSource(vault, journalReturning({
      ...fixture.settled,
      kind: 'command',
      commandResult: { kind: 'success', text: 'not a message effect' },
    }))

    await expect(source.resolveIngressEvidence(fixture.query)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
  })

  it.each([
    ['query schema', (query: MutableQuery) => { Object.assign(query, { schemaVersion: 2 }) }],
    ['query kind', (query: MutableQuery) => { Object.assign(query, { kind: 'other-evidence-query' }) }],
    ['extra query field', (query: MutableQuery) => { Object.assign(query, { extra: true }) }],
    ['Session id', (query: MutableQuery) => { query.session.header.id = SessionId('other-session') }],
    ['Session creation time', (query: MutableQuery) => { query.session.header.createdAt += 1 }],
    ['Session cwd', (query: MutableQuery) => { query.session.header.cwd = '/work/other' }],
    ['inherited event count', (query: MutableQuery) => { query.session.inheritedEventCount += 1 }],
    ['enqueue sequence', (query: MutableQuery) => { Object.assign(query.enqueue, { seq: 1 }) }],
    ['enqueue time', (query: MutableQuery) => { query.enqueue.time += 1 }],
    ['enqueue insertion index', (query: MutableQuery) => { query.enqueue.data.start += 1 }],
    ['message content', (query: MutableQuery) => {
      Object.assign(query.enqueue.data.inserted[0]!.content[0]!, { text: 'tampered' })
    }],
    ['message source', (query: MutableQuery) => {
      Object.assign(query.enqueue.data.inserted[0]!.source, { kind: 'tool' })
    }],
    ['extra enqueue field', (query: MutableQuery) => { Object.assign(query.enqueue, { extra: true }) }],
  ] satisfies ReadonlyArray<readonly [string, (query: MutableQuery) => void]>) (
    'treats a changed %s as conflicting evidence',
    async (_name, mutate) => {
      const fixture = ingressFixture('a', 1_000)
      const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
      await vault.retain(fixture.observation)
      const source = createGatewayIngressEvidenceSource(vault, journalReturning(fixture.settled))

      await expect(source.resolveIngressEvidence(mutateQuery(fixture.query, mutate)))
        .resolves.toEqual({
          status: 'abstained',
          reason: 'evidence-conflict',
        })
    },
  )

  it('promotes contradictory retained observations to a sticky conflict', async () => {
    const fixture = ingressFixture('a', 1_000)
    const memory = memoryFacility()
    const vault = await openGatewayIngressEvidenceVault(memory.facility)
    await vault.retain(fixture.observation)
    await vault.retain({
      ...fixture.observation,
      workspace: {
        ...fixture.observation.workspace,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    })
    await vault.retain(fixture.observation)

    const source = createGatewayIngressEvidenceSource(vault, journalReturning(fixture.settled))
    await expect(source.resolveIngressEvidence(fixture.query)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })

    await vault.close()
    const reopened = await openGatewayIngressEvidenceVault(memory.facility)
    await expect(createGatewayIngressEvidenceSource(
      reopened,
      journalReturning(fixture.settled),
    ).resolveIngressEvidence(fixture.query)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await reopened.close()
  })

  it('rejects undeclared Workspace observation fields instead of hashing private state', async () => {
    const fixture = ingressFixture('a', 1_000)
    const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
    const observation = structuredClone(fixture.observation) as Mutable<
      Extract<GatewayIngressEvidenceObservationV1, { status: 'resolved' }>
    > & { workspace: { privateTitle?: string } }
    observation.workspace.privateTitle = 'must-not-enter-the-evidence-digest'

    await expect(vault.retain(observation)).rejects.toThrow(
      'invalid Gateway Workspace observation',
    )
  })

  it('rejects an accessor-backed observation without evaluating it', async () => {
    const fixture = ingressFixture('a', 1_000)
    const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
    const observation = structuredClone(fixture.observation) as MutableResolvedObservation
    const id = observation.workspace.id
    let reads = 0
    Object.defineProperty(observation.workspace, 'id', {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1
        return id
      },
    })

    await expect(vault.retain(observation)).rejects.toThrow(
      'invalid Gateway Workspace observation',
    )
    expect(reads).toBe(0)
  })

  it.each([
    ['a string Session sequence', (observation: MutableResolvedObservation) => {
      Object.assign(observation.enqueue, { seq: '0' })
    }],
    ['a non-alpha.5 Session version', (observation: MutableResolvedObservation) => {
      observation.session.header.version = 1
    }],
    ['a relative Session cwd', (observation: MutableResolvedObservation) => {
      observation.workspace.path = 'relative/workspace'
      observation.session.header.cwd = 'relative/workspace'
    }],
    ['a non-Gateway content block', (observation: MutableResolvedObservation) => {
      const content = [{ type: 'private-tree', payload: { nested: true } }]
      observation.message.content = content as never
      observation.enqueue.data.inserted[0]!.content = content as never
    }],
  ] satisfies ReadonlyArray<readonly [string, (observation: MutableResolvedObservation) => void]>) (
    'refuses to retain %s as native alpha.5 evidence',
    async (_name, mutate) => {
      const fixture = ingressFixture('a', 1_000)
      const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
      const observation = structuredClone(fixture.observation) as MutableResolvedObservation
      mutate(observation)

      await expect(vault.retain(observation)).rejects.toThrow()
    },
  )

  it('prunes the oldest retained evidence at the configured bound', async () => {
    const first = ingressFixture('a', 1_000)
    const second = ingressFixture('d', 2_000)
    const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility, { maxRecords: 1 })
    await vault.retain(first.observation)
    await vault.retain(second.observation)

    const firstSource = createGatewayIngressEvidenceSource(vault, journalReturning(first.settled))
    await expect(firstSource.resolveIngressEvidence(first.query)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    const secondSource = createGatewayIngressEvidenceSource(vault, journalReturning(second.settled))
    await expect(secondSource.resolveIngressEvidence(second.query)).resolves.toMatchObject({
      status: 'matched',
      fact: { workspaceId: second.settled.workspaceId },
    })
  })

  it('uses ingress creation order rather than delayed enqueue time for retention', async () => {
    const first = withIngressCreatedAt(ingressFixture('a', 3_000), 100)
    const second = withIngressCreatedAt(ingressFixture('d', 1_000), 200)
    const third = withIngressCreatedAt(ingressFixture('7', 2_000), 300)
    const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility, { maxRecords: 2 })
    await vault.retain(first.observation)
    await vault.retain(second.observation)
    await vault.retain(third.observation)

    await expect(createGatewayIngressEvidenceSource(
      vault,
      journalReturning(first.settled),
    ).resolveIngressEvidence(first.query)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    for (const retained of [second, third]) {
      await expect(createGatewayIngressEvidenceSource(
        vault,
        journalReturning(retained.settled),
      ).resolveIngressEvidence(retained.query)).resolves.toMatchObject({ status: 'matched' })
    }
  })

  it('enforces a reduced retention bound before a reopened source is published', async () => {
    const memory = memoryFacility()
    const first = withIngressCreatedAt(ingressFixture('a', 1_000), 100)
    const second = withIngressCreatedAt(ingressFixture('d', 2_000), 200)
    const initial = await openGatewayIngressEvidenceVault(memory.facility, { maxRecords: 2 })
    await initial.retain(first.observation)
    await initial.retain(second.observation)
    await initial.close()

    const reopened = await openGatewayIngressEvidenceVault(memory.facility, { maxRecords: 1 })
    await expect(createGatewayIngressEvidenceSource(
      reopened,
      journalReturning(first.settled),
    ).resolveIngressEvidence(first.query)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await expect(createGatewayIngressEvidenceSource(
      reopened,
      journalReturning(second.settled),
    ).resolveIngressEvidence(second.query)).resolves.toMatchObject({ status: 'matched' })
  })

  it('drains writes on close and preserves retained evidence across reopen', async () => {
    const fixture = ingressFixture('a', 1_000)
    const memory = memoryFacility()
    const first = await openGatewayIngressEvidenceVault(memory.facility)
    const pending = first.retain(fixture.observation)
    await first.close()
    await expect(pending).resolves.toBeUndefined()
    await expect(first.retain(fixture.observation)).rejects.toThrow('closing')

    const reopened = await openGatewayIngressEvidenceVault(memory.facility)
    const source = createGatewayIngressEvidenceSource(reopened, journalReturning(fixture.settled))
    await expect(source.resolveIngressEvidence(fixture.query)).resolves.toMatchObject({
      status: 'matched',
      fact: { workspaceId: fixture.settled.workspaceId },
    })
    expect(memory.closeCount()).toBe(1)
    await reopened.close()
    expect(memory.closeCount()).toBe(2)
  })

  it('rejects retention before cloning and returns unavailable once close starts', async () => {
    const fixture = ingressFixture('a', 1_000)
    const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
    await vault.retain(fixture.observation)
    const source = createGatewayIngressEvidenceSource(vault, journalReturning(fixture.settled))
    await vault.close()

    const hostile = new Proxy(fixture.observation, {
      ownKeys() { throw new Error('observation was inspected after close') },
    })
    const hostileQuery = new Proxy(fixture.query, {
      ownKeys() { throw new Error('query was inspected after close') },
    })
    await expect(vault.retain(hostile)).rejects.toThrow('closing')
    await expect(source.resolveIngressEvidence(hostileQuery)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
  })

  it('returns unavailable when a valid query starts close during normalization', async () => {
    const fixture = ingressFixture('a', 1_000)
    const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
    await vault.retain(fixture.observation)
    let journalReads = 0
    const source = createGatewayIngressEvidenceSource(vault, {
      get(id: string) {
        journalReads += 1
        return id === fixture.settled.id
          ? structuredClone(fixture.settled)
          : undefined
      },
    } as GatewayIngressJournal)
    let closing: Promise<void> | undefined
    const reentrant = new Proxy(fixture.query, {
      getPrototypeOf(target) {
        closing = vault.close()
        return Reflect.getPrototypeOf(target)
      },
    })

    await expect(source.resolveIngressEvidence(reentrant)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    expect(journalReads).toBe(0)
    await closing
  })

  it('returns unavailable when a query starts close and then fails normalization', async () => {
    const fixture = ingressFixture('a', 1_000)
    const vault = await openGatewayIngressEvidenceVault(memoryFacility().facility)
    await vault.retain(fixture.observation)
    const source = createGatewayIngressEvidenceSource(vault, journalReturning(fixture.settled))
    let closing: Promise<void> | undefined
    const reentrant = new Proxy(fixture.query, {
      getPrototypeOf() {
        closing = vault.close()
        throw new Error('hostile query trap')
      },
    })

    await expect(source.resolveIngressEvidence(reentrant)).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await closing
  })

  it('fails closed when a retained record digest is corrupted', async () => {
    const fixture = ingressFixture('a', 1_000)
    const memory = memoryFacility()
    const vault = await openGatewayIngressEvidenceVault(memory.facility)
    await vault.retain(fixture.observation)
    await vault.close()
    memory.table.mutate(fixture.settled.id, record => ({
      ...record,
      recordDigest: hash('0'),
    }))

    await expect(openGatewayIngressEvidenceVault(memory.facility))
      .rejects.toThrow('failed integrity audit')
  })

  it('fails closed when a retained record is stored under a different key', async () => {
    const fixture = ingressFixture('a', 1_000)
    const memory = memoryFacility()
    const vault = await openGatewayIngressEvidenceVault(memory.facility)
    await vault.retain(fixture.observation)
    await vault.close()
    memory.table.move(fixture.settled.id, hash('f'))

    await expect(openGatewayIngressEvidenceVault(memory.facility))
      .rejects.toThrow('does not match row id')
  })
})

interface IngressFixture {
  readonly observation: Extract<GatewayIngressEvidenceObservationV1, { status: 'resolved' }>
  readonly query: GatewayIngressEvidenceQueryV1
  readonly settled: GatewayIngressRecord
}

function ingressFixture(idNibble: string, observedAt: number): IngressFixture {
  const id = hash(idNibble)
  const workspaceId = `workspace-${idNibble}`
  const cwd = `/work/${idNibble}`
  const sessionId = SessionId(`session-${idNibble}`)
  const header: SessionHeader = {
    version: 0,
    id: sessionId,
    createdAt: observedAt - 100,
    cwd,
    isSeeded: false,
    agentPreset: 'standard',
  }
  const message = freezeMessage({
    id: MessageId(`channel:${id}`),
    role: 'user' as const,
    source: { kind: 'user' as const },
    content: [{ type: 'text' as const, text: `hello-${idNibble}` }],
  })
  const enqueue = {
    type: 'agent/inbox/spliced',
    seq: 0,
    time: observedAt,
    data: {
      target: 'next-turn',
      start: 0,
      inserted: [message],
    },
  } as unknown as SessionEvent<'agent/inbox/spliced'>
  const executing: GatewayIngressRecord = {
    id,
    schemaVersion: 1,
    routeId: `route-${idNibble}`,
    workspaceId,
    sessionId: String(sessionId),
    eventHash: hash(nextNibble(idNibble, 1)),
    contentHash: sha256(`hello-${idNibble}`),
    kind: 'message',
    status: 'executing',
    createdAt: observedAt - 10,
    updatedAt: observedAt - 5,
  }
  const observation = {
    status: 'resolved',
    ingress: executing,
    workspace: {
      id: workspaceId,
      path: cwd,
      createdAt: new Date(observedAt).toISOString(),
    },
    session: {
      header,
      inheritedEventCount: 0,
    },
    message,
    enqueue,
  } satisfies GatewayIngressEvidenceObservationV1

  return {
    observation,
    query: {
      schemaVersion: 1,
      kind: 'gateway-ingress-evidence-query-v1',
      session: structuredClone(observation.session),
      enqueue: structuredClone(enqueue),
    },
    settled: {
      ...executing,
      status: 'settled',
      updatedAt: observedAt + 1,
    },
  }
}

function nextNibble(nibble: string, offset: number): string {
  return ((Number.parseInt(nibble, 16) + offset) % 16).toString(16)
}

function hash(nibble: string): string {
  return nibble.repeat(64)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function journalReturning(record: GatewayIngressRecord | undefined): GatewayIngressJournal {
  return {
    get(id: string) {
      return record?.id === id ? structuredClone(record) : undefined
    },
  } as GatewayIngressJournal
}

type Mutable<T> = T extends string | number | boolean | bigint | symbol | null | undefined
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : T extends readonly (infer Item)[]
      ? Mutable<Item>[]
      : T extends object
        ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
        : T

type MutableQuery = Mutable<GatewayIngressEvidenceQueryV1>
type MutableResolvedObservation = Mutable<
  Extract<GatewayIngressEvidenceObservationV1, { status: 'resolved' }>
>

function mutateQuery(
  query: GatewayIngressEvidenceQueryV1,
  mutate: (query: MutableQuery) => void,
): GatewayIngressEvidenceQueryV1 {
  const copy = structuredClone(query) as MutableQuery
  mutate(copy)
  return copy
}

function withIngressCreatedAt(fixture: IngressFixture, createdAt: number): IngressFixture {
  return {
    ...fixture,
    observation: {
      ...fixture.observation,
      ingress: {
        ...fixture.observation.ingress,
        createdAt,
        updatedAt: createdAt,
      },
    },
    settled: {
      ...fixture.settled,
      createdAt,
      updatedAt: createdAt + 1,
    },
  }
}

function memoryFacility(): {
  readonly facility: DomainFacility
  readonly table: MemoryTable<Record<string, unknown>>
  readonly closeCount: () => number
} {
  const table = new MemoryTable<Record<string, unknown>>()
  let closes = 0
  return {
    table,
    closeCount: () => closes,
    facility: {
      async open() {
        return {
          name: 'evoforge_gateway_ingress_evidence',
          global: { get: () => ({}), async set() {} },
          table: () => table,
          async close() { closes += 1 },
        }
      },
    } as unknown as DomainFacility,
  }
}

class MemoryTable<V> implements KvTable<string, V> {
  private readonly records = new Map<string, V>()
  private beforeGet: (() => void) | undefined
  private beforePut: (() => Promise<void>) | undefined

  get size(): number { return this.records.size }
  get(key: string): V | undefined {
    const beforeGet = this.beforeGet
    this.beforeGet = undefined
    beforeGet?.()
    return this.records.get(key)
  }
  entries(): IterableIterator<[string, V]> { return new Map(this.records).entries() }
  keys(): IterableIterator<string> { return new Map(this.records).keys() }
  async put(key: string, value: V): Promise<void> {
    const beforePut = this.beforePut
    this.beforePut = undefined
    await beforePut?.()
    this.records.set(key, structuredClone(value))
  }
  async delete(key: string): Promise<boolean> { return this.records.delete(key) }
  async update(key: string, transform: (current: V) => V): Promise<V> {
    const current = this.records.get(key)
    if (current === undefined) throw new Error(`missing key ${key}`)
    const next = structuredClone(transform(structuredClone(current)))
    this.records.set(key, next)
    return next
  }

  beforeNextPut(beforePut: () => Promise<void>): void {
    this.beforePut = beforePut
  }

  beforeNextGet(beforeGet: () => void): void {
    this.beforeGet = beforeGet
  }

  mutate(key: string, transform: (current: V) => V): void {
    const current = this.records.get(key)
    if (current === undefined) throw new Error(`missing key ${key}`)
    this.records.set(key, structuredClone(transform(structuredClone(current))))
  }

  move(from: string, to: string): void {
    const current = this.records.get(from)
    if (current === undefined) throw new Error(`missing key ${from}`)
    this.records.delete(from)
    this.records.set(to, current)
  }
}
