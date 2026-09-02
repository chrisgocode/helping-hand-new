import '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { requestId } from 'hono/request-id'
import { createAuth } from './auth'
import { logger } from './lib/logger'
import { problem } from './lib/problem'
import { withLogger } from './middleware/observability'
import { rateLimit } from './middleware/rate-limit'
import { resolveAuth } from './middleware/require-auth'
import { openApiConfig } from './openapi'
import { categoryRoutes } from './routes/category.routes'
import { taskRoutes } from './routes/task.routes'
import type { ApiEnv } from './types/api'

const app = new OpenAPIHono<ApiEnv>({
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

const developmentOnly = createMiddleware<ApiEnv>((c, next) =>
  c.env.APP_ENV === 'development' ? next() : Promise.resolve(c.notFound()),
)

app.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'better-auth.session_token',
  description: 'Better Auth session cookie. Secure deployments may add a secure cookie prefix.',
})

app.use('*', requestId({ generator: (c) => c.req.header('cf-ray') ?? crypto.randomUUID() }))
app.use('*', withLogger)
app.use('/api/*', (c, next) => cors({ origin: c.env.TRUSTED_ORIGIN, credentials: true })(c, next))
app.use('/api/*', resolveAuth, rateLimit('regular'))
app.all('/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))
app.route('/api/categories', categoryRoutes)
app.route('/api/tasks', taskRoutes)

app.use('/openapi.json', developmentOnly)
app.use('/docs', developmentOnly)
app.doc('/openapi.json', openApiConfig)
app.get('/docs', Scalar({ url: '/openapi.json' }))
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
