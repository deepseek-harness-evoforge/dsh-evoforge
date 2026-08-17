import {
  projectEvolutionAttention,
  type EvolutionAttentionOverview,
} from './attention.js'

export interface EvolutionAttentionSource {
  overview(): Promise<EvolutionAttentionOverview>
}

export interface TelegramHostRoute {
  notify(notice: { readonly id: string; readonly text: string }): Promise<{
    readonly created: boolean
    readonly status: 'prepared' | 'sending' | 'retrying' | 'delivered' | 'uncertain' | 'failed'
  }>
}

/** Serial host-only scanner. Durable duplicate suppression remains in dsh-telegram. */
export class EvolutionTelegramBridge {
  private tail: Promise<void> = Promise.resolve()
  private closed = false

  constructor(
    private readonly source: EvolutionAttentionSource,
    private readonly route: Pick<TelegramHostRoute, 'notify'>,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  scan(): Promise<void> {
    if (this.closed) return this.tail
    const scan = this.tail.then(async () => {
      if (this.closed) return
      const overview = await this.source.overview()
      for (const notice of projectEvolutionAttention(overview)) {
        await this.route.notify({ id: notice.id, text: notice.text })
      }
    })
    const contained = scan.catch((error: unknown) => {
      this.onError(error)
    })
    this.tail = contained
    return contained
  }

  async dispose(): Promise<void> {
    this.closed = true
    await this.tail
  }
}
