import { describe, expect, it, vi } from 'vitest'
import {
  PreviewFileTooLargeError,
  readBoundedPreviewStream,
} from './preview-worker-client'

function createStream(
  chunks: string[],
  cancel = vi.fn(),
): ReadableStream<Uint8Array> {
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
    const promise = readBoundedPreviewStream(
      createStream(['123456', '7890'], cancel),
      false,
      5,
      12,
    )
    await expect(promise).rejects.toBeInstanceOf(PreviewFileTooLargeError)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('still enforces the hard cap after the user opts into large parsing', async () => {
    const cancel = vi.fn()
    const promise = readBoundedPreviewStream(
      createStream(['123456', '7890'], cancel),
      true,
      5,
      8,
    )
    await expect(promise).rejects.toThrow('8 MB 预览硬上限')
    expect(cancel).toHaveBeenCalledOnce()
  })
})
