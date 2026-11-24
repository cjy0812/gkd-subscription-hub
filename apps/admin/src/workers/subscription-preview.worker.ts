import JSON5 from 'json5'
import type { RawSubscription } from '@gkd-kit/api'
import {
  getAppsPage,
  getCategoriesPage,
  getGroupsPage,
  getRuleDetail,
  getRulesPage,
  isRawSubscription,
  summarizeSubscription,
} from '../subscription/preview-model'
import type { SubscriptionPreviewWorkerRequest } from '../subscription/worker-protocol'

type WorkerScope = {
  onmessage: ((event: MessageEvent<SubscriptionPreviewWorkerRequest>) => void) | null
  postMessage: (message: unknown) => void
}

const workerScope = globalThis as unknown as WorkerScope
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024
let subscription: RawSubscription | null = null

function requireSubscription(): RawSubscription {
  if (!subscription) throw new Error('请先解析订阅文件')
  return subscription
}

function handleMessage(message: SubscriptionPreviewWorkerRequest): unknown {
  switch (message.type) {
    case 'parse': {
      if (message.source.byteLength > MAX_PREVIEW_BYTES) {
        throw new Error('文件超过 10 MB 安全预览上限，请使用原始文件查看')
      }
      const source = new TextDecoder().decode(message.source)
      const parsed: unknown = JSON5.parse(source)
      if (!isRawSubscription(parsed)) {
        throw new Error('文件不是有效的 GKD 订阅：需要包含有效的 id、name、version 和数组字段')
      }
      subscription = parsed
      const summary = summarizeSubscription(subscription)
      return { ...summary, idMatches: summary.meta.id === message.expectedId }
    }
    case 'apps-page':
      return getAppsPage(requireSubscription(), message.page, message.pageSize, message.query)
    case 'groups-page':
      return getGroupsPage(
        requireSubscription(),
        message.scope,
        message.appIndex,
        message.page,
        message.pageSize,
        message.query,
      )
    case 'rules-page':
      return getRulesPage(
        requireSubscription(),
        message.scope,
        message.appIndex,
        message.groupIndex,
        message.page,
        message.pageSize,
        message.query,
      )
    case 'rule-detail':
      return getRuleDetail(
        requireSubscription(),
        message.scope,
        message.appIndex,
        message.groupIndex,
        message.ruleIndex,
      )
    case 'categories-page':
      return getCategoriesPage(requireSubscription(), message.page, message.pageSize, message.query)
  }
}

workerScope.onmessage = (event) => {
  const message = event.data
  try {
    const result = handleMessage(message)
    workerScope.postMessage({ id: message.id, ok: true, result })
  } catch (error) {
    workerScope.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
