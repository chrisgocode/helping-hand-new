import { createMiddleware } from 'hono/factory'
import { logger } from '../lib/logger'
import type { TaskRouteEnv } from '../types/task'

export const withLogger = createMiddleware<TaskRouteEnv>(async (c, next) => {
  c.set('logger', logger.child({ requestId: c.get('requestId') }))
  await next()
})

export function logAiRequest(operation: 'breakdown' | 'durations' | 'order') {
  return createMiddleware<TaskRouteEnv>(async (c, next) => {
    const startedAt = performance.now()
    await next()
    const failureKind = c.get('aiFailureKind')
    const fields = {
      event: 'ai_request_completed',
      operation,
      model: c.env.OPENROUTER_MODEL ?? 'openrouter/free',
      durationMs: Math.round(performance.now() - startedAt),
      status: c.res.status,
      ...(failureKind ? { failureKind } : {}),
      ...(c.get('aiProviderStatus') === undefined
        ? {}
        : { providerStatus: c.get('aiProviderStatus') }),
    }
    if (failureKind === 'configuration' || failureKind === 'unknown') {
      c.get('logger').error(fields)
    } else if (failureKind) {
      c.get('logger').warn(fields)
    } else {
      c.get('logger').info(fields)
    }
  })
}
