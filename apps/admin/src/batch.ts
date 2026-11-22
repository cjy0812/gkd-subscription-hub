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
 * Run a batch sequentially to avoid bursting upstream API quotas.
 * Failures are collected and do not stop later items unless shouldStop says so.
 */
export async function runSequentialBatch<T, R>(
  items: readonly T[],
  task: (item: T) => Promise<R>,
  options: BatchOptions<T> = {},
): Promise<BatchResult<T, R>> {
  const succeeded: BatchSuccess<T, R>[] = []
  const failed: BatchFailure<T>[] = []
  const skipped: T[] = []

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
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
