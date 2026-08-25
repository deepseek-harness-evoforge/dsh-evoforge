export interface FeishuHostNotice {
  readonly id: string
  readonly routeId: string
  readonly text: string
}

export interface FeishuHostNoticeReceipt {
  readonly created: boolean
  readonly status: 'prepared' | 'sending' | 'retrying' | 'delivered' | 'uncertain' | 'failed'
}

export interface FeishuHostRouteBinding {
  readonly routeId: string
  readonly workspaceId: string
}

export interface FeishuHostRoute {
  /** Current exact native Workspace ownership, including resident grants adopted after boot. */
  readonly routes: readonly FeishuHostRouteBinding[]
  /** Last platform-observed kind for an admitted exact route; never inferred from configuration. */
  observedChatKind(routeId: string): 'direct' | 'group' | undefined
  notify(notice: FeishuHostNotice): Promise<FeishuHostNoticeReceipt>
}
