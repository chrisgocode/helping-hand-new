import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  proposeTaskBreakdown,
  proposeTaskDurations,
  proposeTaskOrder,
  saveTaskTree,
  TaskWorkspaceError,
} from './task-workspace'
import { useTaskEditor } from './use-task-editor'

vi.mock('./task-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-workspace')>()),
  proposeTaskBreakdown: vi.fn(),
  proposeTaskDurations: vi.fn(),
  proposeTaskOrder: vi.fn(),
  saveTaskTree: vi.fn(),
}))

const proposeBreakdown = vi.mocked(proposeTaskBreakdown)
const proposeDurations = vi.mocked(proposeTaskDurations)
const proposeOrder = vi.mocked(proposeTaskOrder)
const saveDraft = vi.mocked(saveTaskTree)

describe('useTaskEditor', () => {
  beforeEach(() => {
    proposeBreakdown.mockReset()
    proposeDurations.mockReset()
    proposeOrder.mockReset()
    saveDraft.mockReset()
  })
  afterEach(cleanup)

  it('tracks local edits without saving them', () => {
    const { result } = renderHook(useTaskEditor)

    act(() => result.current.updateTitle(result.current.draft.id, 'Make coffee'))

    expect(result.current.draft.title).toBe('Make coffee')
    expect(result.current.isDirty).toBe(true)
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('keeps a root category change local until the task tree is saved', async () => {
    const categoryId = '66e65fa9-dac8-4800-8ce3-482dcc9c6a45'
    const { result } = renderHook(useTaskEditor)

    act(() => {
      result.current.updateTitle(result.current.draft.id, 'Make coffee')
      result.current.updateCategory(categoryId)
    })

    expect(result.current.draft.categoryId).toBe(categoryId)
    expect(result.current.isDirty).toBe(true)
    expect(saveDraft).not.toHaveBeenCalled()

    saveDraft.mockImplementationOnce(async (draft) => ({
      ...draft,
      categoryId: draft.categoryId ?? null,
      revision: 0,
    }))
    await act(result.current.save)

    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ categoryId }))
    expect(result.current.isDirty).toBe(false)
  })

  it('generates durations through the Task editor and includes them when saving', async () => {
    const existing = {
      id: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
      title: 'Make coffee',
      durationSeconds: null,
      revision: 2,
      children: [],
    }
    const { result } = renderHook(() => useTaskEditor(existing))
    proposeDurations.mockResolvedValueOnce({
      taskId: existing.id,
      durations: [{ taskId: existing.id, durationSeconds: 300 }],
    })

    await act(() => result.current.ai.generateDurations(existing.id))
    saveDraft.mockImplementationOnce(async (draft) => ({
      ...draft,
      categoryId: draft.categoryId ?? null,
      revision: 3,
    }))
    await act(result.current.save)

    expect(proposeDurations).toHaveBeenCalledWith(existing, existing.id)
    expect(saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 300, revision: 2 }),
    )
  })

  it('applies a Task breakdown locally without saving it', async () => {
    const { result } = renderHook(useTaskEditor)
    act(() => result.current.updateTitle(result.current.draft.id, 'Make coffee'))
    const taskId = result.current.draft.id
    proposeBreakdown.mockResolvedValueOnce({
      taskId,
      children: [{ id: '66e65fa9-dac8-4800-8ce3-482dcc9c6a45', title: 'Get a mug' }],
    })

    const outcome = await act(() => result.current.ai.breakDown(taskId, 4))

    expect(outcome).toBe('applied')
    expect(proposeBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Make coffee' }),
      taskId,
      4,
    )
    expect(result.current.draft.children[0].title).toBe('Get a mug')
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('keeps an unchanged Order optimization clean', async () => {
    vi.useFakeTimers()
    const existing = {
      id: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
      title: 'Make coffee',
      durationSeconds: null,
      revision: 2,
      children: [
        {
          id: '66e65fa9-dac8-4800-8ce3-482dcc9c6a45',
          title: 'Get a mug',
          durationSeconds: null,
          children: [],
        },
        {
          id: '9bf8bb56-0fbd-422f-9d4d-7741347dded2',
          title: 'Brew coffee',
          durationSeconds: null,
          children: [],
        },
      ],
    }
    proposeOrder.mockResolvedValueOnce({
      taskId: existing.id,
      orderedTaskIds: existing.children.map(({ id }) => id),
    })
    const { result } = renderHook(() => useTaskEditor(existing))

    const outcome = await act(() => result.current.ai.optimizeOrder(existing.id))

    expect(outcome).toBe('unchanged')
    expect(result.current.isDirty).toBe(false)
    expect(result.current.ai.state).toEqual({
      status: 'order-unchanged',
      taskId: existing.id,
    })

    act(() => vi.advanceTimersByTime(4000))
    expect(result.current.ai.state).toEqual({ status: 'idle' })
    vi.useRealTimers()
  })

  it('retries manually and clears a failed request after a draft edit', async () => {
    const { result } = renderHook(useTaskEditor)
    act(() => result.current.updateTitle(result.current.draft.id, 'Make coffee'))
    const taskId = result.current.draft.id
    proposeDurations.mockRejectedValueOnce(new TaskWorkspaceError('ai_timeout', true))

    expect(await act(() => result.current.ai.generateDurations(taskId))).toBe('failed')
    expect(result.current.ai.state).toMatchObject({
      status: 'failed',
      recovery: 'retry',
    })

    act(() => result.current.updateTitle(taskId, 'Make tea'))
    expect(result.current.ai.state).toEqual({ status: 'idle' })
    expect(await act(result.current.ai.retry)).toBe('failed')
    expect(proposeDurations).toHaveBeenCalledOnce()
  })

  it('manually retries the original action and parameters', async () => {
    const { result } = renderHook(useTaskEditor)
    act(() => result.current.updateTitle(result.current.draft.id, 'Make coffee'))
    const taskId = result.current.draft.id
    const proposal = {
      taskId,
      children: [{ id: '66e65fa9-dac8-4800-8ce3-482dcc9c6a45', title: 'Get a mug' }],
    }
    proposeBreakdown
      .mockRejectedValueOnce(new TaskWorkspaceError('ai_timeout', true))
      .mockResolvedValueOnce(proposal)

    expect(await act(() => result.current.ai.breakDown(taskId, 5))).toBe('failed')
    expect(await act(result.current.ai.retry)).toBe('applied')

    expect(proposeBreakdown).toHaveBeenNthCalledWith(1, expect.any(Object), taskId, 5)
    expect(proposeBreakdown).toHaveBeenNthCalledWith(2, expect.any(Object), taskId, 5)
    expect(result.current.draft.children[0].title).toBe('Get a mug')
  })

  it('allows only one AI proposal request at a time', async () => {
    const { result } = renderHook(useTaskEditor)
    act(() => result.current.updateTitle(result.current.draft.id, 'Make coffee'))
    const taskId = result.current.draft.id
    let resolveDuration: (proposal: {
      taskId: string
      durations: { taskId: string; durationSeconds: number }[]
    }) => void = () => undefined
    proposeDurations.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDuration = resolve
      }),
    )

    let firstRequest: Promise<unknown> = Promise.resolve()
    act(() => {
      firstRequest = result.current.ai.generateDurations(taskId)
    })
    expect(await act(() => result.current.ai.optimizeOrder(taskId))).toBe('failed')

    resolveDuration({ taskId, durations: [{ taskId, durationSeconds: 300 }] })
    await act(() => firstRequest)
    expect(proposeDurations).toHaveBeenCalledOnce()
    expect(proposeOrder).not.toHaveBeenCalled()
  })

  it('normalizes an unsafe AI proposal without changing the draft', async () => {
    const existing = {
      id: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
      title: 'Make coffee',
      durationSeconds: null,
      revision: 2,
      children: [
        {
          id: '66e65fa9-dac8-4800-8ce3-482dcc9c6a45',
          title: 'Get a mug',
          durationSeconds: null,
          children: [],
        },
        {
          id: '9bf8bb56-0fbd-422f-9d4d-7741347dded2',
          title: 'Brew coffee',
          durationSeconds: null,
          children: [],
        },
      ],
    }
    proposeOrder.mockResolvedValueOnce({
      taskId: existing.id,
      orderedTaskIds: [existing.children[0].id],
    })
    const { result } = renderHook(() => useTaskEditor(existing))

    expect(await act(() => result.current.ai.optimizeOrder(existing.id))).toBe('failed')

    expect(result.current.draft).toBe(existing)
    expect(result.current.ai.state).toMatchObject({
      status: 'failed',
      message: 'Something went wrong. Please try again.',
      recovery: 'retry',
    })
  })

  it('starts an existing task tree clean and preserves its revision when saving', async () => {
    const existing = {
      id: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
      title: 'Make coffee',
      durationSeconds: null,
      revision: 4,
      children: [],
    }
    const { result } = renderHook(() => useTaskEditor(existing))

    expect(result.current.isDirty).toBe(false)
    act(() => result.current.updateTitle(existing.id, 'Make tea'))
    saveDraft.mockImplementationOnce(async (draft) => ({
      ...draft,
      categoryId: draft.categoryId ?? null,
      revision: 5,
    }))

    await act(result.current.save)

    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }))
    expect(result.current.draft.revision).toBe(5)
  })

  it('adopts the saved tree as its new baseline', async () => {
    const { result } = renderHook(useTaskEditor)
    act(() => result.current.updateTitle(result.current.draft.id, 'Make coffee'))
    saveDraft.mockImplementationOnce(async (draft) => ({
      ...draft,
      categoryId: draft.categoryId ?? null,
      revision: 0,
    }))

    await act(result.current.save)

    expect(result.current.status).toBe('saved')
    expect(result.current.draft.revision).toBe(0)
    expect(result.current.isDirty).toBe(false)
  })

  it('preserves the draft when saving fails', async () => {
    const { result } = renderHook(useTaskEditor)
    act(() => result.current.updateTitle(result.current.draft.id, 'Make coffee'))
    saveDraft.mockRejectedValueOnce(new TaskWorkspaceError('unavailable', true))

    await act(result.current.save)
    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current.draft.title).toBe('Make coffee')
    expect(result.current.isDirty).toBe(true)
    expect(result.current.error).toMatchObject({ kind: 'unavailable', retryable: true })
  })
})
