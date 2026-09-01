import { createMiddleware } from 'hono/factory'
import { createAuth } from '../auth'
import type { TaskRouteEnv } from '../types/task'

export const resolveAuth = createMiddleware<TaskRouteEnv>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers })
  c.set('userId', session?.user.id)
  await next()
})

export const requireAuth = createMiddleware<TaskRouteEnv>(async (c, next) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  c.set('authenticatedUserId', userId)
  await next()
})
