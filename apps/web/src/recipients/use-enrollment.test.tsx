import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceError } from '../lib/workspace-error'
import {
  approveEnrollment,
  cancelEnrollment,
  getEnrollment,
  issueEnrollment,
} from './enrollment-workspace'
import type { Recipient } from './recipient-workspace'
import { useEnrollment } from './use-enrollment'

vi.mock('./enrollment-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./enrollment-workspace')>()),
  approveEnrollment: vi.fn(),
  cancelEnrollment: vi.fn(),
  getEnrollment: vi.fn(),
  issueEnrollment: vi.fn(),
}))

const approve = vi.mocked(approveEnrollment)
const cancel = vi.mocked(cancelEnrollment)
const poll = vi.mocked(getEnrollment)
const issue = vi.mocked(issueEnrollment)

const NOW = '2026-09-09T12:00:00.000Z'
const EXPIRES = '2026-09-09T12:10:00.000Z'
const recipientId = '11111111-1111-4111-8111-111111111111'
const enrollmentId = '44444444-4444-4444-8444-444444444444'
const secret = 'SGVsbG8tdGhpcy1pcy1hLTQzLWNoYXJhY3Rlci1zZWNyZXQ'

const recipient: Recipient = {
  id: recipientId,
  displayName: 'Alex',
  isActive: true,
  hasActiveSession: false,
  pendingEnrollmentId: null,
  createdAt: NOW,
  updatedAt: NOW,
}

const issued = {
  id: enrollmentId,
  state: 'issued' as const,
  payload: { version: 1 as const, enrollmentId, secret },
  expiresAt: EXPIRES,
}

const status = (state: string, matchingCode: string | null = null) => ({
  id: enrollmentId,
  recipientId,
  state,
  matchingCode,
  expiresAt: EXPIRES,
})

/** Advances the clock and lets every promise the tick started settle. */
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

async function renderIssued(onSettled?: () => void) {
  const view = renderHook(() => useEnrollment(recipient, { onSettled }))
  await act(() => view.result.current.issue())
  return view
}

describe('useEnrollment', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    approve.mockReset()
    cancel.mockReset()
    poll.mockReset()
    issue.mockReset()
    issue.mockResolvedValue(issued)
    poll.mockResolvedValue(status('issued') as never)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows the code and polls on the contract interval', async () => {
    const { result } = await renderIssued()

    expect(result.current.phase).toMatchObject({ status: 'showing-code', payload: issued.payload })
    expect(poll).toHaveBeenCalledTimes(0)

    await advance(1500)
    expect(poll).toHaveBeenCalledTimes(0)

    await advance(1500)
    expect(poll).toHaveBeenCalledTimes(1)

    await advance(3000)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('moves to the matching code once the device claims', async () => {
    poll.mockResolvedValueOnce(status('issued') as never)
    poll.mockResolvedValueOnce(status('claimed', 'AB3D9K') as never)
    const { result } = await renderIssued()

    await advance(3000)
    await advance(3000)

    expect(result.current.phase).toMatchObject({
      status: 'awaiting-confirmation',
      matchingCode: 'AB3D9K',
    })
    expect(result.current.announcement).toBe('The device is showing matching code A B 3 D 9 K.')
  })

  it('expires locally at the deadline and stops polling', async () => {
    const { result } = await renderIssued()

    await advance(600_000)
    expect(result.current.phase.status).toBe('expired')

    const settled = poll.mock.calls.length
    await advance(3000)
    await advance(3000)
    expect(poll).toHaveBeenCalledTimes(settled)
  })

  it('accepts an expiry the server reports first', async () => {
    poll.mockResolvedValueOnce(status('expired') as never)
    const { result } = await renderIssued()

    await advance(3000)

    expect(result.current.phase.status).toBe('expired')
  })

  it('keeps the panel and resyncs when the matching code went stale', async () => {
    poll.mockResolvedValue(status('claimed', 'AB3D9K') as never)
    approve.mockRejectedValue(
      Object.assign(new WorkspaceError('conflict', false), {
        message: 'The device is not showing this code any more.',
      }),
    )
    const { result } = await renderIssued()
    await advance(3000)

    const before = poll.mock.calls.length
    await act(() => result.current.approve())

    expect(result.current.phase.status).toBe('awaiting-confirmation')
    expect(result.current.notice).toMatchObject({ kind: 'stale-code' })
    expect(poll.mock.calls.length).toBeGreaterThan(before)
  })

  it('expires when approval finds the window closed', async () => {
    poll.mockResolvedValue(status('claimed', 'AB3D9K') as never)
    approve.mockRejectedValue(new WorkspaceError('gone', false))
    const { result } = await renderIssued()
    await advance(3000)

    await act(() => result.current.approve())

    expect(result.current.phase.status).toBe('expired')
  })

  it('honours Retry-After and returns to the normal interval afterwards', async () => {
    poll.mockRejectedValueOnce(
      Object.assign(new WorkspaceError('rate_limited', true), { retryAfterSeconds: 60 }),
    )
    const { result } = await renderIssued()

    await advance(3000)
    expect(poll).toHaveBeenCalledTimes(1)
    expect(result.current.notice).toMatchObject({ kind: 'rate-limited' })

    await advance(3000)
    expect(poll).toHaveBeenCalledTimes(1)

    await advance(57_000)
    expect(poll).toHaveBeenCalledTimes(2)
    expect(result.current.notice).toBeNull()

    await advance(3000)
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('backs off a failing service and gives up after five tries', async () => {
    poll.mockRejectedValue(new WorkspaceError('unavailable', true))
    const { result } = await renderIssued()

    await advance(3000)
    expect(poll).toHaveBeenCalledTimes(1)
    await advance(6000)
    expect(poll).toHaveBeenCalledTimes(2)
    await advance(12_000)
    expect(poll).toHaveBeenCalledTimes(3)
    await advance(24_000)
    expect(poll).toHaveBeenCalledTimes(4)
    await advance(48_000)

    expect(poll).toHaveBeenCalledTimes(5)
    expect(result.current.phase).toMatchObject({ status: 'failed' })
  })

  it('stops polling when the panel unmounts', async () => {
    const { unmount } = await renderIssued()
    await advance(3000)
    const before = poll.mock.calls.length

    unmount()
    await advance(30_000)

    expect(poll).toHaveBeenCalledTimes(before)
  })

  it('rejoins an enrollment that is already waiting for confirmation', async () => {
    poll.mockResolvedValue(status('claimed', 'AB3D9K') as never)
    const pending = { ...recipient, pendingEnrollmentId: enrollmentId }
    const { result } = renderHook(() => useEnrollment(pending))

    await act(async () => {})

    expect(result.current.phase).toMatchObject({
      status: 'awaiting-confirmation',
      matchingCode: 'AB3D9K',
    })
    expect(issue).not.toHaveBeenCalled()
  })

  it('keeps the code on screen when the recipient refreshes into a pending enrollment', async () => {
    // Issuing makes the new enrollment the recipient's pending one. A refresh
    // that reports it back must not be mistaken for an enrollment to rejoin.
    const { result, rerender } = renderHook(({ current }) => useEnrollment(current), {
      initialProps: { current: recipient },
    })

    await act(() => result.current.issue())
    expect(result.current.phase.status).toBe('showing-code')

    rerender({ current: { ...recipient, pendingEnrollmentId: enrollmentId } })
    await advance(0)

    expect(result.current.phase).toMatchObject({ status: 'showing-code', payload: issued.payload })
  })

  it('admits that an issued code cannot be put back on screen', async () => {
    const pending = { ...recipient, pendingEnrollmentId: enrollmentId }
    const { result } = renderHook(() => useEnrollment(pending))

    await act(async () => {})

    expect(result.current.phase.status).toBe('code-unavailable')
  })

  it('reports a successful approval once', async () => {
    poll.mockResolvedValue(status('claimed', 'AB3D9K') as never)
    approve.mockResolvedValue(status('approved', 'AB3D9K') as never)
    const onSettled = vi.fn()
    const { result } = await renderIssued(onSettled)
    await advance(3000)
    onSettled.mockClear()

    await act(() => result.current.approve())

    expect(result.current.phase).toMatchObject({ status: 'approved' })
    expect(result.current.announcement).toBe('The device is enrolled.')
    expect(onSettled).toHaveBeenCalledTimes(1)

    const settled = poll.mock.calls.length
    await advance(30_000)
    expect(poll).toHaveBeenCalledTimes(settled)
  })

  it('cancels an enrollment in flight', async () => {
    cancel.mockResolvedValue(undefined)
    const { result } = await renderIssued()

    await act(() => result.current.cancel())

    expect(cancel).toHaveBeenCalledWith(enrollmentId)
    expect(result.current.phase.status).toBe('cancelled')

    const settled = poll.mock.calls.length
    await advance(30_000)
    expect(poll).toHaveBeenCalledTimes(settled)
  })
})
