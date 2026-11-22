import { describe, expect, it, vi } from 'vitest'
import { runSequentialBatch } from './batch'

describe('runSequentialBatch', () => {
  it('continues after item failures and reports results in input order', async () => {
    const progress = vi.fn()
    const result = await runSequentialBatch(
      [1, 2, 3],
      async (item) => {
        if (item === 2) throw new Error('暂时失败')
        return item * 10
      },
      { onProgress: progress },
    )

    expect(result.succeeded).toEqual([
      { item: 1, value: 10 },
      { item: 3, value: 30 },
    ])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.item).toBe(2)
    expect(result.skipped).toEqual([])
    expect(progress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]])
  })

  it('stops after a terminal error and reports remaining items as skipped', async () => {
    const task = vi.fn(async (item: number) => {
      if (item === 2) throw new Error('会话已失效')
      return item
    })
    const result = await runSequentialBatch([1, 2, 3, 4], task, {
      shouldStop: (error) => error instanceof Error && error.message === '会话已失效',
    })

    expect(task).toHaveBeenCalledTimes(2)
    expect(result.succeeded).toEqual([{ item: 1, value: 1 }])
    expect(result.failed).toHaveLength(1)
    expect(result.skipped).toEqual([3, 4])
  })
})
