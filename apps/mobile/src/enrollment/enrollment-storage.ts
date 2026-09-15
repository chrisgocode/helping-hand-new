import {
  type PersistedEnrollment,
  persistedEnrollmentSchema,
  type RecipientSession,
  recipientSessionSchema,
} from '@helping-hand/schemas'

const SESSION_KEY = 'recipient-session'
const PENDING_KEY = 'pending-enrollment'

export type PendingEnrollment = PersistedEnrollment

/**
 * `isFreshInstallation` reports whether the store may have outlived the
 * installation that wrote it: a restored keychain can hand a fresh install
 * someone else's credential. It must not record the answer; marking is separate
 * so it can wait until the stale credential is really gone.
 */
export type SecureKeyValueAdapter = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  deleteItem(key: string): Promise<void>
  isFreshInstallation(): Promise<boolean>
  markInstallationHandled(): Promise<void>
}

/** What a launching app has on disk, after any partial write is reconciled. */
export type RestoredEnrollment =
  | { status: 'active'; session: RecipientSession }
  | { status: 'pending'; pending: PendingEnrollment }
  | { status: 'none' }

export type EnrollmentStorage = {
  restore(): Promise<RestoredEnrollment>
  beginEnrollment(pending: PendingEnrollment): Promise<void>
  recordClaim(pending: PendingEnrollment): Promise<void>
  activateSession(session: RecipientSession): Promise<void>
  clearEnrollment(): Promise<void>
}

/**
 * Owns the ordering-sensitive parts of enrollment persistence, so callers never
 * see the two keys or the order they have to be written in.
 */
export function createEnrollmentStorage(adapter: SecureKeyValueAdapter): EnrollmentStorage {
  const readSession = async () => {
    const stored = await adapter.getItem(SESSION_KEY)
    if (!stored) return null
    try {
      const parsed = recipientSessionSchema.safeParse(JSON.parse(stored))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  const readPending = async () => {
    const stored = await adapter.getItem(PENDING_KEY)
    if (!stored) return null
    try {
      const parsed = persistedEnrollmentSchema.safeParse(JSON.parse(stored))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  /** A write nobody can trust is worse than a failed one, so it is read back. */
  const writePending = async (pending: PendingEnrollment) => {
    await adapter.setItem(PENDING_KEY, JSON.stringify(pending))
    const saved = await readPending()
    if (saved?.claimantSecret !== pending.claimantSecret) {
      throw new Error('The enrollment could not be stored securely')
    }
  }

  const dropPending = () => adapter.deleteItem(PENDING_KEY)

  return {
    async restore() {
      if (await adapter.isFreshInstallation()) {
        // Marking before the wipe lands would trust whatever survived it.
        await Promise.all([adapter.deleteItem(SESSION_KEY), dropPending()])
        await adapter.markInstallationHandled()
        return { status: 'none' }
      }

      const session = await readSession()
      if (session) {
        // A pending record surviving alongside a credential means an interrupted
        // transition: the attempt that produced the credential is spent.
        await dropPending().catch(() => {})
        return { status: 'active', session }
      }

      const pending = await readPending()
      if (!pending) return { status: 'none' }
      if (pending.claimExpiresAt && pending.claimExpiresAt <= new Date().toISOString()) {
        await dropPending()
        return { status: 'none' }
      }
      return { status: 'pending', pending }
    },

    beginEnrollment: writePending,
    recordClaim: writePending,

    /**
     * Succeeds once the credential is durable. Retiring the spent attempt is
     * best effort because `restore` reconciles it, while failing here would send
     * a caller holding a valid credential back to a retry screen.
     */
    async activateSession(session) {
      await adapter.setItem(SESSION_KEY, JSON.stringify(session))
      const saved = await readSession()
      if (saved?.token !== session.token) {
        throw new Error('Recipient credential could not be stored')
      }
      await dropPending().catch(() => {})
    },

    /**
     * Every caller is discarding a credential the server has already rejected,
     * so a key that survives is unusable and `restore` clears it next launch.
     * Rejecting here would strand a caller mid-transition.
     */
    async clearEnrollment() {
      await Promise.allSettled([adapter.deleteItem(SESSION_KEY), dropPending()])
    },
  }
}
