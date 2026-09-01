import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import pino from 'pino'
import { type RateLimitBindings, rateLimit } from './rate-limit'

type TestEnv = {
  Bindings: RateLimitBindings
  Variables: { logger: pino.Logger; requestId: string; userId: string | undefined }
}

function limiter(success: boolean, keys: string[]): RateLimit {
  return {
    async limit({ key }) {
      keys.push(key)
      return { success }
    },
  }
}

function testApp({ guestAi = true } = {}) {
  const keys = {
    memberRegular: [] as string[],
    guestRegular: [] as string[],
    memberAi: [] as string[],
    guestAi: [] as string[],
  }
  const app = new Hono<TestEnv>()

  app.use('*', async (c, next) => {
    c.set('logger', pino({ enabled: false }))
    c.set('requestId', 'request-1')
    c.set('userId', c.req.header('x-user-id'))
    await next()
  })
  app.get('/regular', rateLimit('regular'), (c) => c.json({ ok: true }))
  app.get('/ai', rateLimit('ai'), (c) => c.json({ ok: true }))

  return {
    app,
    env: {
      MEMBER_API_RATE_LIMITER: limiter(true, keys.memberRegular),
      GUEST_API_RATE_LIMITER: limiter(true, keys.guestRegular),
      MEMBER_AI_RATE_LIMITER: limiter(true, keys.memberAi),
      GUEST_AI_RATE_LIMITER: limiter(guestAi, keys.guestAi),
    },
    keys,
  }
}

describe('rateLimit', () => {
  test('uses the member binding and user ID for an authenticated caller', async () => {
    const { app, env, keys } = testApp()

    const headers = { 'x-user-id': 'user-1' }
    const responses = await Promise.all([
      app.request('/regular', { headers }, env),
      app.request('/ai', { headers }, env),
    ])

    expect(responses.map(({ status }) => status)).toEqual([200, 200])
    expect(keys).toEqual({
      memberRegular: ['user-1'],
      guestRegular: [],
      memberAi: ['user-1'],
      guestAi: [],
    })
  })

  test('uses the guest binding and connecting IP without logging it', async () => {
    const { app, env, keys } = testApp()

    const headers = { 'cf-connecting-ip': '192.0.2.1' }
    const responses = await Promise.all([
      app.request('/regular', { headers }, env),
      app.request('/ai', { headers }, env),
    ])

    expect(responses.map(({ status }) => status)).toEqual([200, 200])
    expect(keys).toEqual({
      memberRegular: [],
      guestRegular: ['192.0.2.1'],
      memberAi: [],
      guestAi: ['192.0.2.1'],
    })
  })

  test('returns a retryable 429 when the selected limit is exhausted', async () => {
    const { app, env } = testApp({ guestAi: false })

    const response = await app.request('/ai', {}, env)
    const body: unknown = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(response.headers.get('content-type')).toStartWith('application/problem+json')
    expect(body).toEqual({
      type: 'urn:helping-hand:problem:rate-limited',
      title: 'Too many requests',
      status: 429,
      detail: 'Too many requests. Try again later.',
      instance: 'urn:request:request-1',
      retryable: true,
    })
  })
})
