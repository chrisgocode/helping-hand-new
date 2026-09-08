import app from '../app'
import { generateSecret } from '../lib/secrets'

const allow = { limit: async () => ({ success: true }) }

export function testEnv(database: D1Database) {
  return {
    database,
    BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
    BETTER_AUTH_URL: 'http://localhost:8787',
    TRUSTED_ORIGIN: 'http://localhost:5173',
    OPENROUTER_API_KEY: 'test-key',
    MEMBER_API_RATE_LIMITER: allow,
    GUEST_API_RATE_LIMITER: allow,
    MEMBER_AI_RATE_LIMITER: allow,
    GUEST_AI_RATE_LIMITER: allow,
    ENROLLMENT_RATE_LIMITER: allow,
  }
}

type Env = ReturnType<typeof testEnv>

export function request(env: Env, path: string, method = 'GET', options: RequestInit = {}) {
  const { body, headers, ...rest } = options
  return app.request(
    path,
    {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(headers as Record<string, string> | undefined),
      },
      body,
      ...rest,
    },
    env,
  )
}

export function json(env: Env, path: string, method: string, body: unknown, headers = {}) {
  return request(env, path, method, { body: JSON.stringify(body), headers })
}

/** Signs up a caretaker and returns its session cookie. */
export async function signInCaretaker(env: Env, email = 'caretaker@example.com') {
  const response = await json(
    env,
    '/api/auth/sign-up/email',
    'POST',
    { name: 'Caretaker', email, password: 'test-password-123' },
    { origin: env.TRUSTED_ORIGIN },
  )
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('Expected an authentication cookie')
  return cookie
}

/** Saves a single-task root tree owned by the signed-in caretaker. */
export async function saveTaskTree(env: Env, cookie: string, id: string, title: string) {
  const response = await json(
    env,
    `/api/tasks/${id}`,
    'PUT',
    { id, title, durationSeconds: null, revision: null, children: [] },
    { cookie },
  )
  if (response.status !== 200) throw new Error(`Expected a saved task tree, got ${response.status}`)
  return id
}

export async function createRecipient(env: Env, cookie: string, displayName: string) {
  const response = await json(env, '/api/recipients', 'POST', { displayName }, { cookie })
  if (response.status !== 201) throw new Error(`Expected a recipient, got ${response.status}`)
  return (await response.json()) as { id: string; displayName: string }
}

/**
 * Runs the complete enrollment handshake for a recipient and returns the
 * collected bearer token, as a device would.
 */
export async function enrollDevice(env: Env, cookie: string, recipientId: string) {
  const issued = (await (
    await json(env, `/api/recipients/${recipientId}/enrollments`, 'POST', {}, { cookie })
  ).json()) as { id: string; payload: { version: number; enrollmentId: string; secret: string } }

  const claimantSecret = generateSecret()
  const claim = (await (
    await json(env, '/api/enrollments/claim', 'POST', {
      payload: issued.payload,
      claimantSecret,
    })
  ).json()) as { matchingCode: string }

  const approval = await json(
    env,
    `/api/enrollments/${issued.id}/approve`,
    'POST',
    { matchingCode: claim.matchingCode },
    { cookie },
  )
  if (approval.status !== 200) throw new Error(`Expected approval, got ${approval.status}`)

  const collected = await json(env, `/api/enrollments/${issued.id}/session`, 'POST', {
    claimantSecret,
  })
  const session = (await collected.json()) as { token: string }
  return { enrollmentId: issued.id, claimantSecret, token: session.token }
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
