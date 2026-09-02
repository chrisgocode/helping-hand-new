import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import app from '../app'
import { createTestDatabase } from '../test/database'

describe('category HTTP routes', () => {
  let miniflare: Awaited<ReturnType<typeof createTestDatabase>>['miniflare']
  let database: D1Database

  beforeEach(async () => {
    ;({ database, miniflare } = await createTestDatabase())
  })

  afterEach(async () => miniflare.dispose())

  const rateLimiters = () => {
    const allow = { limit: async () => ({ success: true }) }
    return {
      MEMBER_API_RATE_LIMITER: allow,
      GUEST_API_RATE_LIMITER: allow,
      MEMBER_AI_RATE_LIMITER: allow,
      GUEST_AI_RATE_LIMITER: allow,
    }
  }

  function env() {
    return {
      database,
      BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
      BETTER_AUTH_URL: 'http://localhost:8787',
      TRUSTED_ORIGIN: 'http://localhost:5173',
      OPENROUTER_API_KEY: 'test-key',
      ...rateLimiters(),
    }
  }

  async function signIn() {
    const bindings = env()
    const response = await app.request(
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
    const cookie = response.headers.get('set-cookie')?.split(';')[0]
    if (!cookie) throw new Error('Expected an authentication cookie')
    return cookie
  }

  test('requires authentication', async () => {
    const response = await app.request('/api/categories', {}, env())
    expect(response.status).toBe(401)
  })

  test('creates, lists, renames, reorders, and deletes categories', async () => {
    const cookie = await signIn()
    const request = (path: string, method: string, body?: unknown) =>
      app.request(
        path,
        {
          method,
          headers: {
            cookie,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        env(),
      )

    const homeResponse = await request('/api/categories', 'POST', { name: 'Home' })
    const workResponse = await request('/api/categories', 'POST', { name: 'Work' })
    const home = (await homeResponse.json()) as { id: string }
    const work = (await workResponse.json()) as { id: string }
    expect(homeResponse.status).toBe(201)
    expect(workResponse.status).toBe(201)

    const reorderResponse = await request('/api/categories/order', 'PUT', {
      categoryIds: [work.id, home.id],
    })
    expect(reorderResponse.status).toBe(200)
    expect(await reorderResponse.json()).toMatchObject([
      { id: work.id, position: 0 },
      { id: home.id, position: 1 },
    ])

    const renameResponse = await request(`/api/categories/${home.id}`, 'PATCH', {
      name: 'Household',
    })
    expect(renameResponse.status).toBe(200)
    expect(await renameResponse.json()).toMatchObject({ id: home.id, name: 'Household' })

    expect((await request(`/api/categories/${work.id}`, 'DELETE')).status).toBe(204)
    const listResponse = await request('/api/categories', 'GET')
    expect(listResponse.status).toBe(200)
    expect(await listResponse.json()).toMatchObject([
      { id: home.id, name: 'Household', position: 0 },
    ])
  })

  test('assigns and removes a category from a root task', async () => {
    const cookie = await signIn()
    const headers = { cookie, 'content-type': 'application/json' }
    const categoryResponse = await app.request(
      '/api/categories',
      { method: 'POST', headers, body: JSON.stringify({ name: 'Morning' }) },
      env(),
    )
    const category = (await categoryResponse.json()) as { id: string }
    const rootId = '00000000-0000-4000-8000-000000000001'
    await app.request(
      `/api/tasks/${rootId}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          id: rootId,
          title: 'Make coffee',
          durationSeconds: null,
          revision: null,
          children: [],
        }),
      },
      env(),
    )

    const assignResponse = await app.request(
      `/api/tasks/${rootId}/category`,
      { method: 'PATCH', headers, body: JSON.stringify({ categoryId: category.id }) },
      env(),
    )
    expect(assignResponse.status).toBe(200)
    const assignment: unknown = await assignResponse.json()
    expect(assignment).toEqual({ rootId, categoryId: category.id })

    const tasksResponse = await app.request('/api/tasks', { headers: { cookie } }, env())
    expect(await tasksResponse.json()).toMatchObject([{ id: rootId, categoryId: category.id }])

    const removeResponse = await app.request(
      `/api/tasks/${rootId}/category`,
      { method: 'PATCH', headers, body: JSON.stringify({ categoryId: null }) },
      env(),
    )
    const removal: unknown = await removeResponse.json()
    expect(removal).toEqual({ rootId, categoryId: null })
  })

  test('returns sanitized validation, conflict, and not-found problems', async () => {
    const cookie = await signIn()
    const request = (path: string, method: string, body: unknown) =>
      app.request(
        path,
        {
          method,
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        env(),
      )

    const invalid = await request('/api/categories', 'POST', { name: '   ' })
    expect(invalid.status).toBe(400)
    expect(invalid.headers.get('content-type')).toStartWith('application/problem+json')

    await request('/api/categories', 'POST', { name: 'Home' })
    const duplicate = await request('/api/categories', 'POST', { name: 'home' })
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toMatchObject({
      type: 'urn:helping-hand:problem:conflict',
      retryable: false,
    })

    const staleOrder = await request('/api/categories/order', 'PUT', { categoryIds: [] })
    expect(staleOrder.status).toBe(409)

    const missing = await request('/api/categories/00000000-0000-4000-8000-000000000099', 'PATCH', {
      name: 'Missing',
    })
    expect(missing.status).toBe(404)
  })
})
