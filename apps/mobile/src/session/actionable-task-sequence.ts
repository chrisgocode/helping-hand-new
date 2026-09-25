import type { TaskNode } from '@helping-hand/schemas'

/**
 * An actionable task as a guided session presents it: the task itself plus the
 * summary tasks it sits under, outermost first. The path is what lets a spoken
 * session say where the recipient is without reading the whole tree back.
 */
export type SequencedTask = {
  readonly id: string
  readonly title: string
  readonly durationSeconds: number | null
  readonly path: readonly string[]
}

/**
 * Flattens a task tree into the order a guided session walks it: depth-first,
 * actionable tasks only. Summary tasks group work rather than representing an
 * action, so they are never presented; they survive only as path entries.
 *
 * A root with no children is itself actionable, so a single-task tree yields one
 * entry rather than none.
 */
export function sequenceActionableTasks(root: TaskNode): SequencedTask[] {
  const sequenced: SequencedTask[] = []

  const visit = (node: TaskNode, path: readonly string[]) => {
    if (node.children.length === 0) {
      sequenced.push({
        id: node.id,
        title: node.title,
        durationSeconds: node.durationSeconds,
        path,
      })
      return
    }

    const childPath = [...path, node.title]
    for (const child of node.children) visit(child, childPath)
  }

  visit(root, [])

  return sequenced
}
