import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { json, request, saveTaskTree, signInCaretaker, testEnv } from '../test/api'
import { createTestDatabase } from '../test/database'

describe('category HTTP routes', () => {
  let miniflare: Awaited<ReturnType<typeof createTestDatabase>>['miniflare']
  let database: D1Database

  beforeEach(async () => {
    ;({ database, miniflare } = await createTestDatabase())
  })

  afterEach(async () => miniflare.dispose())

  const env = () => testEnv(database)

  const signIn = () => signInCaretaker(env())

  test('requires authentication', async () => {
    const response = await request(env(), '/api/categories')
    expect(response.status).toBe(401)
  })

  test('creates, lists, renames, reorders, and deletes categories', async () => {
    const cookie = await signIn()
    const send = (path: string, method: string, body?: unknown) =>
      body === undefined
        ? request(env(), path, method, { headers: { cookie } })
        : json(env(), path, method, body, { cookie })

    const homeResponse = await send('/api/categories', 'POST', { name: 'Home' })
    const workResponse = await send('/api/categories', 'POST', { name: 'Work' })
    const home = (await homeResponse.json()) as { id: string }
    const work = (await workResponse.json()) as { id: string }
    expect(homeResponse.status).toBe(201)
    expect(workResponse.status).toBe(201)

    const reorderResponse = await send('/api/categories/order', 'PUT', {
      categoryIds: [work.id, home.id],
    })
    expect(reorderResponse.status).toBe(200)
    expect(await reorderResponse.json()).toMatchObject([
      { id: work.id, position: 0 },
      { id: home.id, position: 1 },
    ])

    const renameResponse = await send(`/api/categories/${home.id}`, 'PATCH', {
      name: 'Household',
    })
    expect(renameResponse.status).toBe(200)
    expect(await renameResponse.json()).toMatchObject({ id: home.id, name: 'Household' })

    expect((await send(`/api/categories/${work.id}`, 'DELETE')).status).toBe(204)
    const listResponse = await send('/api/categories', 'GET')
    expect(listResponse.status).toBe(200)
    expect(await listResponse.json()).toMatchObject([
      { id: home.id, name: 'Household', position: 0 },
    ])
  })

  test('assigns and removes a category from a root task', async () => {
    const cookie = await signIn()
    const categoryResponse = await json(
      env(),
      '/api/categories',
      'POST',
      { name: 'Morning' },
      { cookie },
    )
    const category = (await categoryResponse.json()) as { id: string }
    const rootId = await saveTaskTree(
      env(),
      cookie,
      '00000000-0000-4000-8000-000000000001',
      'Make coffee',
    )

    const assignResponse = await json(
      env(),
      `/api/tasks/${rootId}/category`,
      'PATCH',
      { categoryId: category.id },
      { cookie },
    )
    expect(assignResponse.status).toBe(200)
    const assignment: unknown = await assignResponse.json()
    expect(assignment).toEqual({ rootId, categoryId: category.id })

    const tasksResponse = await request(env(), '/api/tasks', 'GET', { headers: { cookie } })
    expect(await tasksResponse.json()).toMatchObject([{ id: rootId, categoryId: category.id }])

    const removeResponse = await json(
      env(),
      `/api/tasks/${rootId}/category`,
      'PATCH',
      { categoryId: null },
      { cookie },
    )
    const removal: unknown = await removeResponse.json()
    expect(removal).toEqual({ rootId, categoryId: null })
  })

  test('returns sanitized validation, conflict, and not-found problems', async () => {
    const cookie = await signIn()
    const send = (path: string, method: string, body: unknown) =>
      json(env(), path, method, body, { cookie })

    const invalid = await send('/api/categories', 'POST', { name: '   ' })
    expect(invalid.status).toBe(400)
    expect(invalid.headers.get('content-type')).toStartWith('application/problem+json')

    await send('/api/categories', 'POST', { name: 'Home' })
    const duplicate = await send('/api/categories', 'POST', { name: 'home' })
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toMatchObject({
      type: 'urn:helping-hand:problem:conflict',
      retryable: false,
    })

    const staleOrder = await send('/api/categories/order', 'PUT', { categoryIds: [] })
    expect(staleOrder.status).toBe(409)

    const missing = await send('/api/categories/00000000-0000-4000-8000-000000000099', 'PATCH', {
      name: 'Missing',
    })
    expect(missing.status).toBe(404)
  })
})
