import type {
  DeliveryWatch,
  GitHubReview,
  GitHubReviewComment,
} from './review-followup.js'

const API_VERSION = '2026-03-10'

export type GitHubReviewReadResult =
  | {
      readonly kind: 'modified'
      readonly etag?: string | undefined
      readonly reviews: readonly GitHubReview[]
      readonly comments: readonly GitHubReviewComment[]
    }
  | { readonly kind: 'not-modified' }
  | { readonly kind: 'unknown'; readonly reason: string }

export class GitHubReviewClient {
  private readonly apiBase: string
  private readonly fetcher: typeof fetch
  private readonly token?: string | undefined
  private readonly requestTimeoutMs: number

  constructor(options: {
    readonly apiBase?: string
    readonly token?: string | undefined
    readonly fetcher?: typeof fetch
    readonly requestTimeoutMs?: number
  } = {}) {
    this.apiBase = options.apiBase ?? 'https://api.github.com'
    this.fetcher = options.fetcher ?? fetch
    this.token = options.token
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000
    if (!Number.isSafeInteger(this.requestTimeoutMs)
      || this.requestTimeoutMs < 1
      || this.requestTimeoutMs > 60_000) {
      throw new Error('GitHub review requestTimeoutMs must be an integer from 1 to 60000')
    }
  }

  async read(watch: DeliveryWatch, etag?: string): Promise<GitHubReviewReadResult> {
    const base = `${this.apiBase}/repos/${encodeURIComponent(watch.owner)}/${encodeURIComponent(watch.repo)}/pulls/${watch.pullNumber}`
    const reviewsResponse = await this.get(`${base}/reviews?per_page=100&page=1`, etag)
    if (reviewsResponse.status === 304) return { kind: 'not-modified' }
    if (!reviewsResponse.ok) {
      return { kind: 'unknown', reason: `GitHub reviews returned HTTP ${reviewsResponse.status}.` }
    }
    if (hasNextPage(reviewsResponse.headers.get('link'))) {
      return { kind: 'unknown', reason: 'GitHub reviews exceed the bounded 100-item page.' }
    }
    const rawReviews = await reviewsResponse.json()
    if (!Array.isArray(rawReviews)) return { kind: 'unknown', reason: 'GitHub reviews response is not an array.' }
    const reviews: GitHubReview[] = []
    for (const value of rawReviews) {
      const parsed = parseReview(value)
      if (parsed === undefined) return { kind: 'unknown', reason: 'GitHub reviews response has an invalid item.' }
      reviews.push(parsed)
    }

    const comments: GitHubReviewComment[] = []
    for (const review of reviews) {
      if (review.state !== 'CHANGES_REQUESTED' || review.commitId !== watch.headCommit) continue
      const response = await this.get(`${base}/reviews/${review.id}/comments?per_page=100&page=1`)
      if (!response.ok) {
        return { kind: 'unknown', reason: `GitHub review comments returned HTTP ${response.status}.` }
      }
      if (hasNextPage(response.headers.get('link'))) {
        return {
          kind: 'unknown',
          reason: `GitHub review ${review.id} comments exceed the bounded 100-item page.`,
        }
      }
      const rawComments = await response.json()
      if (!Array.isArray(rawComments)) {
        return { kind: 'unknown', reason: 'GitHub review comments response is not an array.' }
      }
      for (const value of rawComments) {
        const parsed = parseComment(value)
        if (parsed === undefined || parsed.reviewId !== review.id) {
          return { kind: 'unknown', reason: 'GitHub review comments response has an invalid item.' }
        }
        comments.push(parsed)
      }
    }
    const responseEtag = reviewsResponse.headers.get('etag') ?? undefined
    return {
      kind: 'modified',
      ...(responseEtag === undefined ? {} : { etag: responseEtag }),
      reviews,
      comments,
    }
  }

  private get(url: string, etag?: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    }
    if (this.token !== undefined) headers.Authorization = `Bearer ${this.token}`
    if (etag !== undefined) headers['If-None-Match'] = etag
    return this.fetcher(url, {
      method: 'GET',
      redirect: 'error',
      headers,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    })
  }
}

function parseReview(value: unknown): GitHubReview | undefined {
  if (!isRecord(value) || !isRecord(value.user)
    || !positiveInteger(value.id)
    || typeof value.state !== 'string'
    || typeof value.body !== 'string'
    || typeof value.commit_id !== 'string'
    || (value.submitted_at !== undefined && typeof value.submitted_at !== 'string')
    || typeof value.html_url !== 'string'
    || typeof value.user.login !== 'string'
    || typeof value.user.type !== 'string') return undefined
  return {
    id: value.id,
    state: value.state,
    body: value.body,
    commitId: value.commit_id,
    ...(typeof value.submitted_at === 'string' ? { submittedAt: value.submitted_at } : {}),
    htmlUrl: value.html_url,
    user: { login: value.user.login, type: value.user.type },
  }
}

function parseComment(value: unknown): GitHubReviewComment | undefined {
  if (!isRecord(value)
    || !positiveInteger(value.id)
    || !positiveInteger(value.pull_request_review_id)
    || typeof value.body !== 'string'
    || typeof value.path !== 'string'
    || typeof value.html_url !== 'string'
    || (value.line !== null && value.line !== undefined && !positiveInteger(value.line))) return undefined
  return {
    id: value.id,
    reviewId: value.pull_request_review_id,
    body: value.body,
    path: value.path,
    ...(positiveInteger(value.line) ? { line: value.line } : {}),
    htmlUrl: value.html_url,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function hasNextPage(link: string | null): boolean {
  return link !== null && /(?:^|,)\s*<[^>]+>\s*;\s*rel="next"(?:\s*;[^,]*)?(?:,|$)/u.test(link)
}
