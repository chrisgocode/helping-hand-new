import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { createAuth } from './auth'
import { logger } from './lib/logger'
import { withLogger } from './middleware/observability'
import { rateLimit } from './middleware/rate-limit'
import { resolveAuth } from './middleware/require-auth'
import { taskRoutes } from './routes/task.routes'
import type { TaskRouteEnv } from './types/task'

const app = new Hono<TaskRouteEnv>()

app.use('*', requestId({ generator: (c) => c.req.header('cf-ray') ?? crypto.randomUUID() }))
app.use('*', withLogger)
app.use('/api/auth/*', (c, next) =>
  cors({ origin: c.env.TRUSTED_ORIGIN, credentials: true })(c, next),
)
app.use('/api/*', resolveAuth, rateLimit('regular'))
app.all('/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))
app.route('/api/tasks', taskRoutes)

app.get('/', (c) => c.json({ message: 'Helping Hand API' }))
app.onError((_error, c) => {
  logger.error({
    event: 'unhandled_error',
    code: 'internal_error',
    route: c.req.routePath,
    requestId: c.get('requestId'),
  })
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
