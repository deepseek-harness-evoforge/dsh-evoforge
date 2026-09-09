import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
  type KvTable,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { GatewayIngressJournal, GatewayIngressRecord } from './ingress-journal.js'

const EVIDENCE_DOMAIN = 'evoforge_gateway_ingress_evidence'
const EVIDENCE_DOMAIN_VERSION = 1
const DEFAULT_MAX_RECORDS = 10_000
const MAX_MESSAGE_TEXT_BYTES = 1_048_576
const MAX_MESSAGE_IMAGES = 100
const MAX_SESSION_ID_BYTES = 512
const MAX_SESSION_CWD_BYTES = 16_384

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const messageIdSchema = z.string().regex(/^channel:[a-f0-9]{64}$/u)

const resolvedRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  state: z.literal('resolved'),
  id: hashSchema,
  workspaceId: z.string().min(1).max(512),
  ingressIntentDigest: hashSchema,
  workspaceIdentityDigest: hashSchema,
  sessionLifecycleDigest: hashSchema,
  messageId: messageIdSchema,
  messageDigest: hashSchema,
  enqueueSeq: safeInteger,
  enqueueDigest: hashSchema,
  ingressCreatedAt: safeInteger,
  recordDigest: hashSchema,
})

const conflictRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  state: z.literal('conflict'),
  id: hashSchema,
  ingressCreatedAt: safeInteger,
  recordDigest: hashSchema,
})

// StorageDomain is a trusted local authority. `recordDigest` detects torn,
// stale, or cross-key rows; it is deliberately not presented as a MAC against
// an operator who can rewrite both the ingress and evidence domains.

const evidenceRecordSchema = z.discriminatedUnion('state', [
  resolvedRecordSchema,
  conflictRecordSchema,
])

type GatewayIngressEvidenceRecordV1 = z.infer<typeof evidenceRecordSchema>

const ingressEvidenceDomainSpec = defineDomain({
  name: EVIDENCE_DOMAIN,
  version: EVIDENCE_DOMAIN_VERSION,
  // A malformed ticket invalidates this authority as a whole. Silently
  // skipping one row would turn corruption into a false claim of absence.
  layout: 'single',
  tables: {
    evidence: domainTable<string, GatewayIngressEvidenceRecordV1>(evidenceRecordSchema),
  },
})

type GatewayIngressEvidenceDomain = Domain<typeof ingressEvidenceDomainSpec>

export interface GatewayIngressEvidenceQueryV1 {
  readonly schemaVersion: 1
  readonly kind: 'gateway-ingress-evidence-query-v1'
  readonly session: {
    /** Complete DSH Session lifecycle identity, not an id/time projection. */
    readonly header: SessionHeader
    readonly inheritedEventCount: number
  }
  /** Exact physically read-back enqueue selected by the Evolve resolver. */
  readonly enqueue: SessionEvent<'agent/inbox/spliced'>
}

export type GatewayIngressEvidenceResolutionV1 =
  | {
    readonly status: 'matched'
    readonly fact: {
      readonly schemaVersion: 1
      readonly kind: 'gateway-ingress-workspace-fact-v1'
      readonly workspaceId: string
    }
  }
  | {
    readonly status: 'abstained'
    readonly reason: 'evidence-unavailable' | 'evidence-conflict'
  }

/** Least-authority historical service; it cannot dispatch or inspect routes. */
export interface GatewayIngressEvidenceSourceV1 {
  resolveIngressEvidence(
    query: GatewayIngressEvidenceQueryV1,
  ): Promise<GatewayIngressEvidenceResolutionV1>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'evoforge.gatewayIngressEvidence': GatewayIngressEvidenceSourceV1
  }
}

export type GatewayIngressEvidenceObservationV1 =
  | {
    readonly status: 'resolved'
    readonly ingress: GatewayIngressRecord
    readonly workspace: {
      readonly id: string
      readonly path: string
      readonly createdAt: string
    }
    readonly session: {
      readonly header: SessionHeader
      readonly inheritedEventCount: number
    }
    readonly message: UserMessage
    readonly enqueue: SessionEvent<'agent/inbox/spliced'>
  }
  | {
    readonly status: 'conflict'
    readonly ingress: GatewayIngressRecord
  }

/** @internal Mutable capability owned only by the Gateway runtime. */
export interface GatewayIngressEvidenceVaultV1 {
  retain(observation: GatewayIngressEvidenceObservationV1): Promise<void>
  resolve(
    query: GatewayIngressEvidenceQueryV1,
    intentFor: (id: string) => GatewayIngressRecord | undefined,
  ): Promise<GatewayIngressEvidenceResolutionV1>
  close(): Promise<void>
}

export interface GatewayIngressEvidenceVaultOptions {
  /** Bound aligned with the operator's primary ingress retention policy. */
  readonly maxRecords?: number
}

class DomainGatewayIngressEvidenceVault implements GatewayIngressEvidenceVaultV1 {
  private tail: Promise<void> = Promise.resolve()
  private closing: Promise<void> | undefined
  // Live-vault backstop for conflict transitions whose durable put may fail.
  // Every entry remains tied to a retained row and leaves with its pruning.
  private readonly volatileConflicts = new Set<string>()

  constructor(
    private readonly domain: GatewayIngressEvidenceDomain,
    private readonly maxRecords: number,
    private readonly retention: EvidenceRetentionHeap,
  ) {}

  retain(observation: GatewayIngressEvidenceObservationV1): Promise<void> {
    if (this.closing !== undefined) {
      return Promise.reject(new Error('gateway ingress evidence vault is closing'))
    }
    let candidate: GatewayIngressEvidenceRecordV1
    try {
      // Normalize synchronously so the queued write retains neither mutable
      // Host aliases nor unchecked caller-owned object graphs.
      candidate = normalizeObservation(observation)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.write(async () => {
      const table = this.domain.table('evidence')
      const existing = table.get(candidate.id)
      if (existing !== undefined) {
        if (existing.state === 'conflict') {
          this.volatileConflicts.add(candidate.id)
          return
        }
        if (isDeepStrictEqual(existing, candidate)) return
        // Poison this exact id before attempting the durable transition. A
        // rejected put must never expose the stale resolved row as a match
        // while this vault remains live.
        this.volatileConflicts.add(candidate.id)
        await table.put(candidate.id, conflictRecord(
          candidate.id,
          existing.ingressCreatedAt,
        ))
        return
      }
      await pruneOldest(
        table,
        this.retention,
        this.maxRecords - 1,
        id => { this.volatileConflicts.delete(id) },
      )
      await table.put(candidate.id, candidate)
      this.retention.add(candidate)
      if (candidate.state === 'conflict') this.volatileConflicts.add(candidate.id)
    })
  }

  async resolve(
    rawQuery: GatewayIngressEvidenceQueryV1,
    intentFor: (id: string) => GatewayIngressRecord | undefined,
  ): Promise<GatewayIngressEvidenceResolutionV1> {
    // Capture the cutoff synchronously: later retains must not move this read
    // behind work that was accepted after the caller started its query.
    if (this.closing !== undefined) return abstained('evidence-unavailable')
    const acceptedWrites = this.tail
    await acceptedWrites
    // close() also drains this cutoff, but a read that loses the lifecycle race
    // remains unavailable and must not inspect an untrusted query.
    if (this.closing !== undefined) return abstained('evidence-unavailable')
    let query: NormalizedQuery
    try {
      query = normalizeQuery(rawQuery)
    } catch {
      return abstained(this.closing === undefined
        ? 'evidence-conflict'
        : 'evidence-unavailable')
    }
    if (this.closing !== undefined) return abstained('evidence-unavailable')
    const id = query.ingressId
    if (id === undefined) return abstained('evidence-unavailable')
    if (this.volatileConflicts.has(id)) return abstained('evidence-conflict')

    let retained: GatewayIngressEvidenceRecordV1 | undefined
    try {
      retained = this.domain.table('evidence').get(id)
    } catch (error) {
      throw new Error('gateway ingress evidence read failed', { cause: error })
    }
    if (retained === undefined) return abstained('evidence-unavailable')
    if (retained.state === 'conflict') return abstained('evidence-conflict')
    const intent = intentFor(id)
    if (intent === undefined || intent.status !== 'settled') {
      return abstained('evidence-unavailable')
    }
    if (intent.kind !== 'message') return abstained('evidence-conflict')

    try {
      const matches = intent.id === id
        && ingressIntentDigest(intent) === retained.ingressIntentDigest
        && intent.workspaceId === retained.workspaceId
        && String(query.header.id) === intent.sessionId
        && query.sessionLifecycleDigest === retained.sessionLifecycleDigest
        && query.enqueue.message.id === retained.messageId
        && query.messageDigest === retained.messageDigest
        && query.enqueue.event.seq === retained.enqueueSeq
        && enqueueDigest(retained, query.enqueue) === retained.enqueueDigest
      if (!matches) return abstained('evidence-conflict')
      return immutable({
        status: 'matched',
        fact: {
          schemaVersion: 1,
          kind: 'gateway-ingress-workspace-fact-v1',
          workspaceId: retained.workspaceId,
        },
      } as const)
    } catch {
      return abstained('evidence-conflict')
    }
  }

  close(): Promise<void> {
    this.closing ??= this.tail.then(() => this.domain.close())
    return this.closing
  }

  private write(operation: () => Promise<void>): Promise<void> {
    if (this.closing !== undefined) {
      return Promise.reject(new Error('gateway ingress evidence vault is closing'))
    }
    const result = this.tail.then(operation)
    this.tail = result.then(() => {}, () => {})
    return result
  }
}

/** @internal Opened and owned by the Gateway plugin lifecycle. */
export async function openGatewayIngressEvidenceVault(
  facility: DomainFacility,
  options: GatewayIngressEvidenceVaultOptions = {},
): Promise<GatewayIngressEvidenceVaultV1> {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
    throw new Error('gateway ingress evidence maxRecords must be a positive safe integer')
  }
  const domain = await facility.open(ingressEvidenceDomainSpec)
  try {
    auditEvidence(domain)
    const retention = new EvidenceRetentionHeap(domain.table('evidence').entries())
    await pruneOldest(domain.table('evidence'), retention, maxRecords)
    return new DomainGatewayIngressEvidenceVault(domain, maxRecords, retention)
  } catch (auditError) {
    try {
      await domain.close()
    } catch (closeError) {
      throw new AggregateError(
        [auditError, closeError],
        'Gateway ingress evidence audit and domain cleanup both failed',
      )
    }
    throw auditError
  }
}

/** @internal Construct the one-method facade published by the Gateway plugin. */
export function createGatewayIngressEvidenceSource(
  vault: GatewayIngressEvidenceVaultV1,
  journal: GatewayIngressJournal,
): GatewayIngressEvidenceSourceV1 {
  return Object.freeze({
    async resolveIngressEvidence(query: GatewayIngressEvidenceQueryV1) {
      return await vault.resolve(query, id => journal.get(id))
    },
  })
}

function normalizeObservation(
  observation: GatewayIngressEvidenceObservationV1,
): GatewayIngressEvidenceRecordV1 {
  const values = onlyOwnData(observation, [
    'status', 'ingress', 'workspace', 'session', 'message', 'enqueue',
  ])
  if (values === undefined) {
    throw new Error('invalid Gateway ingress evidence observation')
  }
  if (values.status === 'conflict') {
    if (!hasExactDataKeys(values, ['status', 'ingress'])) {
      throw new Error('invalid Gateway ingress evidence conflict')
    }
    const ingress = exactMessageIntent(values.ingress)
    if (ingress.status !== 'executing' || ingress.kind !== 'message') {
      throw new Error('invalid Gateway ingress evidence conflict intent')
    }
    return conflictRecord(
      ingress.id,
      ingress.createdAt,
    )
  }
  if (values.status !== 'resolved'
    || !hasExactDataKeys(
      values,
      ['status', 'ingress', 'workspace', 'session', 'message', 'enqueue'],
    )) {
    throw new Error('invalid Gateway ingress evidence observation')
  }
  const ingress = exactMessageIntent(values.ingress)
  const workspaceValues = exactOwnData(values.workspace, ['id', 'path', 'createdAt'])
  if (workspaceValues === undefined) {
    throw new Error('invalid Gateway Workspace observation')
  }
  const workspace = {
    id: workspaceValues.id,
    path: workspaceValues.path,
    createdAt: workspaceValues.createdAt,
  }
  const session = normalizeSession(
    values.session as GatewayIngressEvidenceQueryV1['session'],
  )
  const message = normalizeMessage(values.message)
  const enqueue = normalizeEnqueue(
    values.enqueue as SessionEvent<'agent/inbox/spliced'>,
  )
  if (ingress.status !== 'executing'
    || ingress.kind !== 'message'
    || ingress.workspaceId !== workspace.id
    || ingress.sessionId !== String(session.header.id)
    || session.header.cwd !== workspace.path
    || message.id !== `channel:${ingress.id}`
    || ingress.contentHash !== gatewayMessageContentHash(message)
    || enqueue.message.id !== message.id
    || !isDeepStrictEqual(enqueue.message, message)
    || enqueue.event.seq < session.inheritedEventCount
    || !isBoundedText(workspace.id, 512)
    || !isBoundedText(workspace.path, MAX_SESSION_CWD_BYTES)
    || !isAbsolute(workspace.path)
    || !isCanonicalIsoTime(workspace.createdAt)) {
    throw new Error('gateway ingress evidence observation does not match its Host boundary')
  }
  const content = {
    schemaVersion: 1 as const,
    state: 'resolved' as const,
    id: ingress.id,
    workspaceId: workspace.id,
    ingressIntentDigest: ingressIntentDigest(ingress),
    workspaceIdentityDigest: hashCanonical({
      domain: 'evoforge_gateway_workspace_identity',
      version: 1,
      workspace,
    }),
    sessionLifecycleDigest: sessionLifecycleDigest(
      session.header,
      session.inheritedEventCount,
    ),
    messageId: message.id,
    messageDigest: messageDigest(message),
    enqueueSeq: enqueue.event.seq,
    enqueueDigest: '',
    ingressCreatedAt: ingress.createdAt,
  }
  const withEnqueue = {
    ...content,
    enqueueDigest: enqueueDigest(content, enqueue),
  }
  return stampRecord(withEnqueue, resolvedRecordSchema)
}

function exactMessageIntent(input: unknown): GatewayIngressRecord {
  const required = [
    'id', 'schemaVersion', 'routeId', 'workspaceId', 'sessionId', 'eventHash',
    'contentHash', 'kind', 'status', 'createdAt', 'updatedAt',
  ] as const
  const values = onlyOwnData(input, [...required, 'error'])
  if (values === undefined
    || !required.every(key => Object.hasOwn(values, key))
    || values.schemaVersion !== 1
    || values.kind !== 'message'
    || typeof values.status !== 'string'
    || !['prepared', 'executing', 'settled', 'uncertain'].includes(values.status)
    || values.id !== exactHash(values.id as string, 'ingress id')
    || !isBoundedText(values.routeId, 64)
    || !isBoundedText(values.workspaceId, 512)
    || !isBoundedText(values.sessionId, 512)
    || values.eventHash !== exactHash(values.eventHash as string, 'event hash')
    || values.contentHash !== exactHash(values.contentHash as string, 'content hash')
    || !isSafeNonNegative(values.createdAt)
    || !isSafeNonNegative(values.updatedAt)
    || (values.status === 'uncertain'
      ? !isBoundedText(values.error, 16_384)
      : values.error !== undefined)) {
    throw new Error('invalid gateway message intent')
  }
  return {
    id: values.id,
    schemaVersion: values.schemaVersion,
    routeId: values.routeId,
    workspaceId: values.workspaceId,
    sessionId: values.sessionId,
    eventHash: values.eventHash,
    contentHash: values.contentHash,
    kind: values.kind,
    status: values.status,
    createdAt: values.createdAt,
    updatedAt: values.updatedAt,
    ...(Object.hasOwn(values, 'error') ? { error: values.error } : {}),
  } as GatewayIngressRecord
}

function ingressIntentDigest(intent: GatewayIngressRecord): string {
  const exact = exactMessageIntent(intent)
  return hashCanonical({
    domain: 'evoforge_gateway_ingress_intent',
    version: 1,
    intent: {
      id: exact.id,
      routeId: exact.routeId,
      workspaceId: exact.workspaceId,
      sessionId: exact.sessionId,
      eventHash: exact.eventHash,
      contentHash: exact.contentHash,
      kind: exact.kind,
      createdAt: exact.createdAt,
    },
  })
}

interface NormalizedSession {
  readonly header: SessionHeader
  readonly inheritedEventCount: number
}

interface NormalizedEnqueue {
  readonly event: SessionEvent<'agent/inbox/spliced'>
  readonly message: UserMessage & { readonly id: string }
}

interface NormalizedQuery extends NormalizedSession {
  readonly enqueue: NormalizedEnqueue
  readonly ingressId: string | undefined
  readonly sessionLifecycleDigest: string
  readonly messageDigest: string
}

function normalizeQuery(query: GatewayIngressEvidenceQueryV1): NormalizedQuery {
  const values = exactOwnData(query, ['schemaVersion', 'kind', 'session', 'enqueue'])
  if (values === undefined
    || values.schemaVersion !== 1
    || values.kind !== 'gateway-ingress-evidence-query-v1') {
    throw new Error('invalid gateway ingress evidence query')
  }
  const session = normalizeSession(
    values.session as GatewayIngressEvidenceQueryV1['session'],
  )
  const enqueue = normalizeEnqueue(
    values.enqueue as GatewayIngressEvidenceQueryV1['enqueue'],
  )
  return Object.freeze({
    ...session,
    enqueue,
    ingressId: ingressIdFromMessage(enqueue.message.id),
    sessionLifecycleDigest: sessionLifecycleDigest(
      session.header,
      session.inheritedEventCount,
    ),
    messageDigest: messageDigest(enqueue.message),
  })
}

function normalizeSession(raw: GatewayIngressEvidenceQueryV1['session']): NormalizedSession {
  const values = exactOwnData(raw, ['header', 'inheritedEventCount'])
  if (values === undefined) {
    throw new Error('invalid gateway ingress Session subject')
  }
  const header = normalizeSessionHeader(values.header)
  if (!isSafeNonNegative(values.inheritedEventCount)) {
    throw new Error('invalid gateway ingress inherited event count')
  }
  return immutable({
    header,
    inheritedEventCount: values.inheritedEventCount,
  })
}

function normalizeEnqueue(raw: SessionEvent<'agent/inbox/spliced'>): NormalizedEnqueue {
  const values = exactOwnData(raw, ['type', 'seq', 'time', 'data'])
  const data = exactOwnData(values?.data, ['target', 'start', 'inserted'])
  const inserted = exactArrayData(data?.inserted, 1, 1)
  if (values === undefined
    || values.type !== 'agent/inbox/spliced'
    || !isSafeNonNegative(values.seq)
    || !isSafeNonNegative(values.time)
    || data === undefined
    || data.target !== 'next-turn'
    || !isSafeNonNegative(data.start)
    || inserted === undefined) {
    throw new Error('invalid Gateway inbox insertion')
  }
  const message = normalizeMessage(inserted[0])
  const event = immutable({
    type: values.type,
    seq: values.seq,
    time: values.time,
    data: {
      target: data.target,
      start: data.start,
      inserted: [message],
    },
  }) as SessionEvent<'agent/inbox/spliced'>
  return Object.freeze({
    event,
    message: event.data.inserted[0] as UserMessage & { readonly id: string },
  })
}

function normalizeSessionHeader(header: unknown): SessionHeader {
  const values = onlyOwnData(header, [
    'version', 'id', 'createdAt', 'cwd', 'parentSession', 'isSeeded',
    'origin', 'delegationDepth', 'agentPreset',
  ])
  if (values === undefined
    || values.version !== SESSION_FORMAT_VERSION
    || !isBoundedText(values.id, MAX_SESSION_ID_BYTES)
    || !isSafeNonNegative(values.createdAt)
    || typeof values.isSeeded !== 'boolean'
    || !isBoundedText(values.cwd, MAX_SESSION_CWD_BYTES)
    || !isAbsolute(values.cwd)
    || (values.parentSession !== undefined
      && !isBoundedText(values.parentSession, MAX_SESSION_ID_BYTES))
    || (values.origin !== undefined && values.origin !== 'subagent')
    || (values.delegationDepth !== undefined
      && !isSafeNonNegative(values.delegationDepth))
    || (values.agentPreset !== undefined && !isBoundedText(values.agentPreset, 128))) {
    throw new Error('invalid Gateway Session header')
  }
  return {
    version: values.version,
    id: values.id,
    createdAt: values.createdAt,
    cwd: values.cwd,
    isSeeded: values.isSeeded,
    ...(Object.hasOwn(values, 'parentSession')
      ? { parentSession: values.parentSession }
      : {}),
    ...(Object.hasOwn(values, 'origin') ? { origin: values.origin } : {}),
    ...(Object.hasOwn(values, 'delegationDepth')
      ? { delegationDepth: values.delegationDepth }
      : {}),
    ...(Object.hasOwn(values, 'agentPreset')
      ? { agentPreset: values.agentPreset }
      : {}),
  } as SessionHeader
}

function normalizeMessage(value: unknown): UserMessage & { readonly id: string } {
  const values = exactOwnData(value, ['id', 'role', 'content', 'source'])
  const content = exactArrayData(values?.content, 1, MAX_MESSAGE_IMAGES + 1)
  const source = exactOwnData(values?.source, ['kind'])
  if (values === undefined
    || !isBoundedText(values.id, 1_024)
    || values.role !== 'user'
    || content === undefined
    || source === undefined
    || source.kind !== 'user') {
    throw new Error('invalid Gateway user message')
  }

  let images = 0
  const normalizedContent = content.map((block, index) => {
    const text = exactOwnData(block, ['type', 'text'])
    if (text?.type === 'text') {
      if (index !== 0
        || !isBoundedText(text.text, MAX_MESSAGE_TEXT_BYTES)) {
        throw new Error('invalid Gateway text content block')
      }
      return { type: text.type, text: text.text }
    }
    const image = exactOwnData(block, ['type', 'attachment'])
    if (image?.type !== 'image') {
      throw new Error('invalid Gateway message content block')
    }
    images += 1
    if (images > MAX_MESSAGE_IMAGES) throw new Error('too many Gateway image content blocks')
    return {
      type: image.type,
      attachment: normalizeGatewayImageAttachment(image.attachment),
    }
  })
  return immutable({
    id: values.id,
    role: values.role,
    content: normalizedContent,
    source: { kind: source.kind },
  }) as UserMessage & { readonly id: string }
}

function normalizeGatewayImageAttachment(value: unknown): ImageAttachmentRef {
  const required = ['attachmentId', 'mediaType', 'bytes', 'width', 'height'] as const
  const values = onlyOwnData(value, [...required, 'name', 'originalDimensions'])
  if (values === undefined
    || !required.every(key => Object.hasOwn(values, key))
    || typeof values.attachmentId !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(values.attachmentId)
    || typeof values.mediaType !== 'string'
    || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(values.mediaType)
    || !isSafePositive(values.bytes)
    || !isSafePositive(values.width)
    || !isSafePositive(values.height)
    || (values.name !== undefined && !isSafeImageName(values.name))) {
    throw new Error('invalid Gateway image attachment')
  }
  let originalDimensions: Readonly<Record<string, unknown>> | undefined
  if (values.originalDimensions !== undefined) {
    originalDimensions = exactOwnData(values.originalDimensions, ['width', 'height'])
    if (originalDimensions === undefined
      || !isSafePositive(originalDimensions.width)
      || !isSafePositive(originalDimensions.height)
      || originalDimensions.width < values.width
      || originalDimensions.height < values.height
      || (originalDimensions.width === values.width
        && originalDimensions.height === values.height)) {
      throw new Error('invalid Gateway image original dimensions')
    }
  }
  return {
    attachmentId: values.attachmentId,
    mediaType: values.mediaType,
    bytes: values.bytes,
    width: values.width,
    height: values.height,
    ...(Object.hasOwn(values, 'name') ? { name: values.name } : {}),
    ...(Object.hasOwn(values, 'originalDimensions')
      ? {
        originalDimensions: originalDimensions === undefined
          ? undefined
          : {
            width: originalDimensions.width,
            height: originalDimensions.height,
          },
      }
      : {}),
  } as ImageAttachmentRef
}

function sessionLifecycleDigest(header: SessionHeader, inheritedEventCount: number): string {
  return hashCanonical({
    domain: 'evoforge_gateway_session_lifecycle',
    version: 1,
    header,
    inheritedEventCount,
  })
}

function messageDigest(message: UserMessage): string {
  return hashCanonical({
    domain: 'evoforge_gateway_ingress_message',
    version: 1,
    message,
  })
}

function gatewayMessageContentHash(message: UserMessage): string {
  const first = message.content[0]
  const text = first?.type === 'text' ? first.text : undefined
  const images = message.content.flatMap(block =>
    block.type === 'image' ? [{
      attachmentId: block.attachment.attachmentId,
      mediaType: block.attachment.mediaType,
      bytes: block.attachment.bytes,
      width: block.attachment.width,
      height: block.attachment.height,
      ...(block.attachment.name === undefined ? {} : { name: block.attachment.name }),
      ...(block.attachment.originalDimensions === undefined
        ? {}
        : {
          originalDimensions: {
            width: block.attachment.originalDimensions.width,
            height: block.attachment.originalDimensions.height,
          },
        }),
    }] : [])
  const serialized = images.length === 0 && text !== undefined
    ? text
    : JSON.stringify({ schemaVersion: 2, text: text ?? null, images })
  return createHash('sha256').update(serialized).digest('hex')
}

function enqueueDigest(
  record: {
    readonly id: string
    readonly workspaceId: string
    readonly ingressIntentDigest: string
    readonly workspaceIdentityDigest: string
    readonly sessionLifecycleDigest: string
    readonly messageDigest: string
  },
  enqueue: NormalizedEnqueue,
): string {
  return hashCanonical({
    domain: 'evoforge_gateway_ingress_enqueue',
    version: 1,
    boundary: {
      id: record.id,
      workspaceId: record.workspaceId,
      ingressIntentDigest: record.ingressIntentDigest,
      workspaceIdentityDigest: record.workspaceIdentityDigest,
      sessionLifecycleDigest: record.sessionLifecycleDigest,
      messageDigest: record.messageDigest,
    },
    enqueue: {
      type: enqueue.event.type,
      seq: enqueue.event.seq,
      time: enqueue.event.time,
      data: {
        target: enqueue.event.data.target,
        start: enqueue.event.data.start,
        messageId: enqueue.message.id,
      },
    },
  })
}

function conflictRecord(
  id: string,
  ingressCreatedAt: number,
): z.infer<typeof conflictRecordSchema> {
  return stampRecord({
    schemaVersion: 1 as const,
    state: 'conflict' as const,
    id,
    ingressCreatedAt,
  }, conflictRecordSchema)
}

function stampRecord<T extends z.ZodType>(
  content: Record<string, unknown>,
  schema: T,
): z.infer<T> {
  return schema.parse({
    ...content,
    recordDigest: hashCanonical({
      domain: EVIDENCE_DOMAIN,
      version: EVIDENCE_DOMAIN_VERSION,
      record: content,
    }),
  })
}

function auditEvidence(domain: GatewayIngressEvidenceDomain): void {
  for (const [key, raw] of domain.table('evidence').entries()) {
    const record = evidenceRecordSchema.parse(raw)
    if (key !== record.id) {
      throw new Error(`Gateway ingress evidence key '${key}' does not match row id`)
    }
    const { recordDigest: actual, ...content } = record
    const expected = hashCanonical({
      domain: EVIDENCE_DOMAIN,
      version: EVIDENCE_DOMAIN_VERSION,
      record: content,
    })
    if (actual !== expected) {
      throw new Error(`Gateway ingress evidence '${record.id}' failed integrity audit`)
    }
    if (record.state === 'resolved' && record.messageId !== `channel:${record.id}`) {
      throw new Error(`Gateway ingress evidence '${record.id}' has an inconsistent message id`)
    }
  }
}

async function pruneOldest(
  table: KvTable<string, GatewayIngressEvidenceRecordV1>,
  retention: EvidenceRetentionHeap,
  maxSize: number,
  onPruned: (id: string) => void = () => {},
): Promise<void> {
  while (table.size > maxSize) {
    const oldest = retention.oldest()
    if (oldest === undefined) {
      throw new Error('Gateway ingress evidence retention index is inconsistent')
    }
    if (!(await table.delete(oldest.id))) {
      throw new Error(`Gateway ingress evidence '${oldest.id}' vanished during pruning`)
    }
    retention.removeOldest(oldest.id)
    onPruned(oldest.id)
  }
}

interface EvidenceRetentionEntry {
  readonly id: string
  readonly ingressCreatedAt: number
}

/** In-memory age index; persistent rows remain the sole authority. */
class EvidenceRetentionHeap {
  private readonly heap: EvidenceRetentionEntry[] = []

  constructor(entries: Iterable<[string, GatewayIngressEvidenceRecordV1]>) {
    for (const [id, record] of entries) {
      this.add({ id, ingressCreatedAt: record.ingressCreatedAt })
    }
  }

  add(record: EvidenceRetentionEntry): void {
    let index = this.heap.push({
      id: record.id,
      ingressCreatedAt: record.ingressCreatedAt,
    }) - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (compareRetention(this.heap[parent]!, this.heap[index]!) <= 0) break
      const parentEntry = this.heap[parent]!
      this.heap[parent] = this.heap[index]!
      this.heap[index] = parentEntry
      index = parent
    }
  }

  oldest(): EvidenceRetentionEntry | undefined {
    return this.heap[0]
  }

  removeOldest(expectedId: string): void {
    if (this.heap[0]?.id !== expectedId) {
      throw new Error('Gateway ingress evidence retention index changed during pruning')
    }
    const last = this.heap.pop()
    if (this.heap.length === 0 || last === undefined) return
    this.heap[0] = last
    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      let smallest = index
      if (left < this.heap.length
        && compareRetention(this.heap[left]!, this.heap[smallest]!) < 0) smallest = left
      if (right < this.heap.length
        && compareRetention(this.heap[right]!, this.heap[smallest]!) < 0) smallest = right
      if (smallest === index) return
      const current = this.heap[index]!
      this.heap[index] = this.heap[smallest]!
      this.heap[smallest] = current
      index = smallest
    }
  }
}

function compareRetention(left: EvidenceRetentionEntry, right: EvidenceRetentionEntry): number {
  if (left.ingressCreatedAt < right.ingressCreatedAt) return -1
  if (left.ingressCreatedAt > right.ingressCreatedAt) return 1
  return left.id.localeCompare(right.id)
}

function ingressIdFromMessage(messageId: string): string | undefined {
  return /^channel:([a-f0-9]{64})$/u.exec(messageId)?.[1]
}

function exactHash(value: string, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`invalid Gateway ${label}`)
  }
  return value
}

function abstained(
  reason: 'evidence-unavailable' | 'evidence-conflict',
): GatewayIngressEvidenceResolutionV1 {
  return immutable({ status: 'abstained', reason } as const)
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError('non-canonical number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  throw new TypeError(`unsupported canonical JSON value: ${typeof value}`)
}

function exactOwnData(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  const snapshot = onlyOwnData(value, keys)
  return snapshot !== undefined && hasExactDataKeys(snapshot, keys)
    ? snapshot
    : undefined
}

function hasExactDataKeys(
  snapshot: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  return Reflect.ownKeys(snapshot).length === keys.length
    && keys.every(key => Object.hasOwn(snapshot, key))
}

function onlyOwnData(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (!isPlainObject(value)) return undefined
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const expected = new Set(keys)
  const snapshot: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !expected.has(key)) return undefined
    const descriptor = descriptors[key]
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return undefined
    }
    snapshot[key] = descriptor.value
  }
  return snapshot
}

function exactArrayData(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): readonly unknown[] | undefined {
  if (!Array.isArray(value)) return undefined
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
    PropertyKey,
    PropertyDescriptor | undefined
  >
  const lengthDescriptor = descriptors.length
  const length = lengthDescriptor?.value
  if (lengthDescriptor === undefined
    || !('value' in lengthDescriptor)
    || lengthDescriptor.enumerable
    || typeof length !== 'number'
    || !Number.isSafeInteger(length)
    || length < minimumLength
    || length > maximumLength
    || Reflect.ownKeys(descriptors).length !== length + 1) {
    return undefined
  }
  const snapshot: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)]
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return undefined
    }
    snapshot.push(descriptor.value)
  }
  return snapshot
}

function isSafeNonNegative(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0)
}

function isSafePositive(value: unknown): value is number {
  return isSafeNonNegative(value) && value > 0
}

function isBoundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && Buffer.byteLength(value) <= maxBytes
}

function isSafeImageName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 255
    && value.trim() === value
    && !/[/\\\u0000-\u001f\u007f]/u.test(value)
}

function isCanonicalIsoTime(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 128) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function immutable<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
