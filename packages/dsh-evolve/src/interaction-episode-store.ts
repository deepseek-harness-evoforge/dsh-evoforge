import { createHash } from 'node:crypto'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const EPISODE_ID_DOMAIN = 'evoforge_interaction_episodes'
const EPISODE_ID_DOMAIN_VERSION = 1
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const gitRevisionSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const nonEmptyId = z.string().min(1).max(512)

const episodeContentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('interaction-episode-v1'),
  workspaceId: z.uuid(),
  session: z.strictObject({
    id: z.string().min(1).max(256),
    formatVersion: safeInteger,
    createdAt: safeInteger,
    inheritedEventCount: safeInteger,
    parentSessionId: z.string().min(1).max(256).optional(),
    agentPreset: z.string().min(1).max(256).optional(),
  }),
  source: z.strictObject({
    turn: safeInteger.positive(),
    prefixThroughSeq: safeInteger.nullable(),
    enqueueSeq: safeInteger,
    turnStartSeq: safeInteger,
    claimSeq: safeInteger,
    initiatingMessageSeq: safeInteger,
    triggerCallSeq: safeInteger,
    triggerResultSeq: safeInteger,
    turnEndSeq: safeInteger,
    completedAt: safeInteger,
  }),
  ingress: z.strictObject({
    messageId: nonEmptyId,
    source: z.literal('user'),
    digest: hashSchema,
  }),
  trigger: z.strictObject({
    kind: z.enum(['native-skill-miss', 'model-declared-skill-gap']),
    callId: nonEmptyId,
    requestedSkill: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(128),
    catalogHash: hashSchema,
    catalogSize: safeInteger,
    generationId: hashSchema.optional(),
  }),
  replay: z.strictObject({
    // The hashes bind exact source material but do not copy it into this
    // ledger. A later evidence vault must resolve and verify the DSH-owned
    // Session/environment sources before treating the Episode as replayable.
    availability: z.literal('source-dependent'),
    transcript: z.literal('exact'),
    environment: z.literal('sealed'),
    prefixDigest: hashSchema,
    turnDigest: hashSchema,
    workspaceSnapshotDigest: hashSchema,
    compositionDigest: hashSchema,
    modelDigest: hashSchema,
    permissionDigest: hashSchema,
    sandboxDigest: hashSchema,
    budgetDigest: hashSchema,
    dshRevision: gitRevisionSchema,
    externalEffects: z.literal('none'),
  }),
  goal: z.strictObject({
    id: nonEmptyId,
    revision: safeInteger,
  }).optional(),
}).superRefine((episode, context) => {
  const { source, session } = episode
  const prefixIsExact = source.enqueueSeq === 0
    ? source.prefixThroughSeq === null
    : source.prefixThroughSeq === source.enqueueSeq - 1
  if (!prefixIsExact) {
    context.addIssue({
      code: 'custom',
      path: ['source', 'prefixThroughSeq'],
      message: 'Interaction episode prefix must end immediately before inbox insertion',
    })
  }

  const ordered = [
    source.enqueueSeq,
    source.turnStartSeq,
    source.claimSeq,
    source.initiatingMessageSeq,
    source.triggerCallSeq,
    source.triggerResultSeq,
    source.turnEndSeq,
  ]
  if (ordered.some((value, index) => index > 0 && value <= ordered[index - 1]!)) {
    context.addIssue({
      code: 'custom',
      path: ['source'],
      message: 'Interaction episode source events are not in strict causal order',
    })
  }
  if (session.inheritedEventCount > source.enqueueSeq) {
    context.addIssue({
      code: 'custom',
      path: ['session', 'inheritedEventCount'],
      message: 'Interaction episode inbox insertion precedes the inherited Session prefix',
    })
  }
  if (session.createdAt > source.completedAt) {
    context.addIssue({
      code: 'custom',
      path: ['source', 'completedAt'],
      message: 'Interaction episode completed before its Session was created',
    })
  }
})

type InteractionEpisodeContentV1 = z.infer<typeof episodeContentSchema>

const episodeSchema = episodeContentSchema.safeExtend({
  id: hashSchema,
}).superRefine((episode, context) => {
  const { id: _id, ...content } = episode
  if (episode.id !== episodeId(content)) {
    context.addIssue({
      code: 'custom',
      path: ['id'],
      message: 'Interaction episode id is not content-addressed',
    })
  }
})

/**
 * Immutable completed-turn provenance plus content bindings. This record is
 * intentionally not a self-contained transcript or replay artifact.
 */
export type InteractionEpisodeV1 = z.infer<typeof episodeSchema>
export type InteractionEpisodeInputV1 = Omit<
  InteractionEpisodeContentV1,
  'schemaVersion' | 'kind'
>

export interface InteractionEpisodeSource {
  get(workspaceId: string, episodeId: string): InteractionEpisodeV1 | undefined
}

export interface InteractionEpisodeStore extends InteractionEpisodeSource {
  seal(input: InteractionEpisodeInputV1): Promise<{
    readonly created: boolean
    readonly episode: InteractionEpisodeV1
  }>
  close(): Promise<void>
}

const interactionEpisodeDomainSpec = defineDomain({
  name: EPISODE_ID_DOMAIN,
  version: EPISODE_ID_DOMAIN_VERSION,
  // Authoritative episodes fail as one unit. A per-record backend may treat
  // malformed or stale documents as absent, which would silently weaken the
  // provenance ledger.
  layout: 'single',
  tables: {
    episodes: domainTable<string, InteractionEpisodeV1>(episodeSchema),
  },
})

type InteractionEpisodeDomain = Domain<typeof interactionEpisodeDomainSpec>

class DomainInteractionEpisodeStore implements InteractionEpisodeStore {
  private writeTail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>

  constructor(
    private readonly domain: InteractionEpisodeDomain,
    private readonly sourceIndex: Map<string, string>,
  ) {}

  seal(input: InteractionEpisodeInputV1): Promise<{
    readonly created: boolean
    readonly episode: InteractionEpisodeV1
  }> {
    let captured: InteractionEpisodeInputV1
    try {
      captured = structuredClone(input)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.enqueue(async () => {
      const content = normalizeContent(captured)
      const id = episodeId(content)
      const episode = immutableCopy(episodeSchema.parse({ ...content, id }))
      const table = this.domain.table('episodes')

      const existing = table.get(id)
      if (existing !== undefined) {
        if (canonicalJson(existing) !== canonicalJson(episode)) {
          throw new Error(`Interaction episode identity '${id}' conflicts with durable content`)
        }
        return { created: false, episode: immutableCopy(existing) }
      }

      const sourceKey = episodeSourceKey(content)
      const sourceEpisodeId = this.sourceIndex.get(sourceKey)
      if (sourceEpisodeId !== undefined) {
        throw new Error(
          `Interaction episode source conflicts with sealed episode '${sourceEpisodeId}'`,
        )
      }

      await table.put(id, episode)
      this.sourceIndex.set(sourceKey, id)
      return { created: true, episode }
    })
  }

  get(workspaceId: string, episodeIdValue: string): InteractionEpisodeV1 | undefined {
    const episode = this.domain.table('episodes').get(episodeIdValue)
    if (episode === undefined || episode.workspaceId !== workspaceId) return undefined
    return immutableCopy(episode)
  }

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(() => this.domain.close())
    return this.closing
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) {
      return Promise.reject(new Error('Interaction episode store is closing'))
    }
    const result = this.writeTail.then(operation)
    this.writeTail = result.then(() => {}, () => {})
    return result
  }
}

export async function openInteractionEpisodeStore(
  facility: DomainFacility,
): Promise<InteractionEpisodeStore> {
  const domain = await facility.open(interactionEpisodeDomainSpec)
  try {
    return new DomainInteractionEpisodeStore(domain, auditEpisodes(domain))
  } catch (auditError) {
    try {
      await domain.close()
    } catch (closeError) {
      throw new AggregateError(
        [auditError, closeError],
        'Interaction episode audit and domain cleanup both failed',
      )
    }
    throw auditError
  }
}

function normalizeContent(input: InteractionEpisodeInputV1): InteractionEpisodeContentV1 {
  const parsed = episodeContentSchema.parse({
    schemaVersion: 1,
    kind: 'interaction-episode-v1',
    ...input,
  })
  return episodeContentSchema.parse(JSON.parse(JSON.stringify(parsed)) as unknown)
}

function auditEpisodes(domain: InteractionEpisodeDomain): Map<string, string> {
  const sourceIndex = new Map<string, string>()
  for (const [key, episode] of domain.table('episodes').entries()) {
    if (key !== episode.id) {
      throw new Error(`Interaction episode table key '${key}' does not match row id '${episode.id}'`)
    }
    const { id: _id, ...content } = episode
    const expectedId = episodeId(content)
    if (episode.id !== expectedId) {
      throw new Error(`Interaction episode '${episode.id}' failed content-address audit`)
    }
    const sourceKey = episodeSourceKey(content)
    const existing = sourceIndex.get(sourceKey)
    if (existing !== undefined && existing !== episode.id) {
      throw new Error(
        `Interaction episode source is shared by '${existing}' and '${episode.id}'`,
      )
    }
    sourceIndex.set(sourceKey, episode.id)
  }
  return sourceIndex
}

function episodeSourceKey(content: InteractionEpisodeContentV1): string {
  return canonicalJson({
    workspaceId: content.workspaceId,
    session: {
      id: content.session.id,
      createdAt: content.session.createdAt,
    },
    turn: content.source.turn,
  })
}

function episodeId(content: InteractionEpisodeContentV1): string {
  return createHash('sha256').update(canonicalJson({
    domain: EPISODE_ID_DOMAIN,
    version: EPISODE_ID_DOMAIN_VERSION,
    content,
  })).digest('hex')
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number is not canonical JSON')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  throw new TypeError(`unsupported canonical JSON value: ${typeof value}`)
}
