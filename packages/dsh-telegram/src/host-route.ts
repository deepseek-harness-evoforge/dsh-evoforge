export interface TelegramHostNotice {
  /** Exact deterministic identity owned by the host integration. */
  readonly id: string
  /** Plain bounded text; the fixed route applies its configured hard limit. */
  readonly text: string
}

export interface TelegramHostNoticeReceipt {
  readonly created: boolean
  readonly status: 'prepared' | 'sending' | 'retrying' | 'delivered' | 'uncertain' | 'failed'
}

/** Suite-internal concrete route; this is not a public channel/provider SPI. */
export interface TelegramHostRoute {
  /** Exact native Workspace statically bound by the Gateway route. */
  readonly workspaceId: string
  notify(notice: TelegramHostNotice): Promise<TelegramHostNoticeReceipt>
}
