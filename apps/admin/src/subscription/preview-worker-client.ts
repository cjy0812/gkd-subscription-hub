import type {
  SubscriptionPreviewWorkerRequest,
  SubscriptionPreviewWorkerResponse,
} from './worker-protocol'

const MAX_PREVIEW_BYTES = 10 * 1024 * 1024

type RequestWithoutId = SubscriptionPreviewWorkerRequest extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class SubscriptionPreviewWorkerClient {
  private worker: Worker
  private requestId = 0
  private pending = new Map<number, PendingRequest>()
  private disposed = false

  constructor() {
    this.worker = new Worker(
      new URL('../workers/subscription-preview.worker.ts', import.meta.url),
      { type: 'module', name: 'gkd-subscription-preview' },
    )
    this.worker.addEventListener('message', this.onMessage)
    this.worker.addEventListener('error', this.onError)
    this.worker.addEventListener('messageerror', this.onMessageError)
  }

  private onMessage = (event: MessageEvent<SubscriptionPreviewWorkerResponse>) => {
    const message = event.data
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(message.error))
  }

  private onError = (event: ErrorEvent) => {
    this.rejectAll(new Error(event.message || 'JSON5 Worker 执行失败'))
  }

  private onMessageError = () => {
    this.rejectAll(new Error('JSON5 Worker 消息传输失败'))
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  request<T>(request: RequestWithoutId): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('预览任务已关闭'))
    const id = ++this.requestId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      try {
        this.worker.postMessage({ ...request, id })
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async loadSource(url: string, signal?: AbortSignal): Promise<string> {
    const response = await fetch(url, {
      headers: { accept: 'application/json, application/json5;q=0.9, */*;q=0.1' },
      signal,
    })
    if (!response.ok) throw new Error('读取订阅文件失败：HTTP ' + response.status)
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (declaredLength > MAX_PREVIEW_BYTES) {
      throw new Error('文件超过 10 MB 安全预览上限，请使用原始文件查看')
    }
    const source = await response.text()
    const byteLength = new TextEncoder().encode(source).byteLength
    if (byteLength > MAX_PREVIEW_BYTES) {
      throw new Error('文件超过 10 MB 安全预览上限，请使用原始文件查看')
    }
    return source
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.rejectAll(new Error('预览已切换，任务已取消'))
    this.worker.removeEventListener('message', this.onMessage)
    this.worker.removeEventListener('error', this.onError)
    this.worker.removeEventListener('messageerror', this.onMessageError)
    this.worker.terminate()
  }
}
