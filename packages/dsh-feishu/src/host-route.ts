export interface FeishuHostNotice {
  readonly id: string
  readonly routeId: string
  readonly text: string
}

export interface FeishuHostNoticeReceipt {
  readonly created: boolean
  readonly status: 'prepared' | 'sending' | 'retrying' | 'delivered' | 'uncertain' | 'failed'
}

export interface FeishuHostRoute {
  notify(notice: FeishuHostNotice): Promise<FeishuHostNoticeReceipt>
}
