import '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { requestId } from 'hono/request-id'
import { createAuth } from './auth'
import { logger } from './lib/logger'
import { problem } from './lib/problem'
import { withLogger } from './middleware/observability'
import { rateLimit } from './middleware/rate-limit'
import { resolveAuth, restrictRecipientAuthRoutes } from './middleware/require-auth'
import { openApiConfig } from './openapi'
import { categoryRoutes } from './routes/category.routes'
import { enrollmentRoutes, recipientEnrollmentRoutes } from './routes/enrollment.routes'
import { recipientAccessRoutes, recipientRoutes } from './routes/recipient.routes'
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

app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description:
    'Better Auth session token collected by an enrolled recipient device. Send it as `Authorization: Bearer <token>`.',
})

app.use('*', requestId({ generator: (c) => c.req.header('cf-ray') ?? crypto.randomUUID() }))
app.use('*', withLogger)
app.use('/api/*', (c, next) => cors({ origin: c.env.TRUSTED_ORIGIN, credentials: true })(c, next))
app.use(
  '/api/*',
  bodyLimit({
    // Comfortably above the largest legal task tree and far below anything
    // worth spending parsing time on.
    maxSize: 512 * 1024,
    onError: (c) =>
      problem(
        c,
        {
          type: 'urn:helping-hand:problem:validation',
          title: 'Invalid request',
          detail: 'The request body is too large.',
          retryable: false,
        },
        413,
      ),
  }),
)
app.use('/api/*', resolveAuth, rateLimit('regular'))
app.all('/api/auth/*', restrictRecipientAuthRoutes, (c) => createAuth(c.env).handler(c.req.raw))
app.route('/api/categories', categoryRoutes)
app.route('/api/tasks', taskRoutes)
app.route('/api/recipients', recipientRoutes)
app.route('/api/recipients', recipientEnrollmentRoutes)
app.route('/api/recipient', recipientAccessRoutes)
app.route('/api/enrollments', enrollmentRoutes)

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
