import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceError } from '../lib/workspace-error'
import {
  createRecipient,
  listRecipients,
  revokeRecipientAccess,
  updateRecipient,
} from './recipient-workspace'
import { useRecipients } from './use-recipients'

vi.mock('./recipient-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recipient-workspace')>()),
  createRecipient: vi.fn(),
  listRecipients: vi.fn(),
  revokeRecipientAccess: vi.fn(),
  updateRecipient: vi.fn(),
}))

const create = vi.mocked(createRecipient)
const list = vi.mocked(listRecipients)
const revoke = vi.mocked(revokeRecipientAccess)
const update = vi.mocked(updateRecipient)

const alex = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Alex',
  isActive: true,
  hasActiveSession: true,
  pendingEnrollmentId: null,
  createdAt: '2026-09-02T12:00:00.000Z',
  updatedAt: '2026-09-02T12:00:00.000Z',
}

describe('useRecipients', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    list.mockReset()
    create.mockReset()
    revoke.mockReset()
    update.mockReset()
    list.mockResolvedValue([alex])
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('clears an announcement after four seconds', async () => {
    create.mockResolvedValue({ ...alex, id: '2', displayName: 'Dad', hasActiveSession: false })
    const { result } = renderHook(useRecipients)
    await act(async () => {})

    await act(() => result.current.create('Dad'))
    expect(result.current.announcement).toBe('Dad added.')

    act(() => vi.advanceTimersByTime(4000))
    expect(result.current.announcement).toBe('')
  })

  it('runs one mutation at a time', async () => {
    let settle: (recipient: typeof alex) => void = () => {}
    create.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    const { result } = renderHook(useRecipients)
    await act(async () => {})

    let second: Awaited<ReturnType<typeof result.current.create>> | undefined
    await act(async () => {
      void result.current.create('Dad')
      second = await result.current.create('Sam')
    })

    expect(second).toBeNull()
    expect(create).toHaveBeenCalledTimes(1)

    await act(async () => settle({ ...alex, id: '2', displayName: 'Dad' }))
  })

  it('ends the device session locally when access is revoked', async () => {
    revoke.mockResolvedValue(undefined)
    const { result } = renderHook(useRecipients)
    await act(async () => {})

    await act(() => result.current.revokeAccess(alex.id))

    expect(result.current.recipients[0].hasActiveSession).toBe(false)
    expect(result.current.announcement).toBe('Device access revoked.')
  })

  it('says that disabling a recipient also ended their access', async () => {
    update.mockResolvedValue({ ...alex, isActive: false, hasActiveSession: false })
    const { result } = renderHook(useRecipients)
    await act(async () => {})

    await act(() => result.current.setActive(alex.id, false))

    expect(result.current.recipients[0].isActive).toBe(false)
    expect(result.current.announcement).toBe('Alex is disabled and their device access ended.')
  })

  it('keeps the list when a mutation fails', async () => {
    update.mockRejectedValue(new WorkspaceError('conflict', false))
    const { result } = renderHook(useRecipients)
    await act(async () => {})

    await act(() => result.current.rename(alex.id, 'Alexandra'))

    expect(result.current.mutation).toMatchObject({ status: 'failed', action: 'rename' })
    expect(result.current.recipients).toEqual([alex])
  })
})
