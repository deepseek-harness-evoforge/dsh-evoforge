import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { GitHubReviewClient } from './github-client.js'
import { selectReviewFollowups } from './review-followup.js'
import type {
  GitHubReviewFollowupRecord,
  GitHubReviewStore,
  GitHubReviewWatch,
} from './review-store.js'

function sessionEvents(session: Agent['session']): readonly import('@deepseek-ai/dsh-session').SessionEvent[] {
  const candidate = session as unknown as {
    readonly snapshotEvents?: () => readonly import('@deepseek-ai/dsh-session').SessionEvent[]
    readonly events?: readonly import('@deepseek-ai/dsh-session').SessionEvent[]
  }
  if (typeof candidate.snapshotEvents === 'function') return candidate.snapshotEvents()
  if (candidate.events !== undefined) return candidate.events
  throw new Error('DSH Session does not expose a readable event snapshot')
}

export interface GitHubReviewRuntimeConfig {
  readonly trustedReviewers: readonly string[]
  readonly maxTextChars: number
  readonly maxComments: number
}

export interface GitHubReviewScanResult {
  readonly watches: number
  readonly prepared: number
  readonly delivered: number
  readonly unknown: readonly string[]
}

/** Deep host module: scan exact watches, durably prepare, and append once to the originating Session. */
export class GitHubReviewRuntime {
  private scanTail: Promise<GitHubReviewScanResult> = Promise.resolve(emptyResult())
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly store: GitHubReviewStore,
    private readonly client: GitHubReviewClient,
    private readonly config: GitHubReviewRuntimeConfig,
    private readonly options: { readonly now?: () => number } = {},
  ) {}

  scanOnce(): Promise<GitHubReviewScanResult> {
    if (this.disposed) return Promise.reject(new Error('dsh-github-review runtime is disposed'))
    const result = this.scanTail.then(() => this.scanNow())
    this.scanTail = result.catch((error: unknown) => ({
      ...emptyResult(),
      unknown: [errorMessage(error)],
    }))
    return result
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.scanTail
  }

  private async scanNow(): Promise<GitHubReviewScanResult> {
    const now = this.options.now ?? Date.now
    const result = {
      watches: 0,
      prepared: 0,
      delivered: 0,
      unknown: [] as string[],
    }
    result.delivered += await this.deliverPrepared(now, result.unknown)
    for (const watch of this.store.listWatches()) {
      result.watches += 1
      let read: Awaited<ReturnType<GitHubReviewClient['read']>>
      try {
        read = await this.client.read(watch, watch.etag)
      } catch (error) {
        result.unknown.push(`${watch.owner}/${watch.repo}#${watch.pullNumber}: ${errorMessage(error)}`)
        continue
      }
      if (read.kind === 'not-modified') continue
      if (read.kind === 'unknown') {
        result.unknown.push(`${watch.owner}/${watch.repo}#${watch.pullNumber}: ${read.reason}`)
        continue
      }
      const followups = selectReviewFollowups({
        watch,
        trustedReviewers: this.config.trustedReviewers,
        reviews: read.reviews,
        comments: read.comments,
        maxTextChars: this.config.maxTextChars,
        maxComments: this.config.maxComments,
      })
      for (const followup of followups) {
        const prepared = await this.store.prepareFollowup(watch, followup, now())
        if (prepared.created) result.prepared += 1
      }
      result.delivered += await this.deliverPrepared(now, result.unknown)
      if (read.etag !== undefined) {
        try {
          await this.store.setEtag(watch, read.etag, now())
        } catch (error) {
          result.unknown.push(`${watch.owner}/${watch.repo}#${watch.pullNumber}: ${errorMessage(error)}`)
        }
      }
    }
    return Object.freeze({ ...result, unknown: Object.freeze([...result.unknown]) })
  }

  private async deliverPrepared(now: () => number, unknown: string[]): Promise<number> {
    let delivered = 0
    for (const record of this.store.listFollowups(['prepared'])) {
      const watch = this.currentWatch(record)
      if (watch === undefined) {
        await this.store.markSuperseded(record.id, now())
        continue
      }
      try {
        if (await this.deliver(record, watch, now)) delivered += 1
      } catch (error) {
        unknown.push(
          `${watch.owner}/${watch.repo}#${watch.pullNumber}: native Agent follow-up failed: ${errorMessage(error)}`,
        )
      }
    }
    return delivered
  }

  private async deliver(
    record: GitHubReviewFollowupRecord,
    _watch: GitHubReviewWatch,
    now: () => number,
  ): Promise<boolean> {
    const agent = this.ctx.agents.get(record.agentId as never)
    if (agent === undefined || String(agent.session.id) !== record.sessionId) return false
    if (!messageSeen(agent, record.messageId)) {
      const message = freezeMessage({
        id: MessageId(record.messageId),
        role: 'user',
        content: [{ type: 'text', text: record.text }],
        source: { kind: 'user' },
      } satisfies UserMessage)
      // Native followup() synchronously accepts the message into the Inbox and may let the
      // driver claim it before a second observation; a throw is the only failed acceptance.
      agent.followup(message)
    }
    await this.store.markDelivered(record.id, now())
    return true
  }

  private currentWatch(record: GitHubReviewFollowupRecord): GitHubReviewWatch | undefined {
    return this.store.listWatches().find(watch => watch.id === record.watchId
      && watch.pullNumber === record.pullNumber
      && watch.headCommit === record.headCommit
      && watch.agentId === record.agentId
      && watch.sessionId === record.sessionId)
  }
}

function messageSeen(agent: Agent, messageId: string): boolean {
  if (agent.inbox.nextTurn.some(message => String(message.id) === messageId)
    || agent.inbox.nextStep.some(message => String(message.id) === messageId)) return true
  return sessionEvents(agent.session).some((event) => {
    if (event.type === 'user/message') return String(event.data.id) === messageId
    return event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => String(message.id) === messageId)
  })
}

function emptyResult(): GitHubReviewScanResult {
  return { watches: 0, prepared: 0, delivered: 0, unknown: [] }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
