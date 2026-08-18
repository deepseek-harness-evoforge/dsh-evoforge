import { sha256 } from './hash.ts'

const DEFAULT_TIMEOUT_MS = 45_000
const MAX_SEARCH_RESULTS = 3
const MAX_EXCERPT_BYTES = 8 * 1024
const MAX_TITLE_BYTES = 512
const MAX_CORPUS_BYTES = 48 * 1024

export type SkillResearchKnowledgeTrack = 'official' | 'open-source' | 'frontier'
export type SkillResearchTrack = SkillResearchKnowledgeTrack | 'holdout'
export type SkillResearchRole = 'knowledge' | 'verification'

export interface SkillResearchSearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly publishedAt?: string
}

export interface SkillResearchSearchResult {
  readonly sources: readonly SkillResearchSearchSource[]
  readonly truncated: boolean
  readonly content?: string
}

export interface SkillResearchFetchResult {
  readonly url: string
  readonly statusCode: number
  readonly body: {
    readonly kind: 'html' | 'text'
    readonly content: string
  }
  readonly truncated: boolean
}

/** Structural subset of the native `ctx.web` service used by EvoForge. */
export interface SkillResearchWeb {
  search(
    request: { readonly query: string; readonly maxResults?: number },
    signal?: AbortSignal,
  ): Promise<SkillResearchSearchResult>
  fetch(
    request: { readonly url: string },
    signal?: AbortSignal,
  ): Promise<SkillResearchFetchResult>
}

export interface SkillResearchEvidence {
  readonly role: SkillResearchRole
  readonly track: SkillResearchTrack
  readonly queryHash: string
  readonly requestedUrl: string
  readonly finalUrl: string
  readonly statusCode: number
  readonly title?: string
  readonly excerpt: string
  readonly contentDigest: string
  readonly truncated: boolean
}

export interface SkillResearchCorpus {
  readonly schemaVersion: 1
  readonly skillName: string
  readonly queryDigest: string
  readonly knowledge: readonly SkillResearchEvidence[]
  readonly verification: readonly SkillResearchEvidence[]
  readonly truncated: boolean
  readonly digest: string
}

export interface DshWebSkillResearchOptions {
  readonly timeoutMs?: number
}

interface ResearchQuery {
  readonly role: SkillResearchRole
  readonly track: SkillResearchTrack
  readonly query: string
}

interface SearchCandidate {
  readonly query: ResearchQuery
  readonly source: SkillResearchSearchSource
  readonly requestedUrl: string
  readonly searchTruncated: boolean
}

export function createDshWebSkillResearch(
  web: SkillResearchWeb,
  options: DshWebSkillResearchOptions = {},
): (input: { readonly skillName: string; readonly signal?: AbortSignal }) => Promise<SkillResearchCorpus> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Skill research timeoutMs must be a positive safe integer')
  }

  return async input => {
    assertPublicSkillName(input.skillName)
    const signal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs)
    signal.throwIfAborted()

    const queries = createQueries(input.skillName)
    const candidates: SearchCandidate[] = []
    let corpusTruncated = false

    for (const query of queries) {
      const result = await web.search(
        { query: query.query, maxResults: MAX_SEARCH_RESULTS },
        signal,
      )
      signal.throwIfAborted()
      if (!Array.isArray(result.sources)) {
        throw new Error(`Skill research returned invalid sources for ${query.track}`)
      }
      corpusTruncated ||= result.truncated || result.sources.length > MAX_SEARCH_RESULTS
      for (const source of result.sources.slice(0, MAX_SEARCH_RESULTS)) {
        const requestedUrl = canonicalHttpsUrl(source.url)
        if (!requestedUrl) continue
        candidates.push({
          query,
          source,
          requestedUrl,
          searchTruncated: result.truncated || result.sources.length > MAX_SEARCH_RESULTS,
        })
      }
    }

    const usedRequestedUrls = new Set<string>()
    const usedFinalUrls = new Set<string>()
    const knowledge: SkillResearchEvidence[] = []
    const verification: SkillResearchEvidence[] = []

    for (const query of queries) {
      const target = query.role === 'knowledge' ? knowledge : verification
      const matching = candidates.filter(candidate => candidate.query === query)
      corpusTruncated ||= matching.length > 1
      for (const candidate of matching) {
        if (usedRequestedUrls.has(candidate.requestedUrl)) continue
        usedRequestedUrls.add(candidate.requestedUrl)

        let fetched: SkillResearchFetchResult
        try {
          fetched = await web.fetch({ url: candidate.requestedUrl }, signal)
          signal.throwIfAborted()
        } catch (error) {
          if (signal.aborted) signal.throwIfAborted()
          corpusTruncated = true
          continue
        }

        const finalUrl = canonicalHttpsUrl(fetched.url)
        if (!finalUrl || usedFinalUrls.has(finalUrl)) {
          corpusTruncated = true
          continue
        }
        if (!Number.isSafeInteger(fetched.statusCode)
          || fetched.statusCode < 200
          || fetched.statusCode >= 300
          || (fetched.body.kind !== 'html' && fetched.body.kind !== 'text')
          || typeof fetched.body.content !== 'string') {
          corpusTruncated = true
          continue
        }

        const normalizedContent = normalizeText(fetched.body.content)
        const excerpt = truncateUtf8(normalizedContent, MAX_EXCERPT_BYTES)
        const title = candidate.source.title === undefined
          ? undefined
          : truncateUtf8(normalizeText(candidate.source.title), MAX_TITLE_BYTES).value
        const truncated = candidate.searchTruncated || fetched.truncated || excerpt.truncated
        corpusTruncated ||= truncated
        usedFinalUrls.add(finalUrl)
        target.push({
          role: query.role,
          track: query.track,
          queryHash: sha256(query.query),
          requestedUrl: candidate.requestedUrl,
          finalUrl,
          statusCode: fetched.statusCode,
          ...title ? { title } : {},
          excerpt: excerpt.value,
          contentDigest: sha256(normalizedContent),
          truncated,
        })
        break
      }
    }

    const knowledgeTracks = new Set(knowledge.map(item => item.track))
    if (knowledgeTracks.size < 2 || verification.length < 1) {
      throw new Error('Skill research requires at least two knowledge tracks and one independent evidence source for verification')
    }

    const unsigned = {
      schemaVersion: 1 as const,
      skillName: input.skillName,
      queryDigest: sha256(JSON.stringify(queries.map(query => ({
        role: query.role,
        track: query.track,
        query: query.query,
      })))),
      knowledge,
      verification,
      truncated: corpusTruncated,
    }
    const corpus: SkillResearchCorpus = {
      ...unsigned,
      digest: sha256(JSON.stringify(unsigned)),
    }
    if (Buffer.byteLength(JSON.stringify(corpus), 'utf8') > MAX_CORPUS_BYTES) {
      throw new Error('Skill research corpus exceeds the 48 KiB host boundary')
    }
    return deepFreeze(structuredClone(corpus))
  }
}

function createQueries(skillName: string): ResearchQuery[] {
  return [
    { role: 'knowledge', track: 'official', query: `"${skillName}" official documentation` },
    { role: 'knowledge', track: 'open-source', query: `"${skillName}" open source implementation` },
    { role: 'knowledge', track: 'frontier', query: `"${skillName}" research benchmark` },
    { role: 'verification', track: 'holdout', query: `"${skillName}" failure modes test verification` },
  ]
}

function assertPublicSkillName(skillName: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
    throw new Error('Skill research accepts only a configured public kebab-case skill name')
  }
}

function canonicalHttpsUrl(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.username || url.password) return undefined
  url.hash = ''
  return url.toString()
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}

function truncateUtf8(value: string, maxBytes: number): { readonly value: string; readonly truncated: boolean } {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return { value, truncated: false }
  let bytes = 0
  let output = ''
  for (const codePoint of value) {
    const size = Buffer.byteLength(codePoint, 'utf8')
    if (bytes + size > maxBytes) break
    output += codePoint
    bytes += size
  }
  return { value: output, truncated: true }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
