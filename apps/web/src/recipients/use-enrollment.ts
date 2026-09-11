import { ENROLLMENT_TIMINGS } from '@helping-hand/schemas'
import { useCallback, useEffect, useRef, useState } from 'react'
import { WorkspaceError } from '../lib/workspace-error'
import {
  approveEnrollment,
  cancelEnrollment,
  type EnrollmentPayload,
  type EnrollmentStatus,
  getEnrollment,
  isEnrollmentError,
  issueEnrollment,
} from './enrollment-workspace'
import type { Recipient } from './recipient-workspace'

const BASE_DELAY = ENROLLMENT_TIMINGS.pollIntervalSeconds * 1000
const MAX_DELAY = 60_000
/** How many failing polls in a row before the caretaker is asked to retry. */
const MAX_POLL_FAILURES = 5

export type EnrollmentPhase =
  | { status: 'idle' }
  | { status: 'issuing' }
  | { status: 'resuming'; enrollmentId: string }
  | { status: 'showing-code'; enrollmentId: string; payload: EnrollmentPayload; expiresAt: string }
  | { status: 'code-unavailable'; enrollmentId: string; expiresAt: string }
  | {
      status: 'awaiting-confirmation'
      enrollmentId: string
      matchingCode: string
      expiresAt: string
    }
  | { status: 'approving'; enrollmentId: string; matchingCode: string; expiresAt: string }
  | { status: 'approved'; enrollmentId: string }
  | { status: 'expired' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: WorkspaceError }

export type EnrollmentNotice = {
  kind: 'stale-code' | 'rate-limited' | 'poll-unavailable'
  message: string
}

type PollTarget = { enrollmentId: string; expiresAt: string }

function asWorkspaceError(cause: unknown) {
  return cause instanceof WorkspaceError
    ? cause
    : new WorkspaceError('unexpected', false, { cause })
}

/** The deadline a phase is counting down to, when it has one. */
function deadlineOf(phase: EnrollmentPhase): string | null {
  return 'expiresAt' in phase ? phase.expiresAt : null
}

export function useEnrollment(
  recipient: Recipient | null,
  options: { onSettled?: () => void } = {},
) {
  const { onSettled } = options
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled

  const pollTimer = useRef<number | null>(null)
  const requestId = useRef(0)
  const inFlight = useRef(false)
  const delay = useRef(BASE_DELAY)
  const failureStreak = useRef(0)
  const target = useRef<PollTarget | null>(null)
  const resuming = useRef(false)
  const lastCode = useRef<string | null>(null)

  const [phase, setPhase] = useState<EnrollmentPhase>({ status: 'idle' })
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const [notice, setNotice] = useState<EnrollmentNotice | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
    target.current = null
  }, [])

  // One place ends the flow, so no timer can outlive a terminal phase.
  const settle = useCallback(
    (next: EnrollmentPhase, spoken?: string) => {
      stopPolling()
      setPhase(next)
      setNotice(null)
      setSecondsRemaining(null)
      if (spoken) setAnnouncement(spoken)
      onSettledRef.current?.()
    },
    [stopPolling],
  )

  const pollRef = useRef<() => Promise<void>>(async () => {})

  const schedule = useCallback((wait: number) => {
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    pollTimer.current = window.setTimeout(() => {
      void pollRef.current()
    }, wait)
  }, [])

  const applyStatus = useCallback(
    (status: EnrollmentStatus) => {
      if (status.state === 'cancelled') {
        settle({ status: 'cancelled' })
        return
      }
      if (status.state === 'expired') {
        settle({ status: 'expired' })
        return
      }
      if (status.state === 'approved' || status.state === 'delivered') {
        settle({ status: 'approved', enrollmentId: status.id })
        return
      }
      if (status.state === 'claimed' && status.matchingCode) {
        target.current = { enrollmentId: status.id, expiresAt: status.expiresAt }
        // A stale-code warning only stops applying once the device moves on.
        if (lastCode.current !== status.matchingCode) setNotice(null)
        lastCode.current = status.matchingCode
        setPhase((current) =>
          current.status === 'approving'
            ? current
            : {
                status: 'awaiting-confirmation',
                enrollmentId: status.id,
                matchingCode: status.matchingCode as string,
                expiresAt: status.expiresAt,
              },
        )
        setAnnouncement(
          `The device is showing matching code ${status.matchingCode.split('').join(' ')}.`,
        )
        schedule(delay.current)
        return
      }

      target.current = { enrollmentId: status.id, expiresAt: status.expiresAt }
      // Only the issue response carries the QR secret, so a reload cannot put
      // an already-issued code back on screen.
      if (resuming.current) {
        resuming.current = false
        setPhase({
          status: 'code-unavailable',
          enrollmentId: status.id,
          expiresAt: status.expiresAt,
        })
      }
      schedule(delay.current)
    },
    [schedule, settle],
  )

  const handlePollFailure = useCallback(
    (cause: unknown) => {
      const error = asWorkspaceError(cause)

      if (error.kind === 'not_found') {
        settle({ status: 'expired' })
        return
      }
      if (error.kind === 'unauthenticated') {
        settle({ status: 'failed', error })
        return
      }
      if (error.kind === 'rate_limited') {
        const after = (isEnrollmentError(error) ? error.retryAfterSeconds : null) ?? 60
        delay.current = Math.min(Math.max(after * 1000, delay.current * 2), MAX_DELAY)
        setNotice({ kind: 'rate-limited', message: 'Checking less often for a moment.' })
        schedule(delay.current)
        return
      }

      failureStreak.current += 1
      if (failureStreak.current >= MAX_POLL_FAILURES) {
        settle({ status: 'failed', error })
        return
      }
      delay.current = Math.min(delay.current * 2, MAX_DELAY)
      setNotice({
        kind: 'poll-unavailable',
        message: 'We cannot reach the service. Still trying.',
      })
      schedule(delay.current)
    },
    [schedule, settle],
  )

  const poll = useCallback(async () => {
    const current = target.current
    if (!current || inFlight.current) return

    if (Date.parse(current.expiresAt) <= Date.now()) {
      settle({ status: 'expired' })
      return
    }

    const thisRequest = ++requestId.current
    inFlight.current = true
    try {
      const status = await getEnrollment(current.enrollmentId)
      if (requestId.current !== thisRequest) return
      failureStreak.current = 0
      delay.current = BASE_DELAY
      // A resync after a stale code must not erase the reason for it.
      setNotice((current) => (current?.kind === 'stale-code' ? current : null))
      applyStatus(status)
    } catch (cause) {
      if (requestId.current !== thisRequest) return
      handlePollFailure(cause)
    } finally {
      inFlight.current = false
    }
  }, [applyStatus, handlePollFailure, settle])

  pollRef.current = poll

  const issue = useCallback(async () => {
    if (!recipient) return
    requestId.current += 1
    stopPolling()
    delay.current = BASE_DELAY
    failureStreak.current = 0
    resuming.current = false
    lastCode.current = null
    setNotice(null)
    setPhase({ status: 'issuing' })

    try {
      const issued = await issueEnrollment(recipient.id)
      target.current = { enrollmentId: issued.id, expiresAt: issued.expiresAt }
      setPhase({
        status: 'showing-code',
        enrollmentId: issued.id,
        payload: issued.payload,
        expiresAt: issued.expiresAt,
      })
      setAnnouncement('Waiting for the device to scan the code.')
      schedule(delay.current)
    } catch (cause) {
      setPhase({ status: 'failed', error: asWorkspaceError(cause) })
    }
  }, [recipient, schedule, stopPolling])

  const approve = useCallback(async () => {
    if (phase.status !== 'awaiting-confirmation') return
    const { enrollmentId, matchingCode, expiresAt } = phase
    requestId.current += 1
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    pollTimer.current = null
    setPhase({ status: 'approving', enrollmentId, matchingCode, expiresAt })

    try {
      await approveEnrollment(enrollmentId, matchingCode)
      settle({ status: 'approved', enrollmentId }, 'The device is enrolled.')
    } catch (cause) {
      const error = asWorkspaceError(cause)

      if (error.kind === 'gone') {
        settle({ status: 'expired' })
        return
      }
      if (error.kind === 'conflict') {
        // The code on screen is stale, so resync rather than lose the panel.
        setPhase({ status: 'awaiting-confirmation', enrollmentId, matchingCode, expiresAt })
        setNotice({ kind: 'stale-code', message: error.message })
        target.current = { enrollmentId, expiresAt }
        void pollRef.current()
        return
      }
      settle({ status: 'failed', error })
    }
  }, [phase, settle])

  const cancel = useCallback(async () => {
    const enrollmentId =
      'enrollmentId' in phase ? phase.enrollmentId : (target.current?.enrollmentId ?? null)
    requestId.current += 1
    stopPolling()

    if (!enrollmentId) {
      setPhase({ status: 'idle' })
      return
    }

    try {
      await cancelEnrollment(enrollmentId)
      settle({ status: 'cancelled' }, 'Enrollment cancelled.')
    } catch (cause) {
      setPhase({ status: 'failed', error: asWorkspaceError(cause) })
    }
  }, [phase, settle, stopPolling])

  const dismiss = useCallback(() => {
    setPhase({ status: 'idle' })
    setNotice(null)
    setSecondsRemaining(null)
  }, [])

  // A caretaker who reloads mid-enrollment rejoins the one already open. An
  // enrollment this panel is already running is not one to rejoin: issuing one
  // makes it the recipient's pending enrollment, and rejoining it would drop
  // the code that only the issue response could show.
  const pendingEnrollmentId = recipient?.pendingEnrollmentId ?? null
  useEffect(() => {
    if (!pendingEnrollmentId) return
    if (phaseRef.current.status !== 'idle') return
    if (target.current?.enrollmentId === pendingEnrollmentId) return
    resuming.current = true
    target.current = {
      enrollmentId: pendingEnrollmentId,
      expiresAt: new Date(Date.now() + BASE_DELAY).toISOString(),
    }
    setPhase({ status: 'resuming', enrollmentId: pendingEnrollmentId })
    void pollRef.current()
  }, [pendingEnrollmentId])

  const deadline = deadlineOf(phase)
  useEffect(() => {
    if (!deadline) {
      setSecondsRemaining(null)
      return
    }

    const read = () => Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000))
    setSecondsRemaining(read())
    const tick = window.setInterval(() => setSecondsRemaining(read()), 1000)
    return () => window.clearInterval(tick)
  }, [deadline])

  useEffect(() => {
    if (!announcement) return
    const timeout = window.setTimeout(() => setAnnouncement(''), 4000)
    return () => window.clearTimeout(timeout)
  }, [announcement])

  useEffect(
    () => () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
      requestId.current += 1
    },
    [],
  )

  return { phase, notice, secondsRemaining, announcement, issue, approve, cancel, dismiss }
}
