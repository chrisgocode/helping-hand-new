import '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { createAuth } from './auth'
import { logger } from './lib/logger'
import { problem } from './lib/problem'
import { withLogger } from './middleware/observability'
import { rateLimit } from './middleware/rate-limit'
import { resolveAuth } from './middleware/require-auth'
import { openApiConfig } from './openapi'
import { taskRoutes } from './routes/task.routes'
import type { TaskRouteEnv } from './types/task'

const app = new OpenAPIHono<TaskRouteEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return problem(
        c,
        {
          type: 'urn:helping-hand:problem:validation',
          title: 'Invalid request',
          detail: 'The request is invalid.',
          retryable: false,
        },
        400,
      )
    }
  },
})

app.use('*', requestId({ generator: (c) => c.req.header('cf-ray') ?? crypto.randomUUID() }))
app.use('*', withLogger)
app.use('/api/*', (c, next) => cors({ origin: c.env.TRUSTED_ORIGIN, credentials: true })(c, next))
app.use('/api/*', resolveAuth, rateLimit('regular'))
app.all('/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))
app.route('/api/tasks', taskRoutes)

app.doc('/openapi.json', openApiConfig)
app.get('/', (c) => c.json({ message: 'Helping Hand API' }))
app.onError((_error, c) => {
  logger.error({
    event: 'unhandled_error',
    code: 'internal_error',
    route: c.req.routePath,
    requestId: c.get('requestId'),
  })
  return problem(
    c,
    {
      type: 'urn:helping-hand:problem:internal-error',
      title: 'Internal server error',
      detail: 'The request could not be completed.',
      retryable: false,
    },
    500,
  )
})

export default app
