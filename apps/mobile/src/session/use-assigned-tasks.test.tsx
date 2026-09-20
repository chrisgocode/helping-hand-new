import type { RecipientTaskTree } from '@helping-hand/schemas'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EnrollmentStorage, RestoredEnrollment } from '../enrollment/enrollment-storage'
import { AssignedTasksApiError } from './assigned-tasks-api'
import { type AssignedTasksApi, useAssignedTasks } from './use-assigned-tasks'

const tree: RecipientTaskTree = {
  id: 'root',
  title: 'Morning routine',
  durationSeconds: null,
  children: [{ id: 'teeth', title: 'Brush teeth', durationSeconds: 120, children: [] }],
  category: null,
}

const activeSession: RestoredEnrollment = {
  status: 'active',
  session: {
    token: 'token-123',
    tokenType: 'Bearer',
    expiresAt: '2030-01-01T00:00:00.000Z',
    recipient: { id: '11111111-1111-4111-8111-111111111111', displayName: 'Sam' },
  },
}

function storageReturning(restored: RestoredEnrollment): EnrollmentStorage {
  return {
    restore: async () => restored,
    beginEnrollment: async () => {},
    recordClaim: async () => {},
    activateSession: async () => {},
    clearEnrollment: async () => {},
  }
}

function render(restored: RestoredEnrollment, api: AssignedTasksApi) {
  return renderHook(() => useAssignedTasks({ storage: storageReturning(restored), api }))
}

describe('useAssignedTasks', () => {
  it('loads the trees assigned to this device', async () => {
    const getAssignedTaskTrees = vi.fn(async () => [tree])
    const { result } = render(activeSession, { getAssignedTaskTrees })

    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(result.current.state).toEqual({ status: 'ready', trees: [tree] })
    expect(getAssignedTaskTrees).toHaveBeenCalledWith('token-123')
  })

  it('reports an empty assignment as a ready, empty list', async () => {
    const { result } = render(activeSession, { getAssignedTaskTrees: async () => [] })

    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', trees: [] }))
  })

  it('does not request anything without an active enrollment', async () => {
    const getAssignedTaskTrees = vi.fn(async () => [tree])
    const { result } = render({ status: 'none' }, { getAssignedTaskTrees })

    await waitFor(() => expect(result.current.state.status).toBe('unenrolled'))
    expect(getAssignedTaskTrees).not.toHaveBeenCalled()
  })

  it('separates revoked access from a failed request', async () => {
    const revoked = render(activeSession, {
      getAssignedTaskTrees: async () => {
        throw new AssignedTasksApiError(401, 'Unauthorized')
      },
    })
    await waitFor(() => expect(revoked.result.current.state.status).toBe('revoked'))

    const failed = render(activeSession, {
      getAssignedTaskTrees: async () => {
        throw new AssignedTasksApiError(503, 'Service unavailable')
      },
    })
    await waitFor(() =>
      expect(failed.result.current.state).toEqual({
        status: 'error',
        message: 'Service unavailable',
      }),
    )
  })

  it('describes an unexpected failure without leaking it', async () => {
    const { result } = render(activeSession, {
      getAssignedTaskTrees: async () => {
        throw new TypeError('Network request failed')
      },
    })

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'error',
        message: 'The assigned routines could not be loaded.',
      }),
    )
  })

  it('reloads on request', async () => {
    const getAssignedTaskTrees = vi.fn(async () => [tree])
    const { result } = render(activeSession, { getAssignedTaskTrees })

    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await result.current.reload()

    await waitFor(() => expect(getAssignedTaskTrees).toHaveBeenCalledTimes(2))
  })
})
