export type PreviewScope = 'app' | 'global'

export type SubscriptionPreviewWorkerRequest =
  | { id: number; type: 'parse'; source: ArrayBuffer; expectedId: number }
  | { id: number; type: 'apps-page'; page: number; pageSize: number; query: string }
  | {
      id: number
      type: 'groups-page'
      scope: PreviewScope
      appIndex?: number
      page: number
      pageSize: number
      query: string
    }
  | {
      id: number
      type: 'rules-page'
      scope: PreviewScope
      appIndex?: number
      groupIndex: number
      page: number
      pageSize: number
      query: string
    }
  | {
      id: number
      type: 'rule-detail'
      scope: PreviewScope
      appIndex?: number
      groupIndex: number
      ruleIndex: number
    }
  | { id: number; type: 'categories-page'; page: number; pageSize: number; query: string }

export type SubscriptionPreviewWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
