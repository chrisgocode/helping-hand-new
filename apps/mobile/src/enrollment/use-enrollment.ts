import {
  ENROLLMENT_TIMINGS,
  type EnrollmentClaim,
  type RecipientSession,
} from '@helping-hand/schemas'
import { useCallback, useEffect, useRef, useState } from 'react'
import { EnrollmentApiError } from './enrollment-api'
import { parseEnrollmentPayload } from './enrollment-payload'
import type { EnrollmentStorage, PendingEnrollment } from './enrollment-storage'

type RecipientIdentity = { recipientId: string; displayName: string }

/** The enrollment requests the hook makes, as a seam tests can stand in for. */
export type EnrollmentApi = {
  claimEnrollment(
    payload: PendingEnrollment['payload'],
    claimantSecret: string,
  ): Promise<EnrollmentClaim>
  collectEnrollmentSession(
    enrollmentId: string,
    claimantSecret: string,
  ): Promise<RecipientSession | { state: 'claimed'; pollIntervalSeconds: number }>
  getRecipientIdentity(token: string): Promise<RecipientIdentity>
  signOutRecipient(token: string): Promise<void>
}

export type EnrollmentDependencies = {
  storage: EnrollmentStorage
  api: EnrollmentApi
  createClaimantSecret(): Promise<string>
}

type ViewState =
  | { status: 'loading' }
  | { status: 'welcome'; pending: PendingEnrollment | null }
  | { status: 'scanning'; error: string | null }
  | { status: 'claiming' }
  | {
      status: 'pending'
      pending: PendingEnrollment
      error: string | null
      failures: number
      polling: boolean
      manualRetry: boolean
      retryAfterSeconds: number | null
    }
  | { status: 'validating'; session: RecipientSession }
  | { status: 'validation-failed'; session: RecipientSession; error: string }
  | {
      status: 'authenticated'
      session: RecipientSession
      error: string | null
      removing: boolean
    }
  | { status: 'terminal'; message: string }

type PendingState = Extract<ViewState, { status: 'pending' }>

const requestMessage = (error: unknown) =>
  error instanceof EnrollmentApiError
    ? error.message
    : 'Helping Hand could not connect. Check your connection and try again.'

const retryAfterOf = (error: unknown) =>
  error instanceof EnrollmentApiError ? error.retryAfterSeconds : null

/** One place for the waiting-for-approval invariant. */
const pendingState = (
  pending: PendingEnrollment,
  overrides: Partial<Omit<PendingState, 'status' | 'pending'>> = {},
): PendingState => ({
  status: 'pending',
  pending,
  error: null,
  failures: 0,
  polling: false,
  manualRetry: false,
  retryAfterSeconds: null,
  ...overrides,
})

export function useEnrollment({ storage, api, createClaimantSecret }: EnrollmentDependencies) {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const scanLocked = useRef(false)

  const validateSession = useCallback(
    async (session: RecipientSession) => {
      setState({ status: 'validating', session })
      try {
        const identity = await api.getRecipientIdentity(session.token)
        const current = {
          ...session,
          recipient: {
            id: identity.recipientId,
            displayName: identity.displayName,
          },
        }
        await storage.activateSession(current)
        setState({
          status: 'authenticated',
          session: current,
          error: null,
          removing: false,
        })
      } catch (error) {
        if (error instanceof EnrollmentApiError && error.status === 401) {
          await storage.clearEnrollment()
          setState({ status: 'welcome', pending: null })
          return
        }
        setState({
          status: 'validation-failed',
          session,
          error: requestMessage(error),
        })
      }
    },
    [api, storage],
  )

  const runClaim = useCallback(
    async (pending: PendingEnrollment) => {
      setState({ status: 'claiming' })
      try {
        const claim = await api.claimEnrollment(pending.payload, pending.claimantSecret)
        const claimed: PendingEnrollment = {
          ...pending,
          matchingCode: claim.matchingCode,
          pollIntervalSeconds: claim.pollIntervalSeconds,
          claimExpiresAt: claim.expiresAt,
        }
        await storage.recordClaim(claimed)
        setState(pendingState(claimed))
      } catch (error) {
        if (error instanceof EnrollmentApiError && error.terminal) {
          await storage.clearEnrollment()
          setState({ status: 'terminal', message: error.message })
          return
        }
        setState(
          pendingState(pending, {
            error: requestMessage(error),
            failures: 1,
            retryAfterSeconds: retryAfterOf(error),
          }),
        )
      }
    },
    [api, storage],
  )

  useEffect(() => {
    void (async () => {
      try {
        const restored = await storage.restore()
        if (restored.status === 'active') await validateSession(restored.session)
        else if (restored.status === 'none') setState({ status: 'welcome', pending: null })
        else if (restored.pending.matchingCode) setState(pendingState(restored.pending))
        else await runClaim(restored.pending)
      } catch (error) {
        setState({ status: 'terminal', message: requestMessage(error) })
      }
    })()
  }, [runClaim, storage, validateSession])

  const collect = useCallback(
    async (pending: PendingEnrollment, failures: number) => {
      setState((current) =>
        current.status === 'pending' ? { ...current, polling: true } : current,
      )
      try {
        const result = await api.collectEnrollmentSession(
          pending.payload.enrollmentId,
          pending.claimantSecret,
        )
        if ('state' in result) {
          const next = {
            ...pending,
            pollIntervalSeconds: result.pollIntervalSeconds,
          }
          await storage.recordClaim(next)
          setState(pendingState(next))
          return
        }

        await storage.activateSession(result)
        await validateSession(result)
      } catch (error) {
        if (error instanceof EnrollmentApiError && error.terminal) {
          await storage.clearEnrollment()
          setState({ status: 'terminal', message: error.message })
          return
        }
        setState(
          pendingState(pending, {
            error: requestMessage(error),
            failures: failures + 1,
            retryAfterSeconds: retryAfterOf(error),
          }),
        )
      }
    },
    [api, storage, validateSession],
  )

  useEffect(() => {
    if (
      state.status !== 'pending' ||
      !state.pending.matchingCode ||
      state.polling ||
      state.manualRetry
    )
      return
    const backoff = Math.min(state.pending.pollIntervalSeconds * 2 ** state.failures, 30)
    const delay = state.retryAfterSeconds ?? backoff
    const timeout = setTimeout(() => void collect(state.pending, state.failures), delay * 1000)
    return () => clearTimeout(timeout)
  }, [collect, state])

  const scan = useCallback(
    async (value: string) => {
      if (scanLocked.current) return
      scanLocked.current = true
      const payload = parseEnrollmentPayload(value)
      if (!payload) {
        scanLocked.current = false
        setState({
          status: 'scanning',
          error: 'That is not a valid Helping Hand code.',
        })
        return
      }
      setState({ status: 'claiming' })
      try {
        // The secret has to outlive a lost claim response, so it is stored first.
        const pending: PendingEnrollment = {
          payload,
          claimantSecret: await createClaimantSecret(),
          matchingCode: null,
          pollIntervalSeconds: ENROLLMENT_TIMINGS.pollIntervalSeconds,
          claimExpiresAt: null,
        }
        await storage.beginEnrollment(pending)
        await runClaim(pending)
      } catch {
        scanLocked.current = false
        setState({
          status: 'scanning',
          error: 'The enrollment could not be saved securely. Try scanning the code again.',
        })
      }
    },
    [createClaimantSecret, runClaim, storage],
  )

  const retryPending = useCallback(() => {
    if (state.status !== 'pending' || state.polling) return
    if (state.pending.matchingCode) void collect(state.pending, state.failures)
    else void runClaim(state.pending)
  }, [collect, runClaim, state])

  const removeEnrollment = useCallback(async () => {
    if (state.status !== 'authenticated' || state.removing) return
    setState({ ...state, error: null, removing: true })
    try {
      await api.signOutRecipient(state.session.token)
      await storage.clearEnrollment()
      setState({ status: 'welcome', pending: null })
    } catch (error) {
      if (error instanceof EnrollmentApiError && error.status === 401) {
        await storage.clearEnrollment()
        setState({ status: 'welcome', pending: null })
        return
      }
      setState({ ...state, error: requestMessage(error), removing: false })
    }
  }, [api, state, storage])

  const startScanning = useCallback(() => {
    scanLocked.current = false
    setState({ status: 'scanning', error: null })
  }, [])

  return {
    state,
    startScanning,
    stopScanning: () => setState({ status: 'welcome', pending: null }),
    scan,
    leaveSetup: () =>
      state.status === 'pending' && setState({ status: 'welcome', pending: state.pending }),
    resumeSetup: () =>
      state.status === 'welcome' && state.pending && setState(pendingState(state.pending)),
    retryPending,
    retryValidation: () =>
      state.status === 'validation-failed' && void validateSession(state.session),
    scanAgain: startScanning,
    removeEnrollment,
  }
}

export type EnrollmentViewState = ViewState
