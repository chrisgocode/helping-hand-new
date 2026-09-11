import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceError } from '../lib/workspace-error'
import { EnrollmentPanel } from './EnrollmentPanel'
import type { EnrollmentPhase } from './use-enrollment'

const enrollmentId = '44444444-4444-4444-8444-444444444444'
const secret = 'SGVsbG8tdGhpcy1pcy1hLTQzLWNoYXJhY3Rlci1zZWNyZXQ'
const expiresAt = '2026-09-09T12:10:00.000Z'

function renderPanel(phase: EnrollmentPhase, overrides: { hasActiveSession?: boolean } = {}) {
  return render(
    <EnrollmentPanel
      phase={phase}
      notice={null}
      secondsRemaining={540}
      recipientName="Alex"
      hasActiveSession={overrides.hasActiveSession ?? false}
      canEnroll
      onIssue={vi.fn()}
      onApprove={vi.fn()}
      onCancel={vi.fn()}
      onDismiss={vi.fn()}
    />,
  )
}

describe('EnrollmentPanel', () => {
  afterEach(cleanup)

  it('offers a first enrollment, and a replacement when a device is already enrolled', () => {
    renderPanel({ status: 'idle' })
    expect(screen.getByRole('button', { name: 'Show enrollment code' })).toBeTruthy()
    cleanup()

    renderPanel({ status: 'idle' }, { hasActiveSession: true })
    expect(screen.getByRole('button', { name: 'Replace this device' })).toBeTruthy()
  })

  it('draws the code without ever writing the secret into the page', () => {
    const { container } = renderPanel({
      status: 'showing-code',
      enrollmentId,
      payload: { version: 1, enrollmentId, secret },
      expiresAt,
    })

    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Enrollment code for Alex' })).toBeTruthy()
    expect(container.textContent?.includes(secret)).toBe(false)
    expect(screen.getByText('This code expires in 9:00')).toBeTruthy()
  })

  it('asks the caretaker to compare the matching code', () => {
    renderPanel({
      status: 'awaiting-confirmation',
      enrollmentId,
      matchingCode: 'AB3D9K',
      expiresAt,
    })

    expect(screen.getByText('AB3D9K')).toBeTruthy()
    expect(screen.getByText('The matching code is A B 3 D 9 K.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Codes match, approve' })).toBeTruthy()
  })

  it('marks where the caretaker is in the handshake', () => {
    renderPanel({
      status: 'showing-code',
      enrollmentId,
      payload: { version: 1, enrollmentId, secret },
      expiresAt,
    })
    expect(screen.getByText('Scan the code').closest('li')?.getAttribute('aria-current')).toBe(
      'step',
    )
    expect(screen.getByText('Approve').closest('li')?.getAttribute('aria-current')).toBeNull()
    cleanup()

    renderPanel({
      status: 'awaiting-confirmation',
      enrollmentId,
      matchingCode: 'AB3D9K',
      expiresAt,
    })
    expect(screen.getByText('Compare the codes').closest('li')?.getAttribute('aria-current')).toBe(
      'step',
    )
  })

  it('disables approval while it is in flight', () => {
    renderPanel({ status: 'approving', enrollmentId, matchingCode: 'AB3D9K', expiresAt })

    expect((screen.getByRole('button', { name: 'Approving…' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('offers a fresh code after a terminal enrollment', () => {
    renderPanel({ status: 'expired' })
    expect(screen.getByText('This enrollment expired before the device finished.')).toBeTruthy()
    cleanup()

    renderPanel({ status: 'cancelled' })
    expect(screen.getByRole('button', { name: 'Show a new code' })).toBeTruthy()
  })

  it('reports a failure as an alert', () => {
    renderPanel({ status: 'failed', error: new WorkspaceError('unavailable', true) })

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
