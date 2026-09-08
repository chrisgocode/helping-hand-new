import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { OpenRouterError, RequestTimeoutError } from '@openrouter/sdk/models/errors'
import { createTestDatabase } from '../test/database'

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
const { testEnv } = await import('../test/api')

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
  let miniflare: Awaited<ReturnType<typeof createTestDatabase>>['miniflare']
  let database: D1Database

  beforeEach(async () => {
    aiFailure = undefined
    aiCompletion = '{"children":[{"title":"Get a mug"}]}'
    ;({ database, miniflare } = await createTestDatabase())
  })

  afterEach(async () => miniflare.dispose())

  /** The shared test env, with the guest AI limiter open or closed. */
  const env = (guestAi = true) => ({
    ...testEnv(database),
    GUEST_AI_RATE_LIMITER: { limit: async () => ({ success: guestAi }) },
  })

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
      env(),
    )
  }

  test('requires authentication', async () => {
    const response = await app.request(
      '/api/tasks',
      { headers: { 'cf-ray': 'auth-request-id' } },
      env(),
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBe('auth-request-id')
    expect(response.headers.get('content-type')).toStartWith('application/problem+json')
    expect(body).toEqual({
      type: 'urn:helping-hand:problem:unauthorized',
      title: 'Authentication required',
      status: 401,
      detail: 'Sign in to continue.',
      instance: 'urn:request:auth-request-id',
      retryable: false,
    })
  })

  test('loads task trees for the authenticated user', async () => {
    const bindings = env()
    const registration = await app.request(
      '/api/auth/sign-up/email',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: bindings.TRUSTED_ORIGIN },
        body: JSON.stringify({
          name: 'Test User',
          email: 'test@example.com',
          password: 'test-password-123',
        }),
      },
      bindings,
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
      bindings,
    )
    expect(invalidResponse.status).toBe(400)
    expect(invalidResponse.headers.get('content-type')).toStartWith('application/problem+json')
    expect(await invalidResponse.json()).toMatchObject({
      type: 'urn:helping-hand:problem:validation',
      status: 400,
      retryable: false,
    })

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
      bindings,
    )
    expect(saveResponse.status).toBe(200)

    const response = await app.request('/api/tasks', { headers: { cookie } }, bindings)
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([
      {
        id: rootId,
        title: 'Make coffee',
        durationSeconds: 60,
        categoryId: null,
        revision: 0,
        children: [],
      },
    ])
  })

  test('allows guest AI drafts but still rate limits them before validation', async () => {
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' },
      body: '{}',
    }

    const invalidResponse = await app.request('/api/tasks/proposals/breakdown', request, env())
    const limitedResponse = await app.request('/api/tasks/proposals/breakdown', request, env(false))

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
