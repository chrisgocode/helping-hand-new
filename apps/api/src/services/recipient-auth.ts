import { type AuthBindings, createAuth } from '../auth'

/**
 * Reserved domain for the internal compatibility address Better Auth requires
 * on every user. Recipients never receive mail and the address is never
 * returned by the API.
 */
const RECIPIENT_EMAIL_DOMAIN = 'recipient.invalid'
const RECIPIENT_SESSION_EXPIRES_AT = new Date('9999-12-31T23:59:59.999Z')

/**
 * A Better Auth session record. Distinct from the schema-level
 * `RecipientSession`, which is the credential payload delivered to a device.
 */
export type AuthSession = {
  id: string
  token: string
  expiresAt: string
}

/**
 * The seam between the recipient/enrollment services and Better Auth. It keeps
 * credential-free user creation and session issuance in one place so the
 * services never depend on the authentication library directly.
 */
export type RecipientAuth = {
  createRecipientUser(displayName: string): Promise<string>
  deleteUser(userId: string): Promise<void>
  createSession(userId: string): Promise<AuthSession>
}

export function createRecipientAuth(env: AuthBindings): RecipientAuth {
  // Built on first use: most requests that construct a RecipientService never
  // reach Better Auth, and constructing it is not free.
  let context: ReturnType<typeof createAuth>['$context'] | undefined
  const authContext = () => {
    context ??= createAuth(env).$context
    return context
  }

  return {
    async createRecipientUser(displayName) {
      const { internalAdapter } = await authContext()
      const id = crypto.randomUUID()
      const user = await internalAdapter.createUser(
        {
          id,
          name: displayName,
          email: `${id}@${RECIPIENT_EMAIL_DOMAIN}`,
          emailVerified: false,
          accountKind: 'recipient',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { method: 'recipient-enrollment' },
      )
      if (!user) throw new Error('Recipient identity could not be created')
      return user.id
    },

    async deleteUser(userId) {
      const { internalAdapter } = await authContext()
      await internalAdapter.deleteUser(userId)
    },

    async createSession(userId) {
      const { internalAdapter } = await authContext()
      const session = await internalAdapter.createSession(
        userId,
        false,
        { expiresAt: RECIPIENT_SESSION_EXPIRES_AT },
        true,
      )
      if (!session) throw new Error('Recipient session could not be created')
      return {
        id: session.id,
        token: session.token,
        expiresAt: new Date(session.expiresAt).toISOString(),
      }
    },
  }
}
