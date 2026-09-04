import type { components } from '@helping-hand/api-client'
import { TASK_TREE_LIMITS } from '@helping-hand/schemas/task-limits'

export type TaskNode = components['schemas']['TaskNode']
export type TaskTreeDraft = components['schemas']['TaskTreeDraft']
export type TaskBreakdownProposal = components['schemas']['TaskBreakdownProposal']
export type TaskDurationProposal = components['schemas']['TaskDurationProposal']
export type TaskOrderProposal = components['schemas']['OrderOptimizationProposal']

export class TaskDraftError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskDraftError'
  }
}

function createUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

export function createTaskDraft(categoryId?: string): TaskTreeDraft {
  return {
    id: createUuid(),
    title: '',
    durationSeconds: null,
    children: [],
    ...(categoryId ? { categoryId } : {}),
    revision: null,
  }
}

function updateTask(
  draft: TaskTreeDraft,
  taskId: string,
  update: (task: TaskNode) => TaskNode,
): TaskTreeDraft {
  let found = false
  const visit = (task: TaskNode): TaskNode => {
    if (task.id === taskId) {
      found = true
      return update(task)
    }

    const children = task.children.map(visit)
    return children.some((child, index) => child !== task.children[index])
      ? { ...task, children }
      : task
  }

  const next = visit(draft) as TaskTreeDraft
  if (!found) throw new TaskDraftError('Task does not exist in this draft.')
  return next
}

function taskDepth(task: TaskNode, taskId: string, depth = 1): number | null {
  if (task.id === taskId) return depth
  for (const child of task.children) {
    const childDepth = taskDepth(child, taskId, depth + 1)
    if (childDepth !== null) return childDepth
  }
  return null
}

function findTask(task: TaskNode, taskId: string): TaskNode | null {
  if (task.id === taskId) return task
  for (const child of task.children) {
    const found = findTask(child, taskId)
    if (found) return found
  }
  return null
}

export function countDraftTasks(task: TaskNode): number {
  return 1 + task.children.reduce((total, child) => total + countDraftTasks(child), 0)
}

export function updateTaskTitle(
  draft: TaskTreeDraft,
  taskId: string,
  title: string,
): TaskTreeDraft {
  return updateTask(draft, taskId, (task) => ({ ...task, title }))
}

export function updateTaskCategory(draft: TaskTreeDraft, categoryId: string | null): TaskTreeDraft {
  return draft.categoryId === categoryId ? draft : { ...draft, categoryId }
}

export function updateTaskDuration(
  draft: TaskTreeDraft,
  taskId: string,
  durationSeconds: number | null,
): TaskTreeDraft {
  if (durationSeconds !== null && (!Number.isInteger(durationSeconds) || durationSeconds < 0)) {
    throw new TaskDraftError('Task durations must be a nonnegative number of seconds.')
  }
  return updateTask(draft, taskId, (task) => {
    if (task.children.length > 0) {
      throw new TaskDraftError('Only tasks without subtasks can have an editable duration.')
    }
    return task.durationSeconds === durationSeconds ? task : { ...task, durationSeconds }
  })
}

export function getTaskDurationSeconds(task: TaskNode): number | null {
  if (task.children.length === 0) return task.durationSeconds
  const durations = task.children.map(getTaskDurationSeconds)
  return durations.some((duration) => duration === null)
    ? null
    : durations.reduce<number>((total, duration) => total + (duration ?? 0), 0)
}

export function applyTaskDurations(
  draft: TaskTreeDraft,
  proposal: TaskDurationProposal,
): TaskTreeDraft {
  const target = findTask(draft, proposal.taskId)
  if (!target) throw new TaskDraftError('Task does not exist in this draft.')

  const actionableIds = new Set<string>()
  const collectActionable = (task: TaskNode) => {
    if (task.children.length === 0) actionableIds.add(task.id)
    else task.children.forEach(collectActionable)
  }
  collectActionable(target)

  const durations = new Map<string, number>()
  for (const delta of proposal.durations) {
    if (durations.has(delta.taskId)) {
      throw new TaskDraftError('A task duration proposal cannot contain duplicate tasks.')
    }
    if (!actionableIds.has(delta.taskId)) {
      throw new TaskDraftError('A proposed duration must target a task without subtasks.')
    }
    if (!Number.isInteger(delta.durationSeconds) || delta.durationSeconds < 0) {
      throw new TaskDraftError('Task durations must be a nonnegative number of seconds.')
    }
    durations.set(delta.taskId, delta.durationSeconds)
  }

  const visit = (task: TaskNode): TaskNode => {
    if (task.children.length === 0) {
      const durationSeconds = durations.get(task.id)
      return durationSeconds === undefined || task.durationSeconds !== null
        ? task
        : { ...task, durationSeconds }
    }
    const children = task.children.map(visit)
    return children.some((child, index) => child !== task.children[index])
      ? { ...task, children }
      : task
  }

  return visit(draft) as TaskTreeDraft
}

export function addChildTask(draft: TaskTreeDraft, parentId: string): TaskTreeDraft {
  const depth = taskDepth(draft, parentId)
  if (depth === null) throw new TaskDraftError('Task does not exist in this draft.')
  if (depth >= TASK_TREE_LIMITS.maxDepth) {
    throw new TaskDraftError(`Task trees can contain up to ${TASK_TREE_LIMITS.maxDepth} levels.`)
  }
  if (countDraftTasks(draft) >= TASK_TREE_LIMITS.maxTasksPerRoot) {
    throw new TaskDraftError(
      `Task trees can contain up to ${TASK_TREE_LIMITS.maxTasksPerRoot} tasks.`,
    )
  }

  return updateTask(draft, parentId, (parent) => ({
    ...parent,
    durationSeconds: null,
    children: [
      ...parent.children,
      { id: createUuid(), title: '', durationSeconds: null, children: [] },
    ],
  }))
}

export function applyTaskBreakdown(
  draft: TaskTreeDraft,
  proposal: TaskBreakdownProposal,
): TaskTreeDraft {
  const depth = taskDepth(draft, proposal.taskId)
  if (depth === null) throw new TaskDraftError('Task does not exist in this draft.')
  if (depth >= TASK_TREE_LIMITS.maxDepth) {
    throw new TaskDraftError(`Task trees can contain up to ${TASK_TREE_LIMITS.maxDepth} levels.`)
  }
  if (countDraftTasks(draft) + proposal.children.length > TASK_TREE_LIMITS.maxTasksPerRoot) {
    throw new TaskDraftError(
      `Task trees can contain up to ${TASK_TREE_LIMITS.maxTasksPerRoot} tasks.`,
    )
  }
  return updateTask(draft, proposal.taskId, (task) => {
    if (task.children.length > 0) {
      throw new TaskDraftError('Only tasks without subtasks can be broken down.')
    }
    return {
      ...task,
      durationSeconds: null,
      children: proposal.children.map((child) => ({
        ...child,
        durationSeconds: null,
        children: [],
      })),
    }
  })
}

export function deleteTask(draft: TaskTreeDraft, taskId: string): TaskTreeDraft {
  if (draft.id === taskId) throw new TaskDraftError('The root task cannot be deleted here.')

  let found = false
  const visit = (task: TaskNode): TaskNode => {
    const children = task.children
      .filter((child) => {
        if (child.id !== taskId) return true
        found = true
        return false
      })
      .map(visit)
    return children.length !== task.children.length ||
      children.some((child, index) => child !== task.children[index])
      ? { ...task, durationSeconds: children.length === 0 ? null : task.durationSeconds, children }
      : task
  }

  const next = visit(draft) as TaskTreeDraft
  if (!found) throw new TaskDraftError('Task does not exist in this draft.')
  return next
}

export function placeTask(
  draft: TaskTreeDraft,
  taskId: string,
  targetId: string,
  placement: 'before' | 'after',
): TaskTreeDraft {
  if (taskId === targetId) return draft
  if (!findTask(draft, taskId) || !findTask(draft, targetId)) {
    throw new TaskDraftError('Task does not exist in this draft.')
  }

  let reordered = false
  const visit = (task: TaskNode): TaskNode => {
    const sourceIndex = task.children.findIndex((child) => child.id === taskId)
    const targetIndex = task.children.findIndex((child) => child.id === targetId)
    if (sourceIndex !== -1 && targetIndex !== -1) {
      reordered = true
      const children = [...task.children]
      const [moved] = children.splice(sourceIndex, 1)
      const destination = children.findIndex((child) => child.id === targetId)
      children.splice(destination + (placement === 'after' ? 1 : 0), 0, moved)
      return children.every((child, index) => child === task.children[index])
        ? task
        : { ...task, children }
    }

    const children = task.children.map(visit)
    return children.some((child, index) => child !== task.children[index])
      ? { ...task, children }
      : task
  }

  const next = visit(draft) as TaskTreeDraft
  if (!reordered) throw new TaskDraftError('Tasks can only move within the same level.')
  return next
}

export function applyTaskOrder(draft: TaskTreeDraft, proposal: TaskOrderProposal): TaskTreeDraft {
  const target = findTask(draft, proposal.taskId)
  if (!target) throw new TaskDraftError('Task does not exist in this draft.')

  const childrenById = new Map(target.children.map((child) => [child.id, child]))
  const orderedIds = new Set(proposal.orderedTaskIds)
  if (
    proposal.orderedTaskIds.length !== target.children.length ||
    orderedIds.size !== target.children.length ||
    proposal.orderedTaskIds.some((id) => !childrenById.has(id))
  ) {
    throw new TaskDraftError('A proposed order must contain every immediate subtask exactly once.')
  }
  if (target.children.every((child, index) => child.id === proposal.orderedTaskIds[index])) {
    return draft
  }

  return updateTask(draft, proposal.taskId, (task) => ({
    ...task,
    children: proposal.orderedTaskIds.map((id) => childrenById.get(id) as TaskNode),
  }))
}

export function validateTaskDraft(draft: TaskTreeDraft): string | null {
  let taskCount = 0
  let issue: string | null = null

  const visit = (task: TaskNode, depth: number) => {
    taskCount += 1
    if (!issue && task.title.trim().length === 0) issue = 'Give every task a title before saving.'
    if (!issue && task.title.trim().length > 200)
      issue = 'Task titles cannot exceed 200 characters.'
    if (!issue && depth > TASK_TREE_LIMITS.maxDepth) {
      issue = `Task trees can contain up to ${TASK_TREE_LIMITS.maxDepth} levels.`
    }
    task.children.forEach((child) => {
      visit(child, depth + 1)
    })
  }

  visit(draft, 1)
  if (!issue && taskCount > TASK_TREE_LIMITS.maxTasksPerRoot) {
    issue = `Task trees can contain up to ${TASK_TREE_LIMITS.maxTasksPerRoot} tasks.`
  }
  return issue
}
