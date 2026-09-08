import { createMiddleware } from 'hono/factory'
import type { Logger } from 'pino'
import { problem } from '../lib/problem'

export type RateLimitBindings = {
  MEMBER_API_RATE_LIMITER: RateLimit
  GUEST_API_RATE_LIMITER: RateLimit
  MEMBER_AI_RATE_LIMITER: RateLimit
  GUEST_AI_RATE_LIMITER: RateLimit
  ENROLLMENT_RATE_LIMITER: RateLimit
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
  enrollment: {
    member: 'ENROLLMENT_RATE_LIMITER',
    guest: 'ENROLLMENT_RATE_LIMITER',
  },
} as const

/**
 * `keyParam` narrows a limit to a single path parameter, for example one
 * enrollment, so an unauthenticated device cannot spend the whole trusted-IP
 * budget of everyone behind the same address. Without it the limit is keyed by
 * caller identity.
 */
export function rateLimit(policy: keyof typeof bindings, keyParam?: string) {
  return createMiddleware<RateLimitEnv>(async (c, next) => {
    const userId = c.get('userId')
    const tier = userId ? 'member' : 'guest'
    const address = c.req.header('cf-connecting-ip') ?? 'unknown'
    const scope = keyParam === undefined ? undefined : (c.req.param(keyParam) ?? 'unknown')
    const key = scope === undefined ? (userId ?? address) : `${scope}:${address}`
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
      return problem(
        c,
        {
          type: 'urn:helping-hand:problem:rate-limited',
          title: 'Too many requests',
          detail: 'Too many requests. Try again later.',
          retryable: true,
        },
        429,
      )
    }

    await next()
  })
}
