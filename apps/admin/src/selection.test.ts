import { describe, expect, it } from 'vitest'
import { toggleSelection, updateScopedSelection, updateVisibleSelection } from './selection'

describe('project selection helpers', () => {
  it('selects visible projects without dropping hidden selections or duplicating IDs', () => {
    expect(updateVisibleSelection([1, 3, 3], [2, 3, 4], true)).toEqual([1, 3, 2, 4])
  })

  it('deselects only visible projects and preserves selections outside the filter', () => {
    expect(updateVisibleSelection([1, 2, 3, 4], [2, 4], false)).toEqual([1, 3])
  })

  it('toggles one project idempotently and keeps the selection unique', () => {
    expect(toggleSelection([1, 2, 2], 3, true)).toEqual([1, 2, 3])
    expect(toggleSelection([1, 2, 2, 3], 2, false)).toEqual([1, 3])
  })

  it('replaces only the current group selection and ignores invalid or out-of-scope keys', () => {
    expect(updateScopedSelection([1, 2, 3, 4], [2, 3], [3, '2', 9, 3])).toEqual([1, 4, 3])
  })
})
