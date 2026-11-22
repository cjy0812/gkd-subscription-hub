export interface BatchSuccess<T, R> {
  item: T
  value: R
}

export interface BatchFailure<T> {
  item: T
  error: unknown
}

export interface BatchResult<T, R> {
  succeeded: BatchSuccess<T, R>[]
  failed: BatchFailure<T>[]
  skipped: T[]
}

export interface BatchOptions<T> {
  onProgress?: (completed: number, total: number) => void
  shouldStop?: (error: unknown, item: T) => boolean
}

/**
 * 顺序执行批处理，避免集中请求耗尽上游 API 配额。
 * 单项失败会被记录并继续；只有 shouldStop 判定为终止错误时才停止。
 */
export async function runSequentialBatch<T, R>(
  items: readonly T[],
  task: (item: T) => Promise<R>,
  options: BatchOptions<T> = {},
): Promise<BatchResult<T, R>> {
  const succeeded: BatchSuccess<T, R>[] = []
  const failed: BatchFailure<T>[] = []
  const skipped: T[] = []

  for (const [index, item] of items.entries()) {
    try {
      const value = await task(item)
      succeeded.push({ item, value })
    } catch (error) {
      failed.push({ item, error })
      if (options.shouldStop?.(error, item)) {
        skipped.push(...items.slice(index + 1))
        options.onProgress?.(index + 1, items.length)
        break
      }
    }
    options.onProgress?.(index + 1, items.length)
  }

  return { succeeded, failed, skipped }
}
