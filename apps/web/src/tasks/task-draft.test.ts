import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addChildTask,
  applyTaskBreakdown,
  applyTaskDurations,
  applyTaskOrder,
  countDraftTasks,
  createTaskDraft,
  deleteTask,
  getTaskDurationSeconds,
  placeTask,
  updateTaskDuration,
  updateTaskTitle,
  validateTaskDraft,
} from './task-draft'

function namedDraft() {
  const draft = createTaskDraft()
  return updateTaskTitle(draft, draft.id, 'Make coffee')
}

describe('task draft', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates a UUID when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (values: Uint8Array) => {
        values.fill(0xab)
        return values
      },
    })

    expect(createTaskDraft().id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('adds and updates nested tasks without mutating the previous draft', () => {
    const original = namedDraft()
    const withChild = addChildTask(original, original.id)
    const childId = withChild.children[0].id
    const updated = updateTaskTitle(withChild, childId, 'Fill the coffee maker')
    const nested = addChildTask(updated, childId)

    expect(original.children).toEqual([])
    expect(nested.children[0]).toMatchObject({
      title: 'Fill the coffee maker',
      children: [{ title: '' }],
    })
    expect(countDraftTasks(nested)).toBe(3)
  })

  it('updates an actionable duration and derives summary totals', () => {
    const root = namedDraft()
    const withFirst = addChildTask(root, root.id)
    const firstId = withFirst.children[0].id
    const withSecond = addChildTask(withFirst, root.id)
    const secondId = withSecond.children[1].id

    const firstTimed = updateTaskDuration(withSecond, firstId, 30)
    const complete = updateTaskDuration(firstTimed, secondId, 90)

    expect(withSecond.children[0].durationSeconds).toBeNull()
    expect(getTaskDurationSeconds(firstTimed)).toBeNull()
    expect(getTaskDurationSeconds(complete)).toBe(120)
  })

  it('applies duration deltas while preserving existing estimates', () => {
    const root = namedDraft()
    const withFirst = addChildTask(root, root.id)
    const firstId = withFirst.children[0].id
    const withSecond = addChildTask(withFirst, root.id)
    const secondId = withSecond.children[1].id
    const draft = updateTaskDuration(withSecond, firstId, 30)

    const applied = applyTaskDurations(draft, {
      taskId: root.id,
      durations: [
        { taskId: firstId, durationSeconds: 60 },
        { taskId: secondId, durationSeconds: 90 },
      ],
    })

    expect(applied.children.map(({ durationSeconds }) => durationSeconds)).toEqual([30, 90])
    expect(getTaskDurationSeconds(applied)).toBe(120)
  })

  it('rejects invalid duration targets without changing the draft', () => {
    const root = namedDraft()
    const draft = addChildTask(root, root.id)
    const childId = draft.children[0].id

    expect(() => updateTaskDuration(draft, root.id, 30)).toThrow('without subtasks')
    expect(() =>
      applyTaskDurations(draft, {
        taskId: root.id,
        durations: [{ taskId: root.id, durationSeconds: 30 }],
      }),
    ).toThrow('without subtasks')
    expect(() =>
      applyTaskDurations(draft, {
        taskId: root.id,
        durations: [
          { taskId: childId, durationSeconds: 30 },
          { taskId: childId, durationSeconds: 45 },
        ],
      }),
    ).toThrow('duplicate')
    expect(draft.children[0].durationSeconds).toBeNull()
  })

  it('applies proposed children locally without mutating the previous draft', () => {
    const draft = { ...namedDraft(), durationSeconds: 120 }
    const applied = applyTaskBreakdown(draft, {
      taskId: draft.id,
      children: [
        { id: '66e65fa9-dac8-4800-8ce3-482dcc9c6a45', title: 'Get a mug' },
        { id: '9bf8bb56-0fbd-422f-9d4d-7741347dded2', title: 'Start the coffee maker' },
      ],
    })

    expect(draft).toMatchObject({ durationSeconds: 120, children: [] })
    expect(applied).toMatchObject({
      durationSeconds: null,
      children: [
        { title: 'Get a mug', durationSeconds: null, children: [] },
        { title: 'Start the coffee maker', durationSeconds: null, children: [] },
      ],
    })
  })

  it('only applies a breakdown to an actionable task', () => {
    const root = namedDraft()
    const draft = addChildTask(root, root.id)

    expect(() =>
      applyTaskBreakdown(draft, {
        taskId: draft.id,
        children: [{ id: '66e65fa9-dac8-4800-8ce3-482dcc9c6a45', title: 'Get a mug' }],
      }),
    ).toThrow('Only tasks without subtasks can be broken down.')
  })

  it('rejects a proposal that would exceed the task-tree limit', () => {
    const draft = namedDraft()

    expect(() =>
      applyTaskBreakdown(draft, {
        taskId: draft.id,
        children: Array.from({ length: 100 }, (_, index) => ({
          id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
          title: `Task ${index + 1}`,
        })),
      }),
    ).toThrow('up to 100 tasks')
  })

  it('deletes a task with all of its descendants', () => {
    const draft = namedDraft()
    const withSummary = addChildTask(draft, draft.id)
    const summaryId = withSummary.children[0].id
    const nested = addChildTask(withSummary, summaryId)

    const deleted = deleteTask(nested, summaryId)

    expect(deleted.children).toEqual([])
  })

  it('clears a derived summary duration when deleting its last child', () => {
    const root = namedDraft()
    const summary = { ...addChildTask(root, root.id), durationSeconds: 90 }

    const actionable = deleteTask(summary, summary.children[0].id)

    expect(actionable).toMatchObject({ children: [], durationSeconds: null })
  })

  it('places a sibling at any position while preserving its descendants', () => {
    const root = namedDraft()
    const firstAdded = addChildTask(root, root.id)
    const firstId = firstAdded.children[0].id
    const secondAdded = addChildTask(firstAdded, root.id)
    const thirdAdded = addChildTask(secondAdded, root.id)
    const thirdId = thirdAdded.children[2].id
    const nested = addChildTask(thirdAdded, firstId)

    const moved = placeTask(nested, firstId, thirdId, 'after')

    expect(moved.children.map(({ id }) => id)).toEqual([
      secondAdded.children[1].id,
      thirdId,
      firstId,
    ])
    expect(moved.children[2].children).toHaveLength(1)
    expect(() => placeTask(nested, nested.children[0].children[0].id, thirdId, 'before')).toThrow(
      'same level',
    )
  })

  it('applies an exact proposed sibling order while preserving descendants', () => {
    const root = namedDraft()
    const firstAdded = addChildTask(root, root.id)
    const firstId = firstAdded.children[0].id
    const secondAdded = addChildTask(firstAdded, root.id)
    const secondId = secondAdded.children[1].id
    const nested = addChildTask(secondAdded, firstId)

    const ordered = applyTaskOrder(nested, {
      taskId: root.id,
      orderedTaskIds: [secondId, firstId],
    })

    expect(ordered.children.map(({ id }) => id)).toEqual([secondId, firstId])
    expect(ordered.children[1].children).toHaveLength(1)
    expect(nested.children.map(({ id }) => id)).toEqual([firstId, secondId])
  })

  it('rejects an incomplete or duplicate proposed sibling order', () => {
    const root = namedDraft()
    const firstAdded = addChildTask(root, root.id)
    const firstId = firstAdded.children[0].id
    const draft = addChildTask(firstAdded, root.id)

    expect(() => applyTaskOrder(draft, { taskId: root.id, orderedTaskIds: [firstId] })).toThrow(
      'every immediate subtask exactly once',
    )
    expect(() =>
      applyTaskOrder(draft, { taskId: root.id, orderedTaskIds: [firstId, firstId] }),
    ).toThrow('every immediate subtask exactly once')
  })

  it('preserves draft identity when the proposed sibling order is unchanged', () => {
    const root = namedDraft()
    const firstAdded = addChildTask(root, root.id)
    const draft = addChildTask(firstAdded, root.id)

    const ordered = applyTaskOrder(draft, {
      taskId: root.id,
      orderedTaskIds: draft.children.map(({ id }) => id),
    })

    expect(ordered).toBe(draft)
  })

  it('prevents adding beyond five task levels', () => {
    let draft = namedDraft()
    let parentId = draft.id
    for (let depth = 1; depth < 5; depth += 1) {
      draft = addChildTask(draft, parentId)
      const findNewest = (task: (typeof draft)['children'][number]): string =>
        task.children.length === 0 ? task.id : findNewest(task.children[0])
      parentId = findNewest(draft.children[0])
    }

    expect(() => addChildTask(draft, parentId)).toThrow('up to 5 levels')
  })

  it('requires every task to have a title', () => {
    const draft = namedDraft()
    const withUntitledChild = addChildTask(draft, draft.id)

    expect(validateTaskDraft(withUntitledChild)).toBe('Give every task a title before saving.')
  })

  it('prevents a root from containing more than 100 tasks', () => {
    let draft = namedDraft()
    for (let count = 1; count < 100; count += 1) draft = addChildTask(draft, draft.id)

    expect(countDraftTasks(draft)).toBe(100)
    expect(() => addChildTask(draft, draft.id)).toThrow('up to 100 tasks')
  })
})
