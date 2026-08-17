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
  /** Exact native Workspace ownership for each statically configured Router route. */
  readonly routes: readonly FeishuHostRouteBinding[]
  notify(notice: FeishuHostNotice): Promise<FeishuHostNoticeReceipt>
}
