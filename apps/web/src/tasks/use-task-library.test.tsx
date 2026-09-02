import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listTaskTrees, TaskWorkspaceError } from './task-workspace'
import { useTaskLibrary } from './use-task-library'

vi.mock('./task-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-workspace')>()),
  listTaskTrees: vi.fn(),
}))

const loadTasks = vi.mocked(listTaskTrees)

describe('useTaskLibrary', () => {
  beforeEach(() => loadTasks.mockReset())
  afterEach(cleanup)

  it('loads the task library', async () => {
    const tasks = [
      {
        id: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
        title: 'Make coffee',
        durationSeconds: null,
        categoryId: null,
        revision: 0,
        children: [],
      },
    ]
    loadTasks.mockResolvedValueOnce(tasks)

    const { result } = renderHook(useTaskLibrary)

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.tasks).toEqual(tasks)
  })

  it('exposes a retryable failure and can retry it', async () => {
    loadTasks
      .mockRejectedValueOnce(new TaskWorkspaceError('unavailable', true))
      .mockResolvedValueOnce([])

    const { result } = renderHook(useTaskLibrary)

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatchObject({ kind: 'unavailable', retryable: true })

    await act(result.current.retry)

    expect(result.current.status).toBe('ready')
    expect(result.current.tasks).toEqual([])
  })
})
