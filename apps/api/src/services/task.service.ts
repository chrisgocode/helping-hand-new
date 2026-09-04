import {
  type OrderOptimizationProposal,
  type SetTaskCategoryInput,
  TASK_TREE_LIMITS,
  type TaskBreakdownProposal,
  type TaskCategoryAssignment,
  type TaskDurationProposal,
  type TaskNode,
  type TaskTree,
  type TaskTreeDraft,
  taskTreeDraftSchema,
} from '@helping-hand/schemas'
import type { TaskAi } from './task-ai'

type TaskRow = {
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

type TaskServiceOptions = {
  database: D1Database
  taskAi: Pick<TaskAi, 'breakDownTask' | 'estimateTaskDurations' | 'optimizeSubtaskOrder'>
}

export class TaskServiceError extends Error {
  constructor(
    readonly code: 'invalid' | 'unauthorized' | 'not_found' | 'conflict',
    message: string,
  ) {
    super(message)
  }
}

function flattenDraft(draft: TaskTreeDraft) {
  const tasks: Array<TaskNode & { parentId: string | null; position: number }> = []
  const ids = new Set<string>()

  const visit = (task: TaskNode, parentId: string | null, position: number, depth: number) => {
    if (depth > TASK_TREE_LIMITS.maxDepth) {
      throw new TaskServiceError(
        'invalid',
        `Task trees cannot exceed depth ${TASK_TREE_LIMITS.maxDepth}`,
      )
    }
    if (ids.has(task.id)) throw new TaskServiceError('invalid', 'Task IDs must be unique')

    ids.add(task.id)
    tasks.push({ ...task, parentId, position })
    task.children.forEach((child, childPosition) => {
      visit(child, task.id, childPosition, depth + 1)
    })
  }

  visit(draft, null, 0, 1)
  if (tasks.length > TASK_TREE_LIMITS.maxTasksPerRoot) {
    throw new TaskServiceError(
      'invalid',
      `Task trees cannot contain more than ${TASK_TREE_LIMITS.maxTasksPerRoot} tasks`,
    )
  }
  return tasks
}

export class TaskService {
  readonly #database: D1Database
  readonly #taskAi: TaskServiceOptions['taskAi']

  constructor({ database, taskAi }: TaskServiceOptions) {
    this.#database = database
    this.#taskAi = taskAi
  }

  async #proposalTarget(userId: string | undefined, input: TaskTreeDraft, taskId: string) {
    const parsed = taskTreeDraftSchema.safeParse(input)
    if (!parsed.success) throw new TaskServiceError('invalid', 'Invalid task tree')
    const draft = parsed.data
    const tasks = flattenDraft(draft)
    const task = tasks.find(({ id }) => id === taskId)
    if (!task) throw new TaskServiceError('not_found', 'Task does not exist in this draft')

    if (draft.revision !== null) {
      if (!userId) {
        throw new TaskServiceError('unauthorized', 'Sign in to use a saved task tree')
      }
      const root = await this.#database
        .prepare('SELECT revision FROM task WHERE id = ? AND userId = ? AND parentId IS NULL')
        .bind(draft.id, userId)
        .first<{ revision: number }>()
      if (!root) throw new TaskServiceError('not_found', 'Task tree does not exist')
      if (root.revision !== draft.revision) {
        throw new TaskServiceError('conflict', 'Task tree has changed since it was loaded')
      }
    }

    return task
  }

  async getTaskTrees(userId: string): Promise<TaskTree[]> {
    const { results } = await this.#database
      .prepare(
        'SELECT id, parentId, categoryId, title, position, durationSeconds, revision, createdAt, rowid AS rowId FROM task WHERE userId = ?',
      )
      .bind(userId)
      .all<TaskRow>()

    const rows = new Map(results.map((row) => [row.id, row]))
    const children = new Map<string, TaskRow[]>()
    const roots: TaskRow[] = []

    for (const row of results) {
      if (row.parentId === null) {
        roots.push(row)
        continue
      }

      if (!rows.has(row.parentId)) throw new Error('Task tree contains an orphaned task')
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

  async saveTaskTree(userId: string, input: TaskTreeDraft): Promise<TaskTree> {
    const parsed = taskTreeDraftSchema.safeParse(input)
    if (!parsed.success) throw new TaskServiceError('invalid', 'Invalid task tree')
    const draft = parsed.data
    const tasks = flattenDraft(draft)
    if (draft.categoryId) {
      const category = await this.#database
        .prepare('SELECT id FROM category WHERE id = ? AND userId = ?')
        .bind(draft.categoryId, userId)
        .first<{ id: string }>()
      if (!category) throw new TaskServiceError('not_found', 'Category does not exist')
    }
    const { results: existingTasks } = await this.#database
      .prepare(
        'SELECT id, parentId, categoryId, title, position, durationSeconds, revision, createdAt, rowid AS rowId FROM task WHERE userId = ?',
      )
      .bind(userId)
      .all<TaskRow>()

    if (draft.revision === null) {
      if (existingTasks.length + tasks.length > TASK_TREE_LIMITS.maxTasksPerUser) {
        throw new TaskServiceError(
          'invalid',
          `Users cannot save more than ${TASK_TREE_LIMITS.maxTasksPerUser} tasks`,
        )
      }

      try {
        await this.#database.batch(
          tasks.map((task) =>
            this.#database
              .prepare(
                'INSERT INTO task (id, userId, parentId, categoryId, title, position, durationSeconds) VALUES (?, ?, ?, ?, ?, ?, ?)',
              )
              .bind(
                task.id,
                userId,
                task.parentId,
                task.parentId === null ? (draft.categoryId ?? null) : null,
                task.title,
                task.position,
                task.children.length === 0 ? task.durationSeconds : null,
              ),
          ),
        )
      } catch {
        throw new TaskServiceError('conflict', 'A task with this ID already exists')
      }

      const saved = (await this.getTaskTrees(userId)).find(({ id }) => id === draft.id)
      if (!saved) throw new TaskServiceError('conflict', 'Task tree could not be saved')
      return saved
    }

    const existingById = new Map(existingTasks.map((task) => [task.id, task]))
    const root = existingById.get(draft.id)
    if (!root || root.parentId !== null) {
      throw new TaskServiceError('not_found', 'Task tree does not exist')
    }
    if (root.revision !== draft.revision) {
      throw new TaskServiceError('conflict', 'Task tree has changed since it was loaded')
    }

    const currentIds = new Set<string>()
    // ponytail: O(n²) is bounded by the 500-task user limit; index a child map if that limit grows.
    const collectCurrentIds = (parentId: string) => {
      currentIds.add(parentId)
      existingTasks
        .filter((task) => task.parentId === parentId)
        .forEach((task) => {
          collectCurrentIds(task.id)
        })
    }
    collectCurrentIds(root.id)

    for (const task of tasks) {
      const existing = existingById.get(task.id)
      if (existing && (!currentIds.has(task.id) || existing.parentId !== task.parentId)) {
        throw new TaskServiceError('invalid', 'Existing tasks cannot be moved to another parent')
      }
    }

    if (existingTasks.length - currentIds.size + tasks.length > TASK_TREE_LIMITS.maxTasksPerUser) {
      throw new TaskServiceError(
        'invalid',
        `Users cannot save more than ${TASK_TREE_LIMITS.maxTasksPerUser} tasks`,
      )
    }

    const submittedIds = new Set(tasks.map(({ id }) => id))
    const deletedIds = [...currentIds].filter((id) => !submittedIds.has(id))
    const statements = [
      this.#database
        .prepare(
          `INSERT INTO task (id, userId, title, position)
           SELECT ?, ?, '', -1
           WHERE NOT EXISTS (
             SELECT 1 FROM task
             WHERE id = ? AND userId = ? AND parentId IS NULL AND revision = ?
           )`,
        )
        .bind(draft.id, userId, draft.id, userId, draft.revision),
    ]
    if (draft.categoryId !== undefined) {
      statements.push(
        this.#database
          .prepare(
            'UPDATE task SET categoryId = ? WHERE id = ? AND userId = ? AND parentId IS NULL',
          )
          .bind(draft.categoryId, draft.id, userId),
      )
    }
    if (deletedIds.length > 0) {
      statements.push(
        this.#database
          .prepare(
            `DELETE FROM task WHERE userId = ? AND id IN (${deletedIds.map(() => '?').join(', ')})`,
          )
          .bind(userId, ...deletedIds),
      )
    }
    for (const task of tasks) {
      const durationSeconds = task.children.length === 0 ? task.durationSeconds : null
      if (existingById.has(task.id)) {
        statements.push(
          this.#database
            .prepare(
              `UPDATE task
               SET title = ?, position = ?, durationSeconds = ?,
                   revision = revision + ?, updatedAt = CURRENT_TIMESTAMP
               WHERE id = ? AND userId = ?`,
            )
            .bind(
              task.title,
              task.position,
              durationSeconds,
              task.id === draft.id ? 1 : 0,
              task.id,
              userId,
            ),
        )
      } else {
        statements.push(
          this.#database
            .prepare(
              'INSERT INTO task (id, userId, parentId, title, position, durationSeconds) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .bind(task.id, userId, task.parentId, task.title, task.position, durationSeconds),
        )
      }
    }

    try {
      await this.#database.batch(statements)
    } catch {
      throw new TaskServiceError('conflict', 'Task tree could not be saved')
    }

    const saved = (await this.getTaskTrees(userId)).find(({ id }) => id === draft.id)
    if (!saved) throw new TaskServiceError('conflict', 'Task tree could not be saved')
    return saved
  }

  async deleteTaskTree(userId: string, rootId: string, revision: number): Promise<void> {
    const root = await this.#database
      .prepare('SELECT revision FROM task WHERE id = ? AND userId = ? AND parentId IS NULL')
      .bind(rootId, userId)
      .first<{ revision: number }>()
    if (!root) throw new TaskServiceError('not_found', 'Task tree does not exist')
    if (root.revision !== revision) {
      throw new TaskServiceError('conflict', 'Task tree has changed since it was loaded')
    }

    const result = await this.#database
      .prepare('DELETE FROM task WHERE id = ? AND userId = ? AND parentId IS NULL AND revision = ?')
      .bind(rootId, userId, revision)
      .run()
    if (result.meta.changes === 0) {
      throw new TaskServiceError('conflict', 'Task tree has changed since it was loaded')
    }
  }

  async setTaskCategory(
    userId: string,
    rootId: string,
    input: SetTaskCategoryInput,
  ): Promise<TaskCategoryAssignment> {
    const updated = await this.#database
      .prepare(
        `UPDATE task
         SET categoryId = ?, updatedAt = CURRENT_TIMESTAMP
         WHERE id = ? AND userId = ? AND parentId IS NULL
           AND (? IS NULL OR EXISTS (
             SELECT 1 FROM category WHERE id = ? AND userId = ?
           ))
         RETURNING id`,
      )
      .bind(input.categoryId, rootId, userId, input.categoryId, input.categoryId, userId)
      .first<{ id: string }>()
    if (!updated) {
      throw new TaskServiceError('not_found', 'Task tree or category does not exist')
    }
    return { rootId, categoryId: input.categoryId }
  }

  async proposeBreakdown(
    userId: string | undefined,
    draft: TaskTreeDraft,
    taskId: string,
    detail: 1 | 2 | 3 | 4 | 5,
  ): Promise<TaskBreakdownProposal> {
    if (!Number.isInteger(detail) || detail < 1 || detail > 5) {
      throw new TaskServiceError('invalid', 'Detail must be an integer from 1 to 5')
    }
    const task = await this.#proposalTarget(userId, draft, taskId)
    const suggestion = await this.#taskAi.breakDownTask({ task, detail })
    return {
      taskId,
      children: suggestion.children.map(({ title }) => ({ id: crypto.randomUUID(), title })),
    }
  }

  async proposeDurations(
    userId: string | undefined,
    draft: TaskTreeDraft,
    taskId: string,
  ): Promise<TaskDurationProposal> {
    const task = await this.#proposalTarget(userId, draft, taskId)
    const suggestion = await this.#taskAi.estimateTaskDurations({ task })
    return { taskId, durations: suggestion.durations }
  }

  async proposeOrder(
    userId: string | undefined,
    draft: TaskTreeDraft,
    taskId: string,
  ): Promise<OrderOptimizationProposal> {
    const task = await this.#proposalTarget(userId, draft, taskId)
    const suggestion = await this.#taskAi.optimizeSubtaskOrder({ task })
    return { taskId, orderedTaskIds: suggestion.orderedTaskIds }
  }
}
