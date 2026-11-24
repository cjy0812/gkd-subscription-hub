import type {
  SubscriptionPreviewWorkerRequest,
  SubscriptionPreviewWorkerResponse,
} from './worker-protocol'

const AUTO_PREVIEW_BYTES = 10 * 1024 * 1024
const MAX_PREVIEW_BYTES = 50 * 1024 * 1024

export class PreviewFileTooLargeError extends Error {
  constructor(readonly byteLength: number) {
    super('文件约 ' + (byteLength / 1024 / 1024).toFixed(1) + ' MB；超过自动预览阈值 10 MB')
    this.name = 'PreviewFileTooLargeError'
  }
}

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

  request<T>(request: RequestWithoutId, transfer: Transferable[] = []): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('预览任务已关闭'))
    const id = ++this.requestId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      try {
        this.worker.postMessage({ ...request, id }, transfer)
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private async fetchSourceBytes(
    url: string,
    signal?: AbortSignal,
    allowLarge = false,
  ): Promise<ArrayBuffer> {
    const response = await fetch(url, {
      headers: { accept: 'application/json, application/json5;q=0.9, */*;q=0.1' },
      signal,
    })
    if (!response.ok) throw new Error('读取订阅文件失败：HTTP ' + response.status)
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (declaredLength > MAX_PREVIEW_BYTES) {
      await response.body?.cancel()
      throw new Error('文件超过 50 MB 预览硬上限，请使用原始文件查看')
    }
    if (!allowLarge && declaredLength > AUTO_PREVIEW_BYTES) {
      await response.body?.cancel()
      throw new PreviewFileTooLargeError(declaredLength)
    }
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > MAX_PREVIEW_BYTES) {
      throw new Error('文件超过 50 MB 预览硬上限，请使用原始文件查看')
    }
    if (!allowLarge && bytes.byteLength > AUTO_PREVIEW_BYTES) {
      throw new PreviewFileTooLargeError(bytes.byteLength)
    }
    return bytes
  }

  loadSourceBytes(url: string, signal?: AbortSignal, allowLarge = false): Promise<ArrayBuffer> {
    return this.fetchSourceBytes(url, signal, allowLarge)
  }

  async loadRawSource(url: string, signal?: AbortSignal): Promise<string> {
    const bytes = await this.fetchSourceBytes(url, signal, true)
    return new TextDecoder().decode(bytes)
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
