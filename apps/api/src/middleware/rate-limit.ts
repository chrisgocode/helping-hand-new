import { createMiddleware } from 'hono/factory'
import type { Logger } from 'pino'

export type RateLimitBindings = {
  MEMBER_API_RATE_LIMITER: RateLimit
  GUEST_API_RATE_LIMITER: RateLimit
  MEMBER_AI_RATE_LIMITER: RateLimit
  GUEST_AI_RATE_LIMITER: RateLimit
}

type RateLimitEnv = {
  Bindings: RateLimitBindings
  Variables: { logger: Logger; requestId: string; userId: string | undefined }
}

const bindings = {
  regular: {
    member: 'MEMBER_API_RATE_LIMITER',
    guest: 'GUEST_API_RATE_LIMITER',
  },
  ai: {
    member: 'MEMBER_AI_RATE_LIMITER',
    guest: 'GUEST_AI_RATE_LIMITER',
  },
} as const

export function rateLimit(policy: keyof typeof bindings) {
  return createMiddleware<RateLimitEnv>(async (c, next) => {
    const userId = c.get('userId')
    const tier = userId ? 'member' : 'guest'
    const key = userId ?? c.req.header('cf-connecting-ip') ?? 'unknown'
    const { success } = await c.env[bindings[policy][tier]].limit({ key })

    if (!success) {
      c.get('logger').warn({
        event: 'rate_limited',
        policy,
        tier,
        route: c.req.routePath,
        retryAfter: 60,
      })
      c.header('Retry-After', '60')
      return c.json({ error: 'Too many requests' }, 429)
    }

    await next()
  })
}
