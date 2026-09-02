import { expect, test } from 'bun:test'
import app from './app'

const developmentEnv = { APP_ENV: 'development' }

test('publishes a recursive TaskNode component in the OpenAPI document', async () => {
  const response = await app.request('/openapi.json', {}, developmentEnv)
  const document: unknown = await response.json()

  expect(response.status).toBe(200)
  expect(document).toMatchObject({
    openapi: '3.0.3',
    components: {
      schemas: {
        TaskNode: {
          type: 'object',
          properties: {
            durationSeconds: { type: 'integer', nullable: true },
            children: {
              type: 'array',
              items: { $ref: '#/components/schemas/TaskNode' },
            },
          },
        },
      },
    },
  })
})

test('publishes every task operation with stable operation IDs', async () => {
  const response = await app.request('/openapi.json', {}, developmentEnv)
  const document: unknown = await response.json()

  expect(document).toMatchObject({
    paths: {
      '/api/tasks': {
        get: { operationId: 'getTaskTrees' },
      },
      '/api/tasks/{rootId}': {
        put: { operationId: 'saveTaskTree' },
        delete: { operationId: 'deleteTaskTree' },
      },
      '/api/tasks/{rootId}/category': {
        patch: { operationId: 'setTaskCategory' },
      },
      '/api/tasks/proposals/breakdown': {
        post: { operationId: 'proposeTaskBreakdown' },
      },
      '/api/tasks/proposals/durations': {
        post: { operationId: 'proposeTaskDurations' },
      },
      '/api/tasks/proposals/order': {
        post: { operationId: 'proposeTaskOrder' },
      },
    },
  })
})

test('publishes every category operation with stable operation IDs', async () => {
  const response = await app.request('/openapi.json', {}, developmentEnv)
  const document: unknown = await response.json()

  expect(document).toMatchObject({
    paths: {
      '/api/categories': {
        get: { operationId: 'getCategories' },
        post: { operationId: 'createCategory' },
      },
      '/api/categories/order': {
        put: { operationId: 'reorderCategories' },
      },
      '/api/categories/{categoryId}': {
        patch: { operationId: 'renameCategory' },
        delete: { operationId: 'deleteCategory' },
      },
    },
  })
})

test('publishes authentication, request-body, error, and empty-response contracts', async () => {
  const response = await app.request('/openapi.json', {}, developmentEnv)
  const document: unknown = await response.json()

  expect(document).toMatchObject({
    components: {
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie' },
      },
    },
    paths: {
      '/api/tasks/{rootId}': {
        put: {
          security: [{ cookieAuth: [] }],
          requestBody: { required: true },
          responses: {
            400: { content: { 'application/problem+json': {} } },
          },
        },
        delete: {
          requestBody: { required: true },
          responses: {
            204: { description: 'The task tree was deleted' },
          },
        },
      },
      '/api/tasks/proposals/breakdown': {
        post: {
          requestBody: { required: true },
          responses: {
            429: { content: { 'application/problem+json': {} } },
            502: { content: { 'application/problem+json': {} } },
            503: { content: { 'application/problem+json': {} } },
            504: { content: { 'application/problem+json': {} } },
          },
        },
      },
    },
  })
})

test('serves the interactive API reference', async () => {
  const response = await app.request('/docs', {}, developmentEnv)
  const html = await response.text()

  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toStartWith('text/html')
  expect(html).toContain('/openapi.json')
})

test('does not expose API documentation outside development', async () => {
  const env = { APP_ENV: 'production' }
  const [documentResponse, docsResponse] = await Promise.all([
    app.request('/openapi.json', {}, env),
    app.request('/docs', {}, env),
  ])

  expect(documentResponse.status).toBe(404)
  expect(docsResponse.status).toBe(404)
})
