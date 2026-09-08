import type { TaskNode, TaskTree } from '@helping-hand/schemas'

export type TaskRow = {
  id: string
  parentId: string | null
  categoryId: string | null
  title: string
  position: number
  durationSeconds: number | null
  revision: number
  createdAt: string
  rowId: number
}

export const TASK_TREE_COLUMNS =
  'id, parentId, categoryId, title, position, durationSeconds, revision, createdAt, rowid AS rowId'

/**
 * Reconstructs complete task trees from a flat row set: sibling ordering,
 * newest-first root ordering, and summary-task duration rollup. Every row's
 * parent must be present in the same row set.
 */
export function buildTaskTrees(rows: TaskRow[]): TaskTree[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const children = new Map<string, TaskRow[]>()
  const roots: TaskRow[] = []

  for (const row of rows) {
    if (row.parentId === null) {
      roots.push(row)
      continue
    }

    if (!rowsById.has(row.parentId)) throw new Error('Task tree contains an orphaned task')
    const siblings = children.get(row.parentId) ?? []
    siblings.push(row)
    children.set(row.parentId, siblings)
  }

  for (const siblings of children.values()) {
    siblings.sort(
      (left, right) => left.position - right.position || left.id.localeCompare(right.id),
    )
  }

  const build = (row: TaskRow): TaskNode => {
    const descendants = (children.get(row.id) ?? []).map(build)
    const durationSeconds =
      descendants.length === 0
        ? row.durationSeconds
        : descendants.every((child) => child.durationSeconds !== null)
          ? descendants.reduce((total, child) => total + (child.durationSeconds ?? 0), 0)
          : null

    return { id: row.id, title: row.title, durationSeconds, children: descendants }
  }

  return roots
    .sort(
      (left, right) => right.createdAt.localeCompare(left.createdAt) || right.rowId - left.rowId,
    )
    .map((root) => ({ ...build(root), categoryId: root.categoryId, revision: root.revision }))
}
