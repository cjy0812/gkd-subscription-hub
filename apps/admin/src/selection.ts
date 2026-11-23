export function updateVisibleSelection(
  selectedIds: readonly number[],
  visibleIds: readonly number[],
  checked: boolean,
): number[] {
  const visible = new Set(visibleIds)
  if (!checked) return selectedIds.filter((id) => !visible.has(id))
  return [...new Set([...selectedIds, ...visible])]
}

export function toggleSelection(
  selectedIds: readonly number[],
  id: number,
  checked: boolean,
): number[] {
  if (!checked) return selectedIds.filter((selectedId) => selectedId !== id)
  return [...new Set([...selectedIds, id])]
}

export function updateScopedSelection(
  selectedIds: readonly number[],
  scopeIds: readonly number[],
  selectedKeys: readonly (string | number)[],
): number[] {
  const scope = new Set(scopeIds)
  const outsideSelection = selectedIds.filter((id) => !scope.has(id))
  const scopedSelection = selectedKeys.filter(
    (key): key is number => typeof key === 'number' && scope.has(key),
  )
  return [...new Set([...outsideSelection, ...scopedSelection])]
}
