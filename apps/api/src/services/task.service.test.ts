import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { TaskNode, TaskTreeDraft } from '@helping-hand/schemas'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { TaskService } from './task.service'
import { TaskAi } from './task-ai'

const userId = 'user-1'
const ids = {
  coffee: '00000000-0000-4000-8000-000000000001',
  mug: '00000000-0000-4000-8000-000000000002',
  brew: '00000000-0000-4000-8000-000000000003',
  dinner: '00000000-0000-4000-8000-000000000004',
  breakfast: '00000000-0000-4000-8000-000000000005',
  toast: '00000000-0000-4000-8000-000000000006',
  water: '00000000-0000-4000-8000-000000000007',
  pour: '00000000-0000-4000-8000-000000000008',
}

describe('TaskService', () => {
  let miniflare: Miniflare
  let database: D1Database
  let tasks: TaskService

  beforeEach(async () => {
    miniflare = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: 'export default { fetch() { return new Response() } }',
        d1Databases: { database: ':memory:' },
      }),
    )
    database = (await miniflare.getD1Database('database')) as D1Database

    const migrations = await Promise.all(
      ['0001_create_tasks.sql', '0002_create_auth.sql', '0003_update_tasks.sql'].map((file) =>
        Bun.file(new URL(`../migrations/${file}`, import.meta.url)).text(),
      ),
    )
    for (const migration of migrations) {
      await database.batch(
        migration
          .split(';')
          .map((statement) => statement.trim())
          .filter(Boolean)
          .map((statement) => database.prepare(statement)),
      )
    }
    await database
      .prepare(
        'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(userId, 'Test User', 'test@example.com', 1, '2026-01-01', '2026-01-01')
      .run()

    tasks = new TaskService({
      database,
      taskAi: new TaskAi({ apiKey: 'test-key' }),
    })
  })

  afterEach(async () => {
    await miniflare.dispose()
  })

  test('loads every task tree newest-first with derived summary durations', async () => {
    await database.batch([
      database
        .prepare(
          'INSERT INTO task (id, userId, parentId, title, position, durationSeconds, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(ids.coffee, userId, null, 'Make coffee', 0, null, '2026-01-01', '2026-01-01'),
      database
        .prepare(
          'INSERT INTO task (id, userId, parentId, title, position, durationSeconds, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(ids.mug, userId, ids.coffee, 'Get a mug', 0, 30, '2026-01-01', '2026-01-01'),
      database
        .prepare(
          'INSERT INTO task (id, userId, parentId, title, position, durationSeconds, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(ids.brew, userId, ids.coffee, 'Brew coffee', 1, 60, '2026-01-01', '2026-01-01'),
      database
        .prepare(
          'INSERT INTO task (id, userId, parentId, title, position, durationSeconds, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(ids.dinner, userId, null, 'Make dinner', 0, null, '2026-01-02', '2026-01-02'),
    ])

    expect(await tasks.getTaskTrees(userId)).toEqual([
      {
        id: ids.dinner,
        title: 'Make dinner',
        durationSeconds: null,
        children: [],
        revision: 0,
      },
      {
        id: ids.coffee,
        title: 'Make coffee',
        durationSeconds: 90,
        children: [
          { id: ids.mug, title: 'Get a mug', durationSeconds: 30, children: [] },
          { id: ids.brew, title: 'Brew coffee', durationSeconds: 60, children: [] },
        ],
        revision: 0,
      },
    ])
  })

  test('creates a complete task tree', async () => {
    const saved = await tasks.saveTaskTree(userId, {
      id: ids.breakfast,
      title: 'Make breakfast',
      durationSeconds: 999,
      revision: null,
      children: [{ id: ids.toast, title: 'Make toast', durationSeconds: 120, children: [] }],
    })

    expect(saved).toEqual({
      id: ids.breakfast,
      title: 'Make breakfast',
      durationSeconds: 120,
      revision: 0,
      children: [{ id: ids.toast, title: 'Make toast', durationSeconds: 120, children: [] }],
    })
    expect(await tasks.getTaskTrees(userId)).toEqual([saved])
  })

  test('updates, reorders, adds, and deletes within a complete task tree', async () => {
    await tasks.saveTaskTree(userId, {
      id: ids.coffee,
      title: 'Coffee',
      durationSeconds: null,
      revision: null,
      children: [
        { id: ids.mug, title: 'Get a mug', durationSeconds: 30, children: [] },
        {
          id: ids.brew,
          title: 'Brew',
          durationSeconds: null,
          children: [{ id: ids.water, title: 'Add water', durationSeconds: 15, children: [] }],
        },
      ],
    })

    const saved = await tasks.saveTaskTree(userId, {
      id: ids.coffee,
      title: 'Make coffee',
      durationSeconds: null,
      revision: 0,
      children: [
        {
          id: ids.brew,
          title: 'Prepare machine',
          durationSeconds: null,
          children: [
            { id: ids.water, title: 'Fill with water', durationSeconds: 20, children: [] },
          ],
        },
        { id: ids.pour, title: 'Pour coffee', durationSeconds: 20, children: [] },
      ],
    })

    expect(saved).toEqual({
      id: ids.coffee,
      title: 'Make coffee',
      durationSeconds: 40,
      revision: 1,
      children: [
        {
          id: ids.brew,
          title: 'Prepare machine',
          durationSeconds: 20,
          children: [
            { id: ids.water, title: 'Fill with water', durationSeconds: 20, children: [] },
          ],
        },
        { id: ids.pour, title: 'Pour coffee', durationSeconds: 20, children: [] },
      ],
    })
  })

  test('rejects a stale complete-tree save', async () => {
    const original = await tasks.saveTaskTree(userId, {
      id: ids.coffee,
      title: 'Coffee',
      durationSeconds: null,
      revision: null,
      children: [],
    })
    await tasks.saveTaskTree(userId, { ...original, title: 'Fresh title' })

    expect(tasks.saveTaskTree(userId, { ...original, title: 'Stale title' })).rejects.toMatchObject(
      {
        code: 'conflict',
      },
    )
    expect((await tasks.getTaskTrees(userId))[0]?.title).toBe('Fresh title')
  })

  test('rejects moving an existing task to a different parent', async () => {
    const original = await tasks.saveTaskTree(userId, {
      id: ids.coffee,
      title: 'Coffee',
      durationSeconds: null,
      revision: null,
      children: [
        {
          id: ids.brew,
          title: 'Brew',
          durationSeconds: null,
          children: [{ id: ids.water, title: 'Add water', durationSeconds: 15, children: [] }],
        },
      ],
    })
    const summary = original.children[0]
    const child = summary?.children[0]
    if (!summary || !child) throw new Error('Expected the saved task tree fixture')

    expect(
      tasks.saveTaskTree(userId, {
        ...original,
        children: [{ ...summary, children: [] }, child],
      }),
    ).rejects.toMatchObject({ code: 'invalid' })
    expect(await tasks.getTaskTrees(userId)).toEqual([original])
  })

  test('enforces the task-tree depth limit', async () => {
    const root: TaskTreeDraft = {
      id: crypto.randomUUID(),
      title: 'Level 1',
      durationSeconds: null,
      revision: null,
      children: [],
    }
    let parent: TaskNode = root
    for (let level = 2; level <= 6; level += 1) {
      const child = {
        id: crypto.randomUUID(),
        title: `Level ${level}`,
        durationSeconds: null,
        children: [],
      }
      parent.children.push(child)
      parent = child
    }

    expect(tasks.saveTaskTree(userId, root)).rejects.toMatchObject({ code: 'invalid' })
  })

  test('deletes a root task and all descendants', async () => {
    const saved = await tasks.saveTaskTree(userId, {
      id: ids.coffee,
      title: 'Coffee',
      durationSeconds: null,
      revision: null,
      children: [{ id: ids.mug, title: 'Get mug', durationSeconds: 30, children: [] }],
    })

    await tasks.deleteTaskTree(userId, saved.id, saved.revision)

    expect(await tasks.getTaskTrees(userId)).toEqual([])
  })

  test("does not expose or delete another user's task tree", async () => {
    const saved = await tasks.saveTaskTree(userId, {
      id: ids.coffee,
      title: 'Coffee',
      durationSeconds: null,
      revision: null,
      children: [],
    })

    expect(await tasks.getTaskTrees('another-user')).toEqual([])
    expect(tasks.deleteTaskTree('another-user', saved.id, saved.revision)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  test('proposes a one-level breakdown for a guest draft without saving it', async () => {
    const proposalTasks = new TaskService({
      database,
      taskAi: {
        breakDownTask: async ({ task, detail }) => {
          expect({ task, detail }).toMatchObject({
            task: { id: ids.coffee, title: 'Make coffee', children: [] },
            detail: 3,
          })
          return {
            taskId: task.id,
            children: [{ title: 'Get a mug' }, { title: 'Brew coffee' }],
          }
        },
        estimateTaskDurations: async () => {
          throw new Error('not called')
        },
        optimizeSubtaskOrder: async () => {
          throw new Error('not called')
        },
      },
    })
    const draft = {
      id: ids.coffee,
      title: 'Make coffee',
      durationSeconds: null,
      revision: null,
      children: [],
    }

    const proposal = await proposalTasks.proposeBreakdown(undefined, draft, ids.coffee, 3)

    expect(proposal).toEqual({
      taskId: ids.coffee,
      children: [
        { id: expect.any(String), title: 'Get a mug' },
        { id: expect.any(String), title: 'Brew coffee' },
      ],
    })
    expect(
      proposalTasks.proposeBreakdown(undefined, { ...draft, revision: 0 }, ids.coffee, 3),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    expect(await proposalTasks.getTaskTrees(userId)).toEqual([])
  })

  test('proposes durations only for the selected draft subtree', async () => {
    const proposalTasks = new TaskService({
      database,
      taskAi: {
        breakDownTask: async () => {
          throw new Error('not called')
        },
        estimateTaskDurations: async ({ task }) => {
          expect(task.id).toBe(ids.brew)
          expect(task.children.map(({ id }) => id)).toEqual([ids.water])
          return {
            taskId: task.id,
            durations: [{ taskId: ids.water, durationSeconds: 45 }],
          }
        },
        optimizeSubtaskOrder: async () => {
          throw new Error('not called')
        },
      },
    })
    const draft = {
      id: ids.coffee,
      title: 'Make coffee',
      durationSeconds: null,
      revision: null,
      children: [
        { id: ids.mug, title: 'Get mug', durationSeconds: null, children: [] },
        {
          id: ids.brew,
          title: 'Brew',
          durationSeconds: null,
          children: [{ id: ids.water, title: 'Add water', durationSeconds: null, children: [] }],
        },
      ],
    }

    expect(await proposalTasks.proposeDurations(userId, draft, ids.brew)).toEqual({
      taskId: ids.brew,
      durations: [{ taskId: ids.water, durationSeconds: 45 }],
    })
    expect(await proposalTasks.getTaskTrees(userId)).toEqual([])
  })

  test('proposes a sibling order without replacing the draft', async () => {
    const proposalTasks = new TaskService({
      database,
      taskAi: {
        breakDownTask: async () => {
          throw new Error('not called')
        },
        estimateTaskDurations: async () => {
          throw new Error('not called')
        },
        optimizeSubtaskOrder: async ({ task }) => {
          expect(task.children[1]?.children[0]?.id).toBe(ids.water)
          return { taskId: task.id, orderedTaskIds: [ids.brew, ids.mug] }
        },
      },
    })
    const draft = {
      id: ids.coffee,
      title: 'Make coffee',
      durationSeconds: null,
      revision: null,
      children: [
        { id: ids.mug, title: 'Get mug', durationSeconds: 30, children: [] },
        {
          id: ids.brew,
          title: 'Brew',
          durationSeconds: null,
          children: [{ id: ids.water, title: 'Add water', durationSeconds: 15, children: [] }],
        },
      ],
    }

    expect(await proposalTasks.proposeOrder(userId, draft, ids.coffee)).toEqual({
      taskId: ids.coffee,
      orderedTaskIds: [ids.brew, ids.mug],
    })
    expect(draft.children.map(({ id }) => id)).toEqual([ids.mug, ids.brew])
  })
})
