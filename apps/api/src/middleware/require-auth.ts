import { createMiddleware } from 'hono/factory'
import { type AccountKind, createAuth } from '../auth'
import { problem } from '../lib/problem'
import { RecipientService } from '../services/recipient.service'
import { serviceOptions } from '../services/service-options'
import type { ApiEnv } from '../types/api'

const unauthorized = 'urn:helping-hand:problem:unauthorized'
const forbidden = 'urn:helping-hand:problem:forbidden'

/**
 * Resolves the actor without deciding anything: the actor's own user ID, its
 * server-controlled account kind, and the session it presented. The actor ID is
 * never replaced by a caretaker's ID.
 */
export const resolveAuth = createMiddleware<ApiEnv>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers })
  c.set('userId', session?.user.id)
  c.set('accountKind', (session?.user.accountKind as AccountKind | undefined) ?? undefined)
  c.set('sessionId', session?.session.id)
  c.set('sessionExpiresAt', session?.session.expiresAt?.toISOString())
  await next()
})

/** Caretaker-only operations. A recipient device is authenticated but forbidden. */
export const requireCaretaker = createMiddleware<ApiEnv>(async (c, next) => {
  const userId = c.get('userId')
  if (!userId) {
    return problem(
      c,
      {
        type: unauthorized,
        title: 'Authentication required',
        detail: 'Sign in to continue.',
        retryable: false,
      },
      401,
    )
  }
  if (c.get('accountKind') === 'recipient') {
    return problem(
      c,
      {
        type: forbidden,
        title: 'Not permitted',
        detail: 'This operation is only available to a caretaker.',
        retryable: false,
      },
      403,
    )
  }
  c.set('authenticatedUserId', userId)
  await next()
})

/**
 * Guards operations that also serve unauthenticated callers. Guests keep their
 * current behavior; recipient credentials are rejected outright.
 */
export const denyRecipient = createMiddleware<ApiEnv>(async (c, next) => {
  if (c.get('accountKind') === 'recipient') {
    return problem(
      c,
      {
        type: forbidden,
        title: 'Not permitted',
        detail: 'This operation is not available to a recipient device.',
        retryable: false,
      },
      403,
    )
  }
  await next()
})

/**
 * Recipient-only operations. Beyond a valid session this requires an enabled
 * recipient whose active-session reference names the presented session, read
 * from the database on every request so revocation takes effect immediately.
 */
export const requireRecipient = createMiddleware<ApiEnv>(async (c, next) => {
  const userId = c.get('userId')
  const sessionId = c.get('sessionId')
  const sessionExpiresAt = c.get('sessionExpiresAt')
  const deny = () =>
    problem(
      c,
      {
        type: unauthorized,
        title: 'Authentication required',
        detail: 'This device is not enrolled.',
        retryable: false,
      },
      401,
    )

  if (!userId || !sessionId || !sessionExpiresAt) return deny()
  if (c.get('accountKind') !== 'recipient') {
    return problem(
      c,
      {
        type: forbidden,
        title: 'Not permitted',
        detail: 'This operation is only available to a recipient device.',
        retryable: false,
      },
      403,
    )
  }

  const recipients = new RecipientService(serviceOptions(c))
  const recipient = await recipients.findActiveRecipient(userId, sessionId)
  if (!recipient) return deny()

  c.set('recipient', recipient)
  c.set('recipientSessionExpiresAt', sessionExpiresAt)
  await next()
})

/**
 * The Better Auth handler surface is broad. A recipient device may only read
 * its session or sign out; account mutation and credential creation would
 * otherwise become an alternate enrollment path.
 */
const RECIPIENT_AUTH_PATHS = new Set(['/api/auth/get-session', '/api/auth/sign-out'])

export const restrictRecipientAuthRoutes = createMiddleware<ApiEnv>(async (c, next) => {
  if (c.get('accountKind') === 'recipient' && !RECIPIENT_AUTH_PATHS.has(c.req.path)) {
    return problem(
      c,
      {
        type: forbidden,
        title: 'Not permitted',
        detail: 'This account operation is not available to a recipient device.',
        retryable: false,
      },
      403,
    )
  }
  await next()
})
