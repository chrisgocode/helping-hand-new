import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createAuth } from '../auth'
import { createTestDatabase } from '../test/database'
import { createRecipientAuth } from './recipient-auth'

describe('recipient authentication integration', () => {
  let miniflare: Awaited<ReturnType<typeof createTestDatabase>>['miniflare']
  let database: D1Database

  beforeEach(async () => {
    ;({ database, miniflare } = await createTestDatabase())
  })

  afterEach(async () => miniflare.dispose())

  const env = () => ({
    database,
    BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
    BETTER_AUTH_URL: 'http://localhost:8787',
    TRUSTED_ORIGIN: 'http://localhost:5173',
  })

  const bearerSession = (token: string) =>
    createAuth(env()).api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    })

  test('creates a credential-free recipient identity', async () => {
    const userId = await createRecipientAuth(env()).createRecipientUser('Alex')

    const user = await database
      .prepare('SELECT email, accountKind, emailVerified FROM "user" WHERE id = ?')
      .bind(userId)
      .first<{ email: string; accountKind: string; emailVerified: number }>()
    const accounts = await database
      .prepare('SELECT COUNT(*) AS total FROM account WHERE userId = ?')
      .bind(userId)
      .first<{ total: number }>()

    expect(user?.accountKind).toBe('recipient')
    expect(user?.email).toEndWith('@recipient.invalid')
    expect(user?.emailVerified).toBe(0)
    expect(accounts?.total).toBe(0)
  })

  test('authenticates a recipient session with a bearer token and revokes it', async () => {
    const auth = createRecipientAuth(env())
    const userId = await auth.createRecipientUser('Alex')
    const session = await auth.createSession(userId)

    const authenticated = await bearerSession(session.token)
    expect(authenticated?.user.id).toBe(userId)
    expect(authenticated?.session.id).toBe(session.id)
    expect(new Date(session.expiresAt).getUTCFullYear()).toBe(9999)

    // The same token can be presented again after a lost response.
    expect((await bearerSession(session.token))?.user.id).toBe(userId)

    await database.prepare('DELETE FROM session WHERE id = ?').bind(session.id).run()
    expect(await bearerSession(session.token)).toBeNull()
  })

  test('replaces a session without disturbing the recipient identity', async () => {
    const auth = createRecipientAuth(env())
    const userId = await auth.createRecipientUser('Alex')
    const previous = await auth.createSession(userId)
    const replacement = await auth.createSession(userId)

    await database
      .prepare('DELETE FROM session WHERE userId = ? AND id <> ?')
      .bind(userId, replacement.id)
      .run()

    expect(await bearerSession(previous.token)).toBeNull()
    expect((await bearerSession(replacement.token))?.session.id).toBe(replacement.id)
  })
})
