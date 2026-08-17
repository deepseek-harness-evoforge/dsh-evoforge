import { createHash } from 'node:crypto'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { DeliveryWatch, ReviewFollowup } from './review-followup.js'

const shaSchema = z.string().regex(/^[a-f0-9]{40}$/u)
const watchSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaVersion: z.literal(1),
  agentId: z.string().min(1).max(256),
  sessionId: z.string().min(1).max(256),
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  pullNumber: z.number().int().positive(),
  headCommit: shaSchema,
  etag: z.string().min(1).max(512).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export type GitHubReviewWatch = z.infer<typeof watchSchema>
const followupSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaVersion: z.literal(1),
  messageId: z.string().regex(/^github-review:[a-f0-9]{64}$/u),
  watchId: z.string().regex(/^[a-f0-9]{64}$/u),
  agentId: z.string().min(1).max(256),
  sessionId: z.string().min(1).max(256),
  pullNumber: z.number().int().positive(),
  headCommit: shaSchema,
  reviewId: z.number().int().positive(),
  reviewer: z.string().min(1).max(100),
  text: z.string().min(1).max(6_000),
  status: z.enum(['prepared', 'delivered', 'superseded']),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export type GitHubReviewFollowupRecord = z.infer<typeof followupSchema>
export type GitHubReviewFollowupStatus = GitHubReviewFollowupRecord['status']

const reviewDomainSpec = defineDomain({
  name: 'evoforge_github_review',
  version: 1,
  tables: {
    watches: domainTable<string, GitHubReviewWatch>(watchSchema),
    followups: domainTable<string, GitHubReviewFollowupRecord>(followupSchema),
  },
})

type ReviewDomain = Domain<typeof reviewDomainSpec>

export interface GitHubReviewStore {
  upsertWatch(input: DeliveryWatch, now: number): Promise<GitHubReviewWatch>
  setEtag(watch: GitHubReviewWatch, etag: string, now: number): Promise<GitHubReviewWatch>
  listWatches(): GitHubReviewWatch[]
  prepareFollowup(
    watch: GitHubReviewWatch,
    followup: ReviewFollowup,
    now: number,
  ): Promise<{ created: boolean; record: GitHubReviewFollowupRecord }>
  markDelivered(id: string, now: number): Promise<GitHubReviewFollowupRecord>
  markSuperseded(id: string, now: number): Promise<GitHubReviewFollowupRecord>
  listFollowups(statuses?: readonly GitHubReviewFollowupStatus[]): GitHubReviewFollowupRecord[]
  close(): Promise<void>
}

class DomainGitHubReviewStore implements GitHubReviewStore {
  private tail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>

  constructor(
    private readonly domain: ReviewDomain,
    private readonly maxTerminalRecords: number,
  ) {}

  upsertWatch(input: DeliveryWatch, now: number): Promise<GitHubReviewWatch> {
    return this.write(async () => {
      const id = watchId(input)
      const table = this.domain.table('watches')
      const existing = table.get(id)
      if (existing !== undefined
        && existing.agentId === input.agentId
        && existing.sessionId === input.sessionId
        && existing.pullNumber === input.pullNumber
        && existing.headCommit === input.headCommit) return copy(existing)
      const record = watchSchema.parse({
        id,
        schemaVersion: 1,
        ...input,
        createdAt: existing?.createdAt ?? exactTime(now),
        updatedAt: exactTime(now),
      })
      await table.put(id, record)
      const followups = this.domain.table('followups')
      for (const [followupId, followup] of followups.entries()) {
        if (followup.watchId !== id
          || followup.status !== 'prepared') continue
        await followups.put(followupId, followupSchema.parse({
          ...followup,
          status: 'superseded',
          updatedAt: exactTime(now),
        }))
      }
      await this.pruneTerminalFollowups()
      return copy(record)
    })
  }

  setEtag(watch: GitHubReviewWatch, etag: string, now: number): Promise<GitHubReviewWatch> {
    return this.write(async () => {
      const table = this.domain.table('watches')
      const updated = await table.update(watch.id, (current) => {
        if (!sameWatchTarget(current, watch)) {
          throw new Error('GitHub review watch changed before ETag commit')
        }
        return watchSchema.parse({ ...current, etag, updatedAt: exactTime(now) })
      })
      return copy(updated)
    })
  }

  listWatches(): GitHubReviewWatch[] {
    return [...this.domain.table('watches').entries()]
      .map(([, record]) => copy(record))
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
  }

  prepareFollowup(
    watch: GitHubReviewWatch,
    followup: ReviewFollowup,
    now: number,
  ): Promise<{ created: boolean; record: GitHubReviewFollowupRecord }> {
    return this.write(async () => {
      const currentWatch = this.domain.table('watches').get(watch.id)
      if (currentWatch === undefined
        || !sameWatchTarget(currentWatch, watch)) {
        throw new Error('GitHub review watch changed before follow-up prepare')
      }
      const table = this.domain.table('followups')
      const existing = table.get(followup.id)
      if (existing !== undefined) return { created: false, record: copy(existing) }
      for (const [olderId, older] of table.entries()) {
        if (older.watchId !== watch.id
          || older.reviewId !== followup.reviewId
          || older.status !== 'prepared') continue
        await table.put(olderId, followupSchema.parse({
          ...older,
          status: 'superseded',
          updatedAt: exactTime(now),
        }))
      }
      const record = followupSchema.parse({
        id: followup.id,
        schemaVersion: 1,
        messageId: followup.messageId,
        watchId: watch.id,
        agentId: watch.agentId,
        sessionId: watch.sessionId,
        pullNumber: watch.pullNumber,
        headCommit: watch.headCommit,
        reviewId: followup.reviewId,
        reviewer: followup.reviewer,
        text: followup.text,
        status: 'prepared',
        createdAt: exactTime(now),
        updatedAt: exactTime(now),
      })
      await table.put(record.id, record)
      await this.pruneTerminalFollowups()
      return { created: true, record: copy(record) }
    })
  }

  markDelivered(id: string, now: number): Promise<GitHubReviewFollowupRecord> {
    return this.write(async () => {
      const record = await this.domain.table('followups').update(id, current => current.status === 'delivered'
        ? current
        : followupSchema.parse({ ...current, status: 'delivered', updatedAt: exactTime(now) }))
      await this.pruneTerminalFollowups()
      return copy(record)
    })
  }

  markSuperseded(id: string, now: number): Promise<GitHubReviewFollowupRecord> {
    return this.write(async () => {
      const record = await this.domain.table('followups').update(id, current => current.status !== 'prepared'
        ? current
        : followupSchema.parse({ ...current, status: 'superseded', updatedAt: exactTime(now) }))
      await this.pruneTerminalFollowups()
      return copy(record)
    })
  }

  listFollowups(statuses?: readonly GitHubReviewFollowupStatus[]): GitHubReviewFollowupRecord[] {
    const allowed = statuses === undefined ? undefined : new Set(statuses)
    return [...this.domain.table('followups').entries()]
      .map(([, record]) => record)
      .filter(record => allowed === undefined || allowed.has(record.status))
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(copy)
  }

  close(): Promise<void> {
    this.closing ??= this.tail.then(() => this.domain.close())
    return this.closing
  }

  private write<T>(job: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new Error('GitHub review store is closing'))
    const result = this.tail.then(job)
    this.tail = result.then(() => {}, () => {})
    return result
  }

  private async pruneTerminalFollowups(): Promise<void> {
    const table = this.domain.table('followups')
    const terminal = [...table.entries()]
      .filter(([, record]) => record.status !== 'prepared')
      .sort((left, right) => left[1].updatedAt - right[1].updatedAt
        || left[1].createdAt - right[1].createdAt
        || left[0].localeCompare(right[0]))
    const excess = terminal.length - this.maxTerminalRecords
    if (excess <= 0) return
    for (const [id] of terminal.slice(0, excess)) await table.delete(id)
  }
}

function sameWatchTarget(left: GitHubReviewWatch, right: GitHubReviewWatch): boolean {
  return left.id === right.id
    && left.agentId === right.agentId
    && left.sessionId === right.sessionId
    && left.owner === right.owner
    && left.repo === right.repo
    && left.pullNumber === right.pullNumber
    && left.headCommit === right.headCommit
}

export async function openGitHubReviewStore(
  facility: DomainFacility,
  options: { readonly maxTerminalRecords?: number } = {},
): Promise<GitHubReviewStore> {
  const maxTerminalRecords = options.maxTerminalRecords ?? 1_000
  if (!Number.isSafeInteger(maxTerminalRecords) || maxTerminalRecords < 1) {
    throw new Error('GitHub review maxTerminalRecords must be a positive safe integer')
  }
  return new DomainGitHubReviewStore(await facility.open(reviewDomainSpec), maxTerminalRecords)
}

function watchId(input: DeliveryWatch): string {
  return createHash('sha256')
    .update(`${input.agentId}\0${input.owner.toLowerCase()}\0${input.repo.toLowerCase()}`)
    .digest('hex')
}

function exactTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('GitHub review time must be a non-negative safe integer')
  }
  return value
}

function copy<T>(value: T): T {
  return Object.freeze(structuredClone(value))
}
