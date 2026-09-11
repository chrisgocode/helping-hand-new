import { Skeleton } from '../app/Skeleton'
import { EnrollmentQrCode } from './EnrollmentQrCode'
import type { EnrollmentNotice, EnrollmentPhase } from './use-enrollment'
import './EnrollmentPanel.css'

type EnrollmentPanelProps = {
  phase: EnrollmentPhase
  notice: EnrollmentNotice | null
  secondsRemaining: number | null
  recipientName: string
  hasActiveSession: boolean
  canEnroll: boolean
  onIssue: () => void
  onApprove: () => void
  onCancel: () => void
  onDismiss: () => void
}

/** Enrollment is an ordered handshake, so the caretaker is shown where they are. */
const STEPS = [
  { title: 'Scan the code', detail: 'Point the device camera at the code on the left.' },
  { title: 'Compare the codes', detail: 'Both screens show the same six characters.' },
  { title: 'Approve', detail: 'Confirm they match to finish enrollment.' },
] as const

function countdown(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const rest = `${seconds % 60}`.padStart(2, '0')
  return `${minutes}:${rest}`
}

function EnrollmentSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="enrollment-steps">
      {STEPS.map((step, index) => {
        const position = index + 1
        const state = position < current ? 'done' : position === current ? 'current' : 'ahead'
        return (
          <li
            className={`enrollment-step ${state}`}
            key={step.title}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="enrollment-step-mark" aria-hidden="true" />
            <span className="enrollment-step-title">{step.title}</span>
            <span className="enrollment-step-detail">{step.detail}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function EnrollmentPanel({
  phase,
  notice,
  secondsRemaining,
  recipientName,
  hasActiveSession,
  canEnroll,
  onIssue,
  onApprove,
  onCancel,
  onDismiss,
}: EnrollmentPanelProps) {
  const startLabel = hasActiveSession ? 'Replace this device' : 'Show enrollment code'

  if (phase.status === 'idle') {
    return (
      <div className="enrollment-panel">
        <p className="enrollment-copy">
          {hasActiveSession
            ? `Enrolling a new device ends the access of the one ${recipientName} uses now.`
            : `Show a code for ${recipientName}'s device to scan, then confirm the matching code you both see.`}
        </p>
        <button className="primary-button" type="button" disabled={!canEnroll} onClick={onIssue}>
          {startLabel}
        </button>
      </div>
    )
  }

  if (phase.status === 'issuing' || phase.status === 'resuming') {
    return (
      <div
        className="enrollment-panel enrollment-live"
        role="status"
        aria-label={
          phase.status === 'issuing' ? 'Preparing an enrollment code' : 'Checking this enrollment'
        }
        aria-busy="true"
      >
        <div className="enrollment-artifact">
          <Skeleton className="enrollment-qr-skeleton" />
        </div>
        <div className="enrollment-track">
          <EnrollmentSteps current={1} />
        </div>
      </div>
    )
  }

  if (phase.status === 'showing-code') {
    return (
      <div className="enrollment-panel enrollment-live">
        <div className="enrollment-artifact">
          <EnrollmentQrCode payload={phase.payload} recipientName={recipientName} />
        </div>
        <div className="enrollment-track">
          <EnrollmentSteps current={1} />
          <div className="enrollment-live-state">
            <p className="enrollment-status" role="status">
              Waiting for the device to scan the code.
            </p>
            {notice && <p className="enrollment-notice">{notice.message}</p>}
            <div className="enrollment-actions">
              <button className="secondary-button" type="button" onClick={onCancel}>
                Cancel enrollment
              </button>
              {secondsRemaining !== null && (
                <p className="enrollment-countdown" aria-live="off">
                  This code expires in {countdown(secondsRemaining)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (phase.status === 'code-unavailable') {
    return (
      <div className="enrollment-panel">
        <p className="enrollment-copy">
          An enrollment is already open for {recipientName}, but its code cannot be put back on
          screen. Show a new code to continue.
        </p>
        <div className="enrollment-actions">
          <button className="primary-button" type="button" onClick={onIssue}>
            Show a new code
          </button>
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel enrollment
          </button>
        </div>
      </div>
    )
  }

  if (phase.status === 'awaiting-confirmation' || phase.status === 'approving') {
    const approving = phase.status === 'approving'
    return (
      <div className="enrollment-panel enrollment-live">
        <div className="enrollment-artifact">
          <p className="matching-code" aria-hidden="true">
            {phase.matchingCode}
          </p>
          <p className="visually-hidden">
            The matching code is {phase.matchingCode.split('').join(' ')}.
          </p>
        </div>
        <div className="enrollment-track">
          <EnrollmentSteps current={2} />
          <div className="enrollment-live-state">
            <p className="enrollment-status" role="status">
              Does {recipientName}'s device show this matching code?
            </p>
            {notice && (
              <p className="enrollment-notice" role="status">
                {notice.message}
              </p>
            )}
            <div className="enrollment-actions">
              <button
                className="primary-button"
                type="button"
                disabled={approving}
                onClick={onApprove}
              >
                {approving ? 'Approving…' : 'Codes match, approve'}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={approving}
                onClick={onCancel}
              >
                Cancel enrollment
              </button>
              {secondsRemaining !== null && (
                <p className="enrollment-countdown" aria-live="off">
                  This enrollment expires in {countdown(secondsRemaining)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (phase.status === 'approved') {
    return (
      <div className="enrollment-panel enrollment-settled">
        <p className="enrollment-copy">
          {recipientName}'s device is enrolled. It can now follow everything you assign.
        </p>
        <button className="secondary-button" type="button" onClick={onDismiss}>
          Done
        </button>
      </div>
    )
  }

  if (phase.status === 'expired' || phase.status === 'cancelled') {
    return (
      <div className="enrollment-panel enrollment-settled">
        <p className="enrollment-copy">
          {phase.status === 'expired'
            ? 'This enrollment expired before the device finished.'
            : 'This enrollment was cancelled.'}
        </p>
        <button className="primary-button" type="button" disabled={!canEnroll} onClick={onIssue}>
          Show a new code
        </button>
      </div>
    )
  }

  return (
    <div className="notice error-notice" role="alert">
      <strong>The enrollment could not continue.</strong>
      <span>{phase.error.message}</span>
      {phase.error.retryable && (
        <button type="button" onClick={onIssue}>
          Try again
        </button>
      )}
    </div>
  )
}
