import { describe, expect, it, vi } from 'vitest'
import {
  PreviewFileTooLargeError,
  readBoundedPreviewStream,
  SubscriptionPreviewWorkerClient,
} from './preview-worker-client'

function createStream(chunks: string[], cancel = vi.fn()): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[index++]))
    },
    cancel,
  })
}

describe('bounded JSON5 preview stream', () => {
  it('concatenates bounded chunks without reading the whole response at once', async () => {
    const buffer = await readBoundedPreviewStream(
      createStream(['{id:', '233,version:', '643}']),
      false,
      32,
      64,
    )
    expect(new TextDecoder().decode(buffer)).toBe('{id:233,version:643}')
  })

  it('cancels the stream when the default preview threshold is exceeded', async () => {
    const cancel = vi.fn()
    const promise = readBoundedPreviewStream(createStream(['123456', '7890'], cancel), false, 5, 12)
    await expect(promise).rejects.toBeInstanceOf(PreviewFileTooLargeError)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('still enforces the hard cap after the user opts into large parsing', async () => {
    const cancel = vi.fn()
    const promise = readBoundedPreviewStream(createStream(['123456', '7890'], cancel), true, 5, 8)
    await expect(promise).rejects.toThrow('预览硬上限')
    expect(cancel).toHaveBeenCalledOnce()
  })
})

describe('subscription preview worker lifecycle', () => {
  it('rejects requests submitted after a worker startup error', async () => {
    class FakeWorker extends EventTarget {
      static instance: FakeWorker | undefined
      postMessage = vi.fn()
      terminate = vi.fn()

      constructor() {
        super()
        FakeWorker.instance = this
      }
    }
    vi.stubGlobal('Worker', FakeWorker)
    const client = new SubscriptionPreviewWorkerClient()
    const worker = FakeWorker.instance
    if (!worker) throw new Error('Expected a Worker instance')
    const event = new Event('error')
    Object.defineProperty(event, 'message', { value: 'Worker module failed to load' })
    worker.dispatchEvent(event)

    const request = { type: 'apps-page' as const, page: 1, pageSize: 50, query: '' }
    await expect(client.request(request)).rejects.toThrow('Worker module failed to load')
    expect(worker.postMessage).not.toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalledOnce()
    client.dispose()
  })

  it('converts synchronous Worker construction failures into rejected requests', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('Worker construction blocked')
        }
      },
    )
    const client = new SubscriptionPreviewWorkerClient()
    await expect(
      client.request({ type: 'apps-page', page: 1, pageSize: 50, query: '' }),
    ).rejects.toThrow('Worker construction blocked')
    client.dispose()
  })
})
