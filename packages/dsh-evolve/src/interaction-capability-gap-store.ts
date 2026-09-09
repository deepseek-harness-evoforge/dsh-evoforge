import { createHash } from 'node:crypto'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type {
  InteractionEpisodeInputV1,
  InteractionEpisodeSource,
  InteractionEpisodeStore,
  InteractionEpisodeV1,
} from './interaction-episode-store.ts'

const GAP_ID_DOMAIN = 'evoforge_interaction_capability_gaps'
const GAP_ID_DOMAIN_VERSION = 1
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)

const interactionEpisodeRefSchema = z.strictObject({
  kind: z.literal('interaction-episode-v1'),
  workspaceId: z.uuid(),
  episodeId: hashSchema,
})

const interactionGapContentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('interaction-capability-gap-v1'),
  experience: interactionEpisodeRefSchema,
})

type InteractionCapabilityGapContentV1 = z.infer<typeof interactionGapContentSchema>

const interactionGapSchema = interactionGapContentSchema.safeExtend({
  id: hashSchema,
}).superRefine((gap, context) => {
  const { id: _id, ...content } = gap
  if (gap.id !== interactionGapId(content)) {
    context.addIssue({
      code: 'custom',
      path: ['id'],
      message: 'Interaction Capability Gap id is not content-addressed',
    })
  }
})

export type InteractionEpisodeRefV1 = z.infer<typeof interactionEpisodeRefSchema>
export type InteractionCapabilityGapV1 = z.infer<typeof interactionGapSchema>

export interface InteractionCapabilityGapViewV1 {
  readonly gap: InteractionCapabilityGapV1
  readonly episode: InteractionEpisodeV1
}

export interface InteractionCapabilityGapSource {
  get(workspaceId: string, gapId: string): InteractionCapabilityGapViewV1 | undefined
  list(workspaceId: string): readonly InteractionCapabilityGapViewV1[]
}

export interface InteractionCapabilityGapStore extends InteractionCapabilityGapSource {
  derive(episode: InteractionEpisodeV1): Promise<{
    readonly created: boolean
    readonly gap: InteractionCapabilityGapV1
    readonly episode: InteractionEpisodeV1
  }>
  close(): Promise<void>
}

export interface CompletedInteractionGapResult {
  readonly episodeCreated: boolean
  readonly gapCreated: boolean
  readonly gap: InteractionCapabilityGapV1
  readonly episode: InteractionEpisodeV1
}

const interactionGapDomainSpec = defineDomain({
  name: GAP_ID_DOMAIN,
  version: GAP_ID_DOMAIN_VERSION,
  // A missing reference is an integrity failure, so this authoritative index
  // must not use a layout that can treat an invalid record as absent.
  layout: 'single',
  tables: {
    gaps: domainTable<string, InteractionCapabilityGapV1>(interactionGapSchema),
  },
})

type InteractionGapDomain = Domain<typeof interactionGapDomainSpec>

class DomainInteractionCapabilityGapStore implements InteractionCapabilityGapStore {
  private readonly domain: InteractionGapDomain
  private readonly episodes: InteractionEpisodeSource
  private writeTail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>

  constructor(
    domain: InteractionGapDomain,
    episodes: InteractionEpisodeSource,
  ) {
    this.domain = domain
    this.episodes = episodes
  }

  derive(candidate: InteractionEpisodeV1): Promise<{
    readonly created: boolean
    readonly gap: InteractionCapabilityGapV1
    readonly episode: InteractionEpisodeV1
  }> {
    let captured: InteractionEpisodeV1
    try {
      captured = structuredClone(candidate)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.enqueue(async () => {
      const episode = resolveExactEpisode(this.episodes, captured)
      const content = interactionGapContentSchema.parse({
        schemaVersion: 1,
        kind: 'interaction-capability-gap-v1',
        experience: episodeRef(episode),
      })
      const id = interactionGapId(content)
      const gap = immutableCopy(interactionGapSchema.parse({ ...content, id }))
      const table = this.domain.table('gaps')
      const existing = table.get(id)
      if (existing !== undefined) {
        if (canonicalJson(existing) !== canonicalJson(gap)) {
          throw new Error(`Interaction Capability Gap identity '${id}' conflicts with durable content`)
        }
        return {
          created: false,
          gap: immutableCopy(existing),
          episode: immutableCopy(episode),
        }
      }

      await table.put(id, gap)
      return { created: true, gap, episode: immutableCopy(episode) }
    })
  }

  get(workspaceId: string, gapId: string): InteractionCapabilityGapViewV1 | undefined {
    const gap = this.domain.table('gaps').get(gapId)
    if (gap === undefined || gap.experience.workspaceId !== workspaceId) return undefined
    return immutableCopy({ gap, episode: resolveReferencedEpisode(this.episodes, gap) })
  }

  list(workspaceId: string): readonly InteractionCapabilityGapViewV1[] {
    return immutableCopy([...this.domain.table('gaps').entries()]
      .map(([, gap]) => gap)
      .filter(gap => gap.experience.workspaceId === workspaceId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(gap => ({ gap, episode: resolveReferencedEpisode(this.episodes, gap) })))
  }

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(() => this.domain.close())
    return this.closing
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) {
      return Promise.reject(new Error('Interaction Capability Gap store is closing'))
    }
    const result = this.writeTail.then(operation)
    this.writeTail = result.then(() => {}, () => {})
    return result
  }
}

/**
 * The caller-facing two-domain operation. It deliberately seals the Episode
 * first: a failed Gap write can leave a safe orphan Episode, while an exact
 * retry repairs the reference without ever creating a dangling Gap.
 */
export class CompletedInteractionGapRecorder {
  private readonly episodes: Pick<InteractionEpisodeStore, 'seal'>
  private readonly gaps: Pick<InteractionCapabilityGapStore, 'derive'>

  constructor(
    episodes: Pick<InteractionEpisodeStore, 'seal'>,
    gaps: Pick<InteractionCapabilityGapStore, 'derive'>,
  ) {
    this.episodes = episodes
    this.gaps = gaps
  }

  async recordCompleted(input: InteractionEpisodeInputV1): Promise<CompletedInteractionGapResult> {
    const sealed = await this.episodes.seal(input)
    const derived = await this.gaps.derive(sealed.episode)
    return immutableCopy({
      episodeCreated: sealed.created,
      gapCreated: derived.created,
      gap: derived.gap,
      episode: derived.episode,
    })
  }
}

export async function openInteractionCapabilityGapStore(
  facility: DomainFacility,
  episodes: InteractionEpisodeSource,
): Promise<InteractionCapabilityGapStore> {
  const domain = await facility.open(interactionGapDomainSpec)
  try {
    auditInteractionGaps(domain, episodes)
    return new DomainInteractionCapabilityGapStore(domain, episodes)
  } catch (auditError) {
    try {
      await domain.close()
    } catch (closeError) {
      throw new AggregateError(
        [auditError, closeError],
        'Interaction Capability Gap audit and domain cleanup both failed',
      )
    }
    throw auditError
  }
}

function auditInteractionGaps(
  domain: InteractionGapDomain,
  episodes: InteractionEpisodeSource,
): void {
  for (const [key, gap] of domain.table('gaps').entries()) {
    if (key !== gap.id) {
      throw new Error(`Interaction Capability Gap table key '${key}' does not match row id '${gap.id}'`)
    }
    const { id: _id, ...content } = gap
    const expectedId = interactionGapId(content)
    if (gap.id !== expectedId) {
      throw new Error(`Interaction Capability Gap '${gap.id}' failed content-address audit`)
    }
    resolveReferencedEpisode(episodes, gap)
  }
}

function resolveExactEpisode(
  episodes: InteractionEpisodeSource,
  candidate: InteractionEpisodeV1,
): InteractionEpisodeV1 {
  const ref = episodeRef(candidate)
  const resolved = episodes.get(ref.workspaceId, ref.episodeId)
  if (resolved === undefined) {
    throw new Error(
      `Interaction Episode '${ref.episodeId}' is missing from Workspace '${ref.workspaceId}'`,
    )
  }
  if (canonicalJson(resolved) !== canonicalJson(candidate)) {
    throw new Error(`Interaction Episode '${ref.episodeId}' does not match its sealed source`)
  }
  return resolved
}

function resolveReferencedEpisode(
  episodes: InteractionEpisodeSource,
  gap: InteractionCapabilityGapV1,
): InteractionEpisodeV1 {
  const { workspaceId, episodeId } = gap.experience
  const episode = episodes.get(workspaceId, episodeId)
  if (episode === undefined) {
    throw new Error(
      `Interaction Capability Gap '${gap.id}' references missing Episode '${episodeId}'`,
    )
  }
  if (episode.workspaceId !== workspaceId || episode.id !== episodeId) {
    throw new Error(`Interaction Capability Gap '${gap.id}' has a mismatched Episode reference`)
  }
  return episode
}

function episodeRef(episode: InteractionEpisodeV1): InteractionEpisodeRefV1 {
  return interactionEpisodeRefSchema.parse({
    kind: 'interaction-episode-v1',
    workspaceId: episode.workspaceId,
    episodeId: episode.id,
  })
}

function interactionGapId(content: InteractionCapabilityGapContentV1): string {
  return createHash('sha256').update(canonicalJson({
    domain: GAP_ID_DOMAIN,
    version: GAP_ID_DOMAIN_VERSION,
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
