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

export async function readBoundedPreviewStream(
  stream: ReadableStream<Uint8Array> | null,
  allowLarge: boolean,
  autoLimit = AUTO_PREVIEW_BYTES,
  maxLimit = MAX_PREVIEW_BYTES,
): Promise<ArrayBuffer> {
  if (!stream) return new ArrayBuffer(0)
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      const chunk = result.value
      totalBytes += chunk.byteLength

      if (totalBytes > maxLimit) {
        throw new Error(
          '文件超过 ' + (maxLimit / 1024 / 1024).toFixed(0) + ' MB 预览硬上限，请使用原始文件查看',
        )
      }
      if (!allowLarge && totalBytes > autoLimit) {
        throw new PreviewFileTooLargeError(totalBytes)
      }
      chunks.push(chunk)
    }
  } catch (error) {
    try {
      await reader.cancel(error)
    } catch {
      // The source may already have canceled itself after an abort or network failure.
    }
    throw error
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
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
  private worker?: Worker
  private requestId = 0
  private pending = new Map<number, PendingRequest>()
  private disposed = false
  private terminalError?: Error

  constructor() {
    try {
      this.worker = new Worker(
        new URL('../workers/subscription-preview.worker.ts', import.meta.url),
        { type: 'module', name: 'gkd-subscription-preview' },
      )
      this.worker.addEventListener('message', this.onMessage)
      this.worker.addEventListener('error', this.onError)
      this.worker.addEventListener('messageerror', this.onMessageError)
    } catch (error) {
      this.terminalError = error instanceof Error ? error : new Error(String(error))
    }
  }

  private onMessage = (event: MessageEvent<SubscriptionPreviewWorkerResponse>) => {
    const message = event.data
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(message.error))
  }

  private fail(error: Error) {
    if (this.disposed || this.terminalError) return
    this.terminalError = error
    this.rejectAll(error)
    this.worker?.removeEventListener('message', this.onMessage)
    this.worker?.removeEventListener('error', this.onError)
    this.worker?.removeEventListener('messageerror', this.onMessageError)
    this.worker?.terminate()
    this.worker = undefined
  }

  private onError = (event: ErrorEvent) => {
    this.fail(new Error(event.message || 'JSON5 Worker 执行失败'))
  }

  private onMessageError = () => {
    this.fail(new Error('JSON5 Worker 消息传输失败'))
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  request<T>(request: RequestWithoutId, transfer: Transferable[] = []): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('预览任务已关闭'))
    if (this.terminalError) return Promise.reject(this.terminalError)
    if (!this.worker) return Promise.reject(new Error('JSON5 Worker 不可用'))
    const id = ++this.requestId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      try {
        this.worker?.postMessage({ ...request, id }, transfer)
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
      try {
        await response.body?.cancel()
      } catch {
        // Keep the size-limit error even when the upstream stream cannot be canceled.
      }
      throw new Error('文件超过 50 MB 预览硬上限，请使用原始文件查看')
    }
    if (!allowLarge && declaredLength > AUTO_PREVIEW_BYTES) {
      try {
        await response.body?.cancel()
      } catch {
        // Keep the user-confirmation warning even when the upstream stream cannot be canceled.
      }
      throw new PreviewFileTooLargeError(declaredLength)
    }
    return readBoundedPreviewStream(response.body, allowLarge)
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
    this.worker?.removeEventListener('message', this.onMessage)
    this.worker?.removeEventListener('error', this.onError)
    this.worker?.removeEventListener('messageerror', this.onMessageError)
    this.worker?.terminate()
    this.worker = undefined
  }
}
