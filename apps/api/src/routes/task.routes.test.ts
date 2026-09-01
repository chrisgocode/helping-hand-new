import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { OpenRouterError, RequestTimeoutError } from '@openrouter/sdk/models/errors'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'

let aiFailure: unknown
let aiCompletion = '{"children":[{"title":"Get a mug"}]}'

mock.module('@openrouter/sdk', () => ({
  OpenRouter: class {
    chat = {
      send: async () => {
        if (aiFailure) throw aiFailure
        return { choices: [{ message: { content: aiCompletion } }] }
      },
    }
  },
}))

const { default: app } = await import('../app')

function providerError(status: number, retryAfter?: string) {
  return new OpenRouterError('sensitive provider message', {
    request: new Request('https://openrouter.ai/api/v1/chat/completions'),
    response: new Response('sensitive provider body about Make coffee', {
      status,
      headers: retryAfter ? { 'retry-after': retryAfter } : undefined,
    }),
    body: 'sensitive provider body about Make coffee',
  })
}

describe('task HTTP routes', () => {
  let miniflare: Miniflare
  let database: D1Database

  beforeEach(async () => {
    aiFailure = undefined
    aiCompletion = '{"children":[{"title":"Get a mug"}]}'
    miniflare = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: 'export default { fetch() { return new Response() } }',
        d1Databases: { database: ':memory:' },
      }),
    )
    database = (await miniflare.getD1Database('database')) as D1Database
    const migrations = await Promise.all(
      ['0001_create_tasks.sql', '0002_create_auth.sql', '0003_update_tasks.sql'].map((file) =>
        Bun.file(new URL(`../migrations/${file}`, import.meta.url)).text(),
      ),
    )
    for (const migration of migrations) {
      await database.batch(
        migration
          .split(';')
          .map((statement) => statement.trim())
          .filter(Boolean)
          .map((statement) => database.prepare(statement)),
      )
    }
  })

  afterEach(async () => miniflare.dispose())

  function rateLimiters(guestAi = true) {
    const allow = { limit: async () => ({ success: true }) }
    return {
      MEMBER_API_RATE_LIMITER: allow,
      GUEST_API_RATE_LIMITER: allow,
      MEMBER_AI_RATE_LIMITER: allow,
      GUEST_AI_RATE_LIMITER: { limit: async () => ({ success: guestAi }) },
    }
  }

  function requestBreakdown() {
    const taskId = '00000000-0000-4000-8000-000000000001'
    return app.request(
      '/api/tasks/proposals/breakdown',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '192.0.2.1',
          'cf-ray': 'test-request-id',
        },
        body: JSON.stringify({
          draft: {
            id: taskId,
            title: 'Make coffee',
            durationSeconds: null,
            revision: null,
            children: [],
          },
          taskId,
          detail: 3,
        }),
      },
      {
        database,
        BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
        BETTER_AUTH_URL: 'http://localhost:8787',
        TRUSTED_ORIGIN: 'http://localhost:5173',
        OPENROUTER_API_KEY: 'test-key',
        ...rateLimiters(),
      },
    )
  }

  test('requires authentication', async () => {
    const response = await app.request(
      '/api/tasks',
      {},
      {
        database,
        BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
        BETTER_AUTH_URL: 'http://localhost:8787',
        TRUSTED_ORIGIN: 'http://localhost:5173',
        OPENROUTER_API_KEY: 'test-key',
        ...rateLimiters(),
      },
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  test('loads task trees for the authenticated user', async () => {
    const env = {
      database,
      BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
      BETTER_AUTH_URL: 'http://localhost:8787',
      TRUSTED_ORIGIN: 'http://localhost:5173',
      OPENROUTER_API_KEY: 'test-key',
      ...rateLimiters(),
    }
    const registration = await app.request(
      '/api/auth/sign-up/email',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: env.TRUSTED_ORIGIN },
        body: JSON.stringify({
          name: 'Test User',
          email: 'test@example.com',
          password: 'test-password-123',
        }),
      },
      env,
    )
    const cookie = registration.headers.get('set-cookie')?.split(';')[0]
    expect(registration.status).toBe(200)
    expect(cookie).toBeTruthy()
    if (!cookie) throw new Error('Expected an authentication cookie')

    const rootId = '00000000-0000-4000-8000-000000000001'
    const invalidResponse = await app.request(
      `/api/tasks/${rootId}`,
      {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{}',
      },
      env,
    )
    expect(invalidResponse.status).toBe(400)

    const saveResponse = await app.request(
      `/api/tasks/${rootId}`,
      {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          id: rootId,
          title: 'Make coffee',
          durationSeconds: 60,
          revision: null,
          children: [],
        }),
      },
      env,
    )
    expect(saveResponse.status).toBe(200)

    const response = await app.request('/api/tasks', { headers: { cookie } }, env)
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([
      {
        id: rootId,
        title: 'Make coffee',
        durationSeconds: 60,
        revision: 0,
        children: [],
      },
    ])
  })

  test('allows guest AI drafts but still rate limits them before validation', async () => {
    const baseEnv = {
      database,
      BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
      BETTER_AUTH_URL: 'http://localhost:8787',
      TRUSTED_ORIGIN: 'http://localhost:5173',
      OPENROUTER_API_KEY: 'test-key',
    }
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' },
      body: '{}',
    }

    const invalidResponse = await app.request('/api/tasks/proposals/breakdown', request, {
      ...baseEnv,
      ...rateLimiters(),
    })
    const limitedResponse = await app.request('/api/tasks/proposals/breakdown', request, {
      ...baseEnv,
      ...rateLimiters(false),
    })

    expect(invalidResponse.status).toBe(400)
    expect(limitedResponse.status).toBe(429)
  })

  test('returns a sanitized retryable problem when AI generation times out', async () => {
    aiFailure = new RequestTimeoutError('sensitive provider message about Make coffee')
    const response = await requestBreakdown()
    const body = await response.text()

    expect(response.status).toBe(504)
    expect(response.headers.get('content-type')).toStartWith('application/problem+json')
    expect(response.headers.get('x-request-id')).toBe('test-request-id')
    expect(JSON.parse(body)).toEqual({
      type: 'urn:helping-hand:problem:ai-timeout',
      title: 'AI generation timed out',
      status: 504,
      detail: 'The AI service did not respond in time. Try again.',
      instance: 'urn:request:test-request-id',
      retryable: true,
    })
    expect(body).not.toContain('sensitive provider message')
    expect(body).not.toContain('Make coffee')
  })

  test('returns 503 and Retry-After for upstream throttling', async () => {
    aiFailure = providerError(429, '12')
    const response = await requestBreakdown()
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('12')
    expect(JSON.parse(body)).toMatchObject({
      type: 'urn:helping-hand:problem:ai-unavailable',
      status: 503,
      retryable: true,
    })
    expect(body).not.toContain('sensitive provider')
    expect(body).not.toContain('Make coffee')
  })

  test('returns 502 for invalid structured model output', async () => {
    aiCompletion = '{"children":["Get a mug"]}'
    const response = await requestBreakdown()

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      type: 'urn:helping-hand:problem:ai-invalid-response',
      status: 502,
      retryable: true,
    })
  })

  test('hides non-retryable provider configuration failures', async () => {
    aiFailure = providerError(401)
    const response = await requestBreakdown()
    const body = await response.text()

    expect(response.status).toBe(500)
    expect(JSON.parse(body)).toMatchObject({
      type: 'urn:helping-hand:problem:internal-error',
      status: 500,
      retryable: false,
    })
    expect(body).not.toContain('sensitive provider')
    expect(body).not.toContain('Make coffee')
  })
})
