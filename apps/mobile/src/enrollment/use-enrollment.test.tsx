import type { RecipientSession } from '@helping-hand/schemas'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { EnrollmentApiError } from './enrollment-api'
import { createEnrollmentStorage, type SecureKeyValueAdapter } from './enrollment-storage'
import { type EnrollmentApi, useEnrollment } from './use-enrollment'

const SESSION_KEY = 'recipient-session'
const PENDING_KEY = 'pending-enrollment'

const NOW = '2026-09-09T12:00:00.000Z'
const LATER = '2026-09-09T12:10:00.000Z'
const enrollmentId = '44444444-4444-4444-8444-444444444444'
const recipientId = '11111111-1111-4111-8111-111111111111'
const secret = 'a'.repeat(43)
const claimantSecret = 'b'.repeat(43)
const payload = { version: 1 as const, enrollmentId, secret }
const qrCode = JSON.stringify(payload)

const claim = {
  enrollmentId,
  matchingCode: 'ABC234',
  expiresAt: LATER,
  pollIntervalSeconds: 3,
}

const session: RecipientSession = {
  token: 'session-token',
  tokenType: 'Bearer',
  expiresAt: LATER,
  recipient: { id: recipientId, displayName: 'Alex' },
}

const identity = { recipientId, displayName: 'Alex' }

const pendingRecord = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    payload,
    claimantSecret,
    matchingCode: null,
    pollIntervalSeconds: 3,
    claimExpiresAt: null,
    ...overrides,
  })

const claimedRecord = () =>
  pendingRecord({ matchingCode: claim.matchingCode, claimExpiresAt: LATER })

type MemoryAdapter = SecureKeyValueAdapter & {
  entries: Map<string, string>
  /** Keys whose write or delete should fail, standing in for a storage fault. */
  rejectWrites: Set<string>
  rejectDeletes: Set<string>
  dropWrites: Set<string>
  markInstallationHandled: ReturnType<typeof vi.fn>
}

function createMemoryAdapter(
  initial: Record<string, string> = {},
  installation: 'fresh' | 'existing' = 'existing',
): MemoryAdapter {
  const entries = new Map(Object.entries(initial))
  const rejectWrites = new Set<string>()
  const rejectDeletes = new Set<string>()
  const dropWrites = new Set<string>()
  let marked = installation === 'existing'

  return {
    entries,
    rejectWrites,
    rejectDeletes,
    dropWrites,
    getItem: async (key) => entries.get(key) ?? null,
    setItem: async (key, value) => {
      if (rejectWrites.has(key)) throw new Error(`storage rejected ${key}`)
      // A write that silently does not stick: what the read-back check exists for.
      if (!dropWrites.has(key)) entries.set(key, value)
    },
    deleteItem: async (key) => {
      if (rejectDeletes.has(key)) throw new Error(`storage kept ${key}`)
      entries.delete(key)
    },
    isFreshInstallation: async () => !marked,
    markInstallationHandled: vi.fn(async () => {
      marked = true
    }),
  }
}

const createApi = (): { [K in keyof EnrollmentApi]: ReturnType<typeof vi.fn> } => ({
  claimEnrollment: vi.fn(async () => claim),
  collectEnrollmentSession: vi.fn(async () => ({
    state: 'claimed' as const,
    pollIntervalSeconds: 3,
  })),
  getRecipientIdentity: vi.fn(async () => identity),
  signOutRecipient: vi.fn(async () => undefined),
})

/** Advances the clock and lets every promise the tick started settle. */
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

async function render(adapter: MemoryAdapter, api: ReturnType<typeof createApi>) {
  // Rebuilding these per render would restart recovery, as it would in the app.
  const dependencies = {
    storage: createEnrollmentStorage(adapter),
    api: api as unknown as EnrollmentApi,
    createClaimantSecret: async () => claimantSecret,
  }
  const view = renderHook(() => useEnrollment(dependencies))
  await act(async () => {})
  return view
}

describe('useEnrollment', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  describe('persistence ordering', () => {
    test('the claimant secret is durable before the claim is sent', async () => {
      const adapter = createMemoryAdapter()
      const api = createApi()
      let storedWhenClaimed: string | null = null
      api.claimEnrollment.mockImplementation(async () => {
        storedWhenClaimed = adapter.entries.get(PENDING_KEY) ?? null
        return claim
      })

      const view = await render(adapter, api)
      await act(() => view.result.current.scan(qrCode))

      expect(storedWhenClaimed).not.toBeNull()
      expect(JSON.parse(storedWhenClaimed ?? '{}')).toMatchObject({ claimantSecret })
      expect(view.result.current.state).toMatchObject({ status: 'pending' })
    })

    test('a claim response is persisted with its real expiry', async () => {
      const adapter = createMemoryAdapter()
      const view = await render(adapter, createApi())

      await act(() => view.result.current.scan(qrCode))

      expect(JSON.parse(adapter.entries.get(PENDING_KEY) ?? '{}')).toMatchObject({
        matchingCode: claim.matchingCode,
        claimExpiresAt: LATER,
      })
    })

    test('a scan whose record cannot be stored asks for another scan', async () => {
      const adapter = createMemoryAdapter()
      adapter.rejectWrites.add(PENDING_KEY)
      const api = createApi()
      const view = await render(adapter, api)

      await act(() => view.result.current.scan(qrCode))

      expect(api.claimEnrollment).not.toHaveBeenCalled()
      expect(view.result.current.state).toMatchObject({
        status: 'scanning',
        error: 'The enrollment could not be saved securely. Try scanning the code again.',
      })
      // The lock has to be released or the retry is silently ignored.
      await act(() => view.result.current.scan(qrCode))
      expect(view.result.current.state).toMatchObject({ status: 'scanning' })
    })
  })

  describe('recovery', () => {
    test('a stored session is validated on launch', async () => {
      const adapter = createMemoryAdapter({ [SESSION_KEY]: JSON.stringify(session) })
      const view = await render(adapter, createApi())

      expect(view.result.current.state).toMatchObject({ status: 'authenticated' })
    })

    test('a session stored beside a pending record retires the spent attempt', async () => {
      const adapter = createMemoryAdapter({
        [SESSION_KEY]: JSON.stringify(session),
        [PENDING_KEY]: claimedRecord(),
      })

      const view = await render(adapter, createApi())

      expect(view.result.current.state).toMatchObject({ status: 'authenticated' })
      expect(adapter.entries.has(PENDING_KEY)).toBe(false)
    })

    test('the spent attempt is retired even when the server cannot be reached', async () => {
      const adapter = createMemoryAdapter({
        [SESSION_KEY]: JSON.stringify(session),
        [PENDING_KEY]: claimedRecord(),
      })
      const api = createApi()
      api.getRecipientIdentity.mockRejectedValue(new Error('offline'))

      const view = await render(adapter, api)

      // An offline launch must not be what keeps a spent secret on disk.
      expect(view.result.current.state).toMatchObject({ status: 'validation-failed' })
      expect(adapter.entries.has(PENDING_KEY)).toBe(false)
    })

    test('an undeletable pending record does not undo an activated session', async () => {
      const adapter = createMemoryAdapter({ [PENDING_KEY]: claimedRecord() })
      adapter.rejectDeletes.add(PENDING_KEY)
      const api = createApi()
      api.collectEnrollmentSession.mockResolvedValue(session)

      const view = await render(adapter, api)
      await advance(3000)

      expect(view.result.current.state).toMatchObject({ status: 'authenticated' })
      expect(adapter.entries.get(SESSION_KEY)).toBe(JSON.stringify(session))
    })

    test('a session that does not stick leaves the attempt recoverable', async () => {
      const adapter = createMemoryAdapter({ [PENDING_KEY]: claimedRecord() })
      adapter.dropWrites.add(SESSION_KEY)
      const api = createApi()
      api.collectEnrollmentSession.mockResolvedValue(session)

      const view = await render(adapter, api)
      await advance(3000)

      expect(view.result.current.state).toMatchObject({ status: 'pending' })
      expect(adapter.entries.has(PENDING_KEY)).toBe(true)
    })

    test('an unclaimed record is claimed again on launch', async () => {
      const adapter = createMemoryAdapter({ [PENDING_KEY]: pendingRecord() })
      const api = createApi()

      const view = await render(adapter, api)

      expect(api.claimEnrollment).toHaveBeenCalledTimes(1)
      expect(view.result.current.state).toMatchObject({
        status: 'pending',
        pending: { matchingCode: claim.matchingCode },
      })
    })

    test('a claimed record resumes polling without claiming again', async () => {
      const adapter = createMemoryAdapter({ [PENDING_KEY]: claimedRecord() })
      const api = createApi()

      const view = await render(adapter, api)
      await advance(3000)

      expect(api.claimEnrollment).not.toHaveBeenCalled()
      expect(api.collectEnrollmentSession).toHaveBeenCalledTimes(1)
      expect(view.result.current.state).toMatchObject({ status: 'pending' })
    })

    test('a record past its claim window is discarded', async () => {
      const adapter = createMemoryAdapter({
        [PENDING_KEY]: pendingRecord({
          matchingCode: claim.matchingCode,
          claimExpiresAt: '2020-01-01T00:00:00.000Z',
        }),
      })
      const api = createApi()

      const view = await render(adapter, api)

      expect(view.result.current.state).toMatchObject({ status: 'welcome', pending: null })
      expect(adapter.entries.has(PENDING_KEY)).toBe(false)
      expect(api.collectEnrollmentSession).not.toHaveBeenCalled()
    })

    test('a fresh installation wipes credentials it did not write', async () => {
      const adapter = createMemoryAdapter(
        { [SESSION_KEY]: JSON.stringify(session), [PENDING_KEY]: claimedRecord() },
        'fresh',
      )
      const api = createApi()

      const view = await render(adapter, api)

      expect(view.result.current.state).toMatchObject({ status: 'welcome', pending: null })
      expect(adapter.entries.size).toBe(0)
      expect(api.getRecipientIdentity).not.toHaveBeenCalled()
      expect(adapter.markInstallationHandled).toHaveBeenCalledTimes(1)
    })

    test('a wipe that fails leaves the installation unmarked, and retries next launch', async () => {
      const adapter = createMemoryAdapter(
        { [SESSION_KEY]: JSON.stringify(session), [PENDING_KEY]: claimedRecord() },
        'fresh',
      )
      adapter.rejectDeletes.add(SESSION_KEY)

      const firstLaunch = await render(adapter, createApi())

      // Marking here would trust the credential that outlived the wipe.
      expect(adapter.markInstallationHandled).not.toHaveBeenCalled()
      expect(firstLaunch.result.current.state).toMatchObject({ status: 'terminal' })
      cleanup()

      adapter.rejectDeletes.clear()
      const api = createApi()
      const secondLaunch = await render(adapter, api)

      expect(secondLaunch.result.current.state).toMatchObject({ status: 'welcome', pending: null })
      expect(adapter.entries.size).toBe(0)
      expect(api.getRecipientIdentity).not.toHaveBeenCalled()
    })
  })

  describe('polling', () => {
    test('delivery ends the wait and stores the credential', async () => {
      const adapter = createMemoryAdapter({ [PENDING_KEY]: claimedRecord() })
      const api = createApi()
      api.collectEnrollmentSession
        .mockResolvedValueOnce({ state: 'claimed', pollIntervalSeconds: 3 })
        .mockResolvedValueOnce(session)

      const view = await render(adapter, api)
      await advance(3000)
      await advance(3000)

      expect(view.result.current.state).toMatchObject({ status: 'authenticated' })
      expect(adapter.entries.has(PENDING_KEY)).toBe(false)
      expect(adapter.entries.get(SESSION_KEY)).toBe(JSON.stringify(session))
    })

    test('transient failures back off exponentially up to thirty seconds', async () => {
      const adapter = createMemoryAdapter({ [PENDING_KEY]: claimedRecord() })
      const api = createApi()
      api.collectEnrollmentSession.mockRejectedValue(new EnrollmentApiError(503, 'unavailable'))

      const view = await render(adapter, api)

      for (const [attempt, delay] of [3, 6, 12, 24, 30, 30].entries()) {
        await advance(delay * 1000 - 1)
        expect(api.collectEnrollmentSession).toHaveBeenCalledTimes(attempt)
        await advance(1)
        expect(api.collectEnrollmentSession).toHaveBeenCalledTimes(attempt + 1)
      }
      expect(view.result.current.state).toMatchObject({ status: 'pending', manualRetry: false })
    })

    test('a retry-after replaces the backoff', async () => {
      const adapter = createMemoryAdapter({ [PENDING_KEY]: claimedRecord() })
      const api = createApi()
      api.collectEnrollmentSession.mockRejectedValueOnce(
        new EnrollmentApiError(429, 'slow down', 7),
      )

      const view = await render(adapter, api)
      await advance(3000)
      expect(view.result.current.state).toMatchObject({ retryAfterSeconds: 7 })

      await advance(6999)
      expect(api.collectEnrollmentSession).toHaveBeenCalledTimes(1)
      await advance(1)
      expect(api.collectEnrollmentSession).toHaveBeenCalledTimes(2)
    })
  })

  describe('terminal responses', () => {
    test.each([400, 404, 409, 410])('%i ends the attempt and clears the record', async (status) => {
      const adapter = createMemoryAdapter({ [PENDING_KEY]: claimedRecord() })
      const api = createApi()
      api.collectEnrollmentSession.mockRejectedValue(new EnrollmentApiError(status, 'no'))

      const view = await render(adapter, api)
      await advance(3000)

      expect(view.result.current.state).toMatchObject({ status: 'terminal', message: 'no' })
      expect(adapter.entries.has(PENDING_KEY)).toBe(false)
    })

    test('a terminal response ends the attempt even when the record cannot be deleted', async () => {
      const adapter = createMemoryAdapter({ [PENDING_KEY]: claimedRecord() })
      adapter.rejectDeletes.add(PENDING_KEY)
      adapter.rejectDeletes.add(SESSION_KEY)
      const api = createApi()
      api.collectEnrollmentSession.mockRejectedValue(new EnrollmentApiError(410, 'gone'))

      const view = await render(adapter, api)
      await advance(3000)

      // Polling has stopped, so a screen left in `pending` would be a dead end.
      expect(view.result.current.state).toMatchObject({ status: 'terminal', message: 'gone' })
    })

    test('a server fault never ends the attempt', async () => {
      const adapter = createMemoryAdapter({ [PENDING_KEY]: claimedRecord() })
      const api = createApi()
      api.collectEnrollmentSession.mockRejectedValue(new EnrollmentApiError(500, 'boom'))

      const view = await render(adapter, api)
      await advance(3000)

      expect(view.result.current.state).toMatchObject({ status: 'pending', error: 'boom' })
      expect(adapter.entries.has(PENDING_KEY)).toBe(true)
    })

    test('a rejected claim clears the record it cannot repair', async () => {
      const adapter = createMemoryAdapter()
      const api = createApi()
      api.claimEnrollment.mockRejectedValue(new EnrollmentApiError(400, 'invalid payload'))

      const view = await render(adapter, api)
      await act(() => view.result.current.scan(qrCode))

      expect(view.result.current.state).toMatchObject({ status: 'terminal' })
      expect(adapter.entries.size).toBe(0)
    })
  })

  describe('credential lifecycle', () => {
    test('a rejected credential is discarded', async () => {
      const adapter = createMemoryAdapter({ [SESSION_KEY]: JSON.stringify(session) })
      const api = createApi()
      api.getRecipientIdentity.mockRejectedValue(new EnrollmentApiError(401, 'no longer enrolled'))

      const view = await render(adapter, api)

      expect(view.result.current.state).toMatchObject({ status: 'welcome', pending: null })
      expect(adapter.entries.size).toBe(0)
    })

    test('an unreachable server keeps the credential for a retry', async () => {
      const adapter = createMemoryAdapter({ [SESSION_KEY]: JSON.stringify(session) })
      const api = createApi()
      api.getRecipientIdentity.mockRejectedValueOnce(new Error('offline'))

      const view = await render(adapter, api)
      expect(view.result.current.state).toMatchObject({ status: 'validation-failed' })
      expect(adapter.entries.has(SESSION_KEY)).toBe(true)

      await act(async () => {
        view.result.current.retryValidation()
      })
      expect(view.result.current.state).toMatchObject({ status: 'authenticated' })
    })

    test('signing out with an already invalid token still clears storage', async () => {
      const adapter = createMemoryAdapter({ [SESSION_KEY]: JSON.stringify(session) })
      const api = createApi()
      api.signOutRecipient.mockRejectedValue(new EnrollmentApiError(401, 'gone'))

      const view = await render(adapter, api)
      await act(() => view.result.current.removeEnrollment())

      expect(view.result.current.state).toMatchObject({ status: 'welcome' })
      expect(adapter.entries.size).toBe(0)
    })

    test('an already invalid token is discarded even when the delete fails', async () => {
      const adapter = createMemoryAdapter({ [SESSION_KEY]: JSON.stringify(session) })
      adapter.rejectDeletes.add(SESSION_KEY)
      const api = createApi()
      api.signOutRecipient.mockRejectedValue(new EnrollmentApiError(401, 'gone'))

      const view = await render(adapter, api)
      await act(() => view.result.current.removeEnrollment())

      // The token is dead server-side, so the screen must not stay in `removing`.
      expect(view.result.current.state).toMatchObject({ status: 'welcome' })
    })

    test('a failed sign-out keeps the device enrolled', async () => {
      const adapter = createMemoryAdapter({ [SESSION_KEY]: JSON.stringify(session) })
      const api = createApi()
      api.signOutRecipient.mockRejectedValue(new EnrollmentApiError(500, 'boom'))

      const view = await render(adapter, api)
      await act(() => view.result.current.removeEnrollment())

      expect(view.result.current.state).toMatchObject({
        status: 'authenticated',
        error: 'boom',
        removing: false,
      })
      expect(adapter.entries.has(SESSION_KEY)).toBe(true)
    })
  })
})
