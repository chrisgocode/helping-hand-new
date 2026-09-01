import { beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  ConnectionError,
  OpenRouterError,
  RequestTimeoutError,
} from '@openrouter/sdk/models/errors'

let completion: unknown = ''
let request: unknown
let clientOptions: unknown
let failure: unknown

const ids = {
  coffee: '00000000-0000-4000-8000-000000000001',
  prepare: '00000000-0000-4000-8000-000000000002',
  water: '00000000-0000-4000-8000-000000000003',
  grounds: '00000000-0000-4000-8000-000000000004',
  brew: '00000000-0000-4000-8000-000000000005',
  dinner: '00000000-0000-4000-8000-000000000006',
  serve: '00000000-0000-4000-8000-000000000007',
  cook: '00000000-0000-4000-8000-000000000008',
  plate: '00000000-0000-4000-8000-000000000009',
}

mock.module('@openrouter/sdk', () => ({
  OpenRouter: class {
    constructor(options: unknown) {
      clientOptions = options
    }

    chat = {
      send: async (nextRequest: unknown) => {
        if (failure) throw failure
        request = nextRequest
        return { choices: [{ message: { content: completion } }] }
      },
    }
  },
}))

const { TaskAi, TaskAiError } = await import('./task-ai')

function providerError(status: number, retryAfter?: string) {
  return new OpenRouterError('sensitive provider message', {
    request: new Request('https://openrouter.ai/api/v1/chat/completions'),
    response: new Response('sensitive task content', {
      status,
      headers: retryAfter ? { 'retry-after': retryAfter } : undefined,
    }),
    body: 'sensitive task content',
  })
}

describe('TaskAi', () => {
  beforeEach(() => {
    completion = ''
    request = undefined
    clientOptions = undefined
    failure = undefined
  })

  test('uses a bounded timeout without automatic SDK retries', () => {
    new TaskAi({ apiKey: 'test-key' })

    expect(clientOptions).toMatchObject({
      timeoutMs: 30_000,
      retryConfig: { strategy: 'none' },
    })
  })

  test('normalizes missing provider configuration', () => {
    expect(() => new TaskAi({ apiKey: '' })).toThrow(
      expect.objectContaining({
        name: 'TaskAiError',
        kind: 'configuration',
        retryable: false,
      }),
    )
  })

  test('normalizes client timeouts without exposing the provider message', async () => {
    failure = new RequestTimeoutError('sensitive provider timeout')

    const proposal = new TaskAi({ apiKey: 'test-key' }).breakDownTask({
      task: { id: ids.coffee, title: 'Make coffee', durationSeconds: null, children: [] },
      detail: 3,
    })

    await expect(proposal).rejects.toEqual(
      expect.objectContaining({
        name: 'TaskAiError',
        kind: 'timeout',
        message: 'AI generation timed out',
        retryable: true,
      }),
    )
  })

  test('normalizes transient provider failures as unavailable', async () => {
    for (const nextFailure of [new ConnectionError('offline'), providerError(429, '12')]) {
      failure = nextFailure
      const proposal = new TaskAi({ apiKey: 'test-key' }).breakDownTask({
        task: { id: ids.coffee, title: 'Make coffee', durationSeconds: null, children: [] },
        detail: 3,
      })

      await expect(proposal).rejects.toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          retryable: true,
          providerStatus: nextFailure instanceof OpenRouterError ? 429 : undefined,
          retryAfterSeconds: nextFailure instanceof OpenRouterError ? 12 : undefined,
        }),
      )
    }
  })

  test('normalizes provider configuration failures as non-retryable', async () => {
    failure = providerError(401)

    const proposal = new TaskAi({ apiKey: 'test-key' }).breakDownTask({
      task: { id: ids.coffee, title: 'Make coffee', durationSeconds: null, children: [] },
      detail: 3,
    })

    await expect(proposal).rejects.toEqual(
      expect.objectContaining({
        kind: 'configuration',
        retryable: false,
        providerStatus: 401,
      }),
    )
  })

  test('classifies upstream HTTP failures consistently', async () => {
    const cases = [
      { status: 408, kind: 'timeout', retryable: true },
      { status: 524, kind: 'timeout', retryable: true },
      { status: 500, kind: 'unavailable', retryable: true },
      { status: 502, kind: 'unavailable', retryable: true },
      { status: 503, kind: 'unavailable', retryable: true },
      { status: 529, kind: 'unavailable', retryable: true },
      { status: 400, kind: 'configuration', retryable: false },
      { status: 402, kind: 'configuration', retryable: false },
      { status: 403, kind: 'configuration', retryable: false },
      { status: 404, kind: 'configuration', retryable: false },
      { status: 413, kind: 'configuration', retryable: false },
      { status: 422, kind: 'configuration', retryable: false },
    ] as const

    for (const expected of cases) {
      failure = providerError(expected.status)
      const proposal = new TaskAi({ apiKey: 'test-key' }).breakDownTask({
        task: { id: ids.coffee, title: 'Make coffee', durationSeconds: null, children: [] },
        detail: 3,
      })

      await expect(proposal).rejects.toEqual(
        expect.objectContaining({
          kind: expected.kind,
          retryable: expected.retryable,
          providerStatus: expected.status,
        }),
      )
    }
  })

  test('normalizes unknown failures as non-retryable', async () => {
    failure = new Error('sensitive unknown failure')

    const proposal = new TaskAi({ apiKey: 'test-key' }).breakDownTask({
      task: { id: ids.coffee, title: 'Make coffee', durationSeconds: null, children: [] },
      detail: 3,
    })

    await expect(proposal).rejects.toEqual(
      expect.objectContaining({ kind: 'unknown', retryable: false }),
    )
  })

  test('proposes one level of children for an actionable task', async () => {
    completion = JSON.stringify({
      children: [{ title: 'Get a mug' }, { title: 'Brew the coffee' }],
    })

    const taskAi = new TaskAi({ apiKey: 'test-key' })
    const proposal = await taskAi.breakDownTask({
      task: { id: ids.coffee, title: 'Make coffee', durationSeconds: null, children: [] },
      detail: 3,
    })

    expect(proposal).toEqual({
      taskId: ids.coffee,
      children: [{ title: 'Get a mug' }, { title: 'Brew the coffee' }],
    })
  })

  test('rejects an incomplete structured response', async () => {
    completion = '{}'

    const taskAi = new TaskAi({ apiKey: 'test-key' })
    const proposal = taskAi.breakDownTask({
      task: { id: ids.coffee, title: 'Make coffee', durationSeconds: null, children: [] },
      detail: 3,
    })

    await expect(proposal).rejects.toEqual(
      expect.objectContaining({
        name: 'TaskAiError',
        kind: 'invalid_response',
        retryable: true,
      }),
    )
    await proposal.catch((error) => {
      expect(error).toBeInstanceOf(TaskAiError)
    })
  })

  test('requires the OpenRouter provider to support structured outputs', async () => {
    completion = JSON.stringify({ children: [{ title: 'Get a mug' }] })

    const taskAi = new TaskAi({ apiKey: 'test-key' })
    await taskAi.breakDownTask({
      task: { id: ids.coffee, title: 'Make coffee', durationSeconds: null, children: [] },
      detail: 3,
    })

    expect(request).toMatchObject({
      chatRequest: { provider: { requireParameters: true } },
    })
  })

  test('proposes durations only for actionable tasks missing a duration', async () => {
    completion = JSON.stringify({
      durations: [
        { taskId: ids.water, durationSeconds: 30 },
        { taskId: ids.brew, durationSeconds: 240 },
      ],
    })

    const taskAi = new TaskAi({ apiKey: 'test-key' })
    const proposal = await taskAi.estimateTaskDurations({
      task: {
        id: ids.coffee,
        title: 'Make coffee',
        durationSeconds: null,
        children: [
          {
            id: ids.prepare,
            title: 'Prepare the coffee maker',
            durationSeconds: null,
            children: [
              { id: ids.water, title: 'Add water', durationSeconds: null, children: [] },
              {
                id: ids.grounds,
                title: 'Add coffee grounds',
                durationSeconds: 90,
                children: [],
              },
            ],
          },
          { id: ids.brew, title: 'Brew the coffee', durationSeconds: null, children: [] },
        ],
      },
    })

    expect(proposal).toEqual({
      taskId: ids.coffee,
      durations: [
        { taskId: ids.water, durationSeconds: 30 },
        { taskId: ids.brew, durationSeconds: 240 },
      ],
    })
  })

  test('rejects an incomplete task-duration response', async () => {
    completion = '{}'

    const taskAi = new TaskAi({ apiKey: 'test-key' })
    const proposal = taskAi.estimateTaskDurations({
      task: { id: ids.coffee, title: 'Make coffee', durationSeconds: null, children: [] },
    })

    await expect(proposal).rejects.toEqual(
      expect.objectContaining({ kind: 'invalid_response', retryable: true }),
    )
  })

  test('rejects durations for the wrong actionable tasks', async () => {
    completion = JSON.stringify({
      durations: [{ taskId: ids.brew, durationSeconds: 240 }],
    })

    const proposal = new TaskAi({ apiKey: 'test-key' }).estimateTaskDurations({
      task: { id: ids.coffee, title: 'Make coffee', durationSeconds: null, children: [] },
    })

    await expect(proposal).rejects.toEqual(
      expect.objectContaining({ kind: 'invalid_response', retryable: true }),
    )
  })

  test('proposes a dependency-aware order for immediate children', async () => {
    completion = JSON.stringify({
      orderedTaskIds: [ids.cook, ids.plate, ids.serve],
    })

    const taskAi = new TaskAi({ apiKey: 'test-key' })
    const proposal = await taskAi.optimizeSubtaskOrder({
      task: {
        id: ids.dinner,
        title: 'Make dinner',
        durationSeconds: null,
        children: [
          { id: ids.serve, title: 'Serve the food', durationSeconds: null, children: [] },
          { id: ids.cook, title: 'Cook the food', durationSeconds: null, children: [] },
          { id: ids.plate, title: 'Put the food on plates', durationSeconds: null, children: [] },
        ],
      },
    })

    expect(proposal).toEqual({
      taskId: ids.dinner,
      orderedTaskIds: [ids.cook, ids.plate, ids.serve],
    })
  })

  test('rejects an incomplete order-optimization response', async () => {
    completion = '{}'

    const taskAi = new TaskAi({ apiKey: 'test-key' })
    const proposal = taskAi.optimizeSubtaskOrder({
      task: {
        id: ids.dinner,
        title: 'Make dinner',
        durationSeconds: null,
        children: [{ id: ids.cook, title: 'Cook the food', durationSeconds: null, children: [] }],
      },
    })

    await expect(proposal).rejects.toEqual(
      expect.objectContaining({ kind: 'invalid_response', retryable: true }),
    )
  })
})
