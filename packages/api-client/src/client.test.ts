import { expect, test } from 'bun:test'
import { createApiClient } from './client'

test('creates a credentialed client with typed path and body parameters', async () => {
  let request: Request | undefined
  const rootId = '75ef08f8-4e23-4b52-9250-e45c67fb8d25'
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    fetch: async (input) => {
      request = input
      return Response.json({
        id: rootId,
        title: 'Make coffee',
        durationSeconds: null,
        children: [],
        revision: 1,
      })
    },
  })

  const result = await client.PUT('/api/tasks/{rootId}', {
    params: { path: { rootId } },
    body: {
      id: rootId,
      title: 'Make coffee',
      durationSeconds: null,
      children: [],
      revision: null,
    },
  })

  expect(result.data?.revision).toBe(1)
  expect(request?.url).toBe(`https://api.example.test/api/tasks/${rootId}`)
  expect(request?.credentials).toBe('include')
  expect(await request?.json()).toMatchObject({ title: 'Make coffee', revision: null })
})

test('returns typed Problem Details for API failures', async () => {
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    fetch: async () =>
      Response.json(
        {
          type: 'urn:helping-hand:problem:unauthorized',
          title: 'Authentication required',
          status: 401,
          detail: 'Sign in to continue.',
          instance: 'request-id',
          retryable: false,
        },
        { status: 401, headers: { 'content-type': 'application/problem+json' } },
      ),
  })

  const { error } = await client.GET('/api/tasks')

  expect(error?.title).toBe('Authentication required')
  expect(error?.retryable).toBe(false)
})
