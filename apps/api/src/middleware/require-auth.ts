import { createMiddleware } from 'hono/factory'
import { createAuth } from '../auth'
import { problem } from '../lib/problem'
import type { ApiEnv } from '../types/api'

export const resolveAuth = createMiddleware<ApiEnv>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers })
  c.set('userId', session?.user.id)
  await next()
})

export const requireAuth = createMiddleware<ApiEnv>(async (c, next) => {
  const userId = c.get('userId')
  if (!userId) {
    return problem(
      c,
      {
        type: 'urn:helping-hand:problem:unauthorized',
        title: 'Authentication required',
        detail: 'Sign in to continue.',
        retryable: false,
      },
      401,
    )
  }
  c.set('authenticatedUserId', userId)
  await next()
})
