import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceError } from '../lib/workspace-error'
import {
  assignRecipientTask,
  listRecipientAssignments,
  unassignRecipientTask,
} from './recipient-workspace'
import { useRecipientAssignments } from './use-recipient-assignments'

vi.mock('./recipient-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recipient-workspace')>()),
  assignRecipientTask: vi.fn(),
  listRecipientAssignments: vi.fn(),
  unassignRecipientTask: vi.fn(),
}))

const assign = vi.mocked(assignRecipientTask)
const list = vi.mocked(listRecipientAssignments)
const unassign = vi.mocked(unassignRecipientTask)

const recipientId = 'd7cb98a2-1f0d-4d55-8f0f-0d6f2e3a55f1'
const coffeeId = 'd9cb5e16-c35e-4c60-8e28-26aa744034ee'
const laundryId = '4799a45d-c843-4521-b192-6c2628c518c4'
const existing = { rootTaskId: laundryId, createdAt: '2026-09-02T12:00:00.000Z' }

describe('useRecipientAssignments', () => {
  beforeEach(() => {
    assign.mockReset()
    list.mockReset()
    unassign.mockReset()
    list.mockResolvedValue([existing])
  })

  afterEach(cleanup)

  it('shows an assignment before the request settles', async () => {
    let settle: () => void = () => {}
    assign.mockReturnValue(
      new Promise((resolve) => {
        settle = () => resolve(undefined)
      }),
    )
    const { result } = renderHook(() => useRecipientAssignments(recipientId))
    await act(async () => {})

    let pending: Promise<boolean> | undefined
    await act(async () => {
      pending = result.current.assign(coffeeId, 'Make coffee', 'Alex')
    })

    expect(result.current.assignments.map((item) => item.rootTaskId)).toEqual([laundryId, coffeeId])

    await act(async () => {
      settle()
      await pending
    })

    expect(result.current.announcement).toBe('Make coffee assigned to Alex.')
  })

  it('rolls an assignment back when the request fails', async () => {
    assign.mockRejectedValue(new WorkspaceError('conflict', false))
    const { result } = renderHook(() => useRecipientAssignments(recipientId))
    await act(async () => {})

    await act(() => result.current.assign(coffeeId, 'Make coffee', 'Alex'))

    expect(result.current.assignments).toEqual([existing])
    expect(result.current.mutation).toMatchObject({ status: 'failed', action: 'assign' })
  })

  it('rolls a removal back when the request fails', async () => {
    unassign.mockRejectedValue(new WorkspaceError('unavailable', true))
    const { result } = renderHook(() => useRecipientAssignments(recipientId))
    await act(async () => {})

    await act(() => result.current.unassign(laundryId, 'Do laundry', 'Alex'))

    expect(result.current.assignments).toEqual([existing])
    expect(result.current.mutation).toMatchObject({ status: 'failed', action: 'unassign' })
  })

  it('surfaces the assignment limit message from the seam', async () => {
    assign.mockRejectedValue(
      Object.assign(new WorkspaceError('conflict', false), {
        message:
          'This recipient already has 50 assigned tasks. Remove one before assigning another.',
      }),
    )
    const { result } = renderHook(() => useRecipientAssignments(recipientId))
    await act(async () => {})

    await act(() => result.current.assign(coffeeId, 'Make coffee', 'Alex'))

    expect(
      result.current.mutation.status === 'failed' && result.current.mutation.error.message,
    ).toContain('50 assigned tasks')
  })
})
