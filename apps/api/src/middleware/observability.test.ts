import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import pino from 'pino'
import { handleTaskError } from '../controllers/task.controller'
import { TaskAiError } from '../services/task-ai'
import type { ApiEnv } from '../types/api'
import { logAiRequest } from './observability'

test('AI failure logs contain normalized context without provider or task content', async () => {
  const records: string[] = []
  const testLogger = pino({ base: null }, { write: (record) => records.push(record) })
  const app = new Hono<ApiEnv>()

  app.use('*', async (c, next) => {
    c.set('requestId', 'test-request-id')
    c.set('logger', testLogger.child({ requestId: c.get('requestId') }))
    await next()
  })
  app.use('*', logAiRequest('breakdown'))
  app.get('/', () => {
    throw new TaskAiError('unavailable', {
      cause: new Error('sensitive provider body about Make coffee'),
      providerStatus: 503,
    })
  })
  app.onError(handleTaskError)

  const response = await app.request('/', {}, {
    OPENROUTER_MODEL: 'test-model',
  } as ApiEnv['Bindings'])
  const output = records.join('')

  expect(response.status).toBe(503)
  expect(output).toContain('"failureKind":"unavailable"')
  expect(output).toContain('"providerStatus":503')
  expect(output).not.toContain('sensitive provider')
  expect(output).not.toContain('Make coffee')
})
