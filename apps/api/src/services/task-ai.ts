import type { TaskNode } from '@helping-hand/schemas'
import { OpenRouter } from '@openrouter/sdk'
import {
  ConnectionError,
  InvalidRequestError,
  OpenRouterError,
  RequestTimeoutError,
  ResponseValidationError,
  SDKValidationError,
} from '@openrouter/sdk/models/errors'
import { z } from 'zod'

export type TaskAiFailureKind =
  | 'timeout'
  | 'unavailable'
  | 'invalid_response'
  | 'configuration'
  | 'unknown'

const failureMessages: Record<TaskAiFailureKind, string> = {
  timeout: 'AI generation timed out',
  unavailable: 'AI generation is temporarily unavailable',
  invalid_response: 'AI generation returned an invalid response',
  configuration: 'AI generation is not configured correctly',
  unknown: 'AI generation failed',
}

export class TaskAiError extends Error {
  readonly retryable: boolean

  constructor(
    readonly kind: TaskAiFailureKind,
    {
      cause,
      providerStatus,
      retryAfterSeconds,
    }: { cause?: unknown; providerStatus?: number; retryAfterSeconds?: number } = {},
  ) {
    super(failureMessages[kind], { cause })
    this.name = 'TaskAiError'
    this.retryable = kind === 'timeout' || kind === 'unavailable' || kind === 'invalid_response'
    this.providerStatus = providerStatus
    this.retryAfterSeconds = retryAfterSeconds
  }

  readonly providerStatus?: number
  readonly retryAfterSeconds?: number
}

function retryAfterSeconds(error: OpenRouterError) {
  if (error.statusCode !== 429 && error.statusCode !== 503) return undefined
  const value = error.headers.get('retry-after')
  if (!value || !/^\d+$/.test(value)) return undefined
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) && seconds <= 3600 ? seconds : undefined
}

function normalizeFailure(cause: unknown): TaskAiError {
  if (cause instanceof TaskAiError) return cause
  if (cause instanceof RequestTimeoutError) return new TaskAiError('timeout', { cause })
  if (cause instanceof ConnectionError) return new TaskAiError('unavailable', { cause })
  if (cause instanceof ResponseValidationError) {
    return new TaskAiError('invalid_response', {
      cause,
      providerStatus: cause.statusCode,
    })
  }
  if (cause instanceof InvalidRequestError || cause instanceof SDKValidationError) {
    return new TaskAiError('configuration', { cause })
  }
  if (cause instanceof OpenRouterError) {
    const providerStatus = cause.statusCode
    if (providerStatus === 408 || providerStatus === 524) {
      return new TaskAiError('timeout', { cause, providerStatus })
    }
    if (providerStatus === 429 || providerStatus >= 500) {
      return new TaskAiError('unavailable', {
        cause,
        providerStatus,
        retryAfterSeconds: retryAfterSeconds(cause),
      })
    }
    if (providerStatus >= 400 && providerStatus < 500) {
      return new TaskAiError('configuration', { cause, providerStatus })
    }
  }
  return new TaskAiError('unknown', { cause })
}

export type TaskBreakdownSuggestion = {
  taskId: string
  children: Array<{ title: string }>
}

export type TaskDurationSuggestion = {
  taskId: string
  durations: Array<{ taskId: string; durationSeconds: number }>
}

export type OrderOptimizationSuggestion = {
  taskId: string
  orderedTaskIds: string[]
}

export type TaskAiBindings = {
  OPENROUTER_API_KEY: string
  OPENROUTER_MODEL?: string
}

export type TaskAiOptions = {
  apiKey: string
  model?: string
}

const breakdownSchema = z.strictObject({
  children: z.array(z.strictObject({ title: z.string().trim().min(1).max(200) })).min(1),
})

const durationSchema = z.strictObject({
  durations: z.array(
    z.strictObject({
      taskId: z.string().min(1),
      durationSeconds: z.number().int().nonnegative(),
    }),
  ),
})

const orderSchema = z.strictObject({
  orderedTaskIds: z.array(z.string().min(1)),
})

export class TaskAi {
  readonly #openrouter: OpenRouter
  readonly #model: string

  constructor({ apiKey, model = 'openrouter/free' }: TaskAiOptions) {
    if (!apiKey) throw new TaskAiError('configuration')

    this.#openrouter = new OpenRouter({
      apiKey,
      timeoutMs: 30_000,
      retryConfig: { strategy: 'none' },
    })
    this.#model = model
  }

  async #complete<T>({
    name,
    schema,
    system,
    input,
  }: {
    name: string
    schema: z.ZodType<T>
    system: string
    input: unknown
  }): Promise<T> {
    try {
      const response = await this.#openrouter.chat.send({
        chatRequest: {
          model: this.#model,
          provider: { requireParameters: true },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(input) },
          ],
          responseFormat: {
            type: 'json_schema',
            jsonSchema: {
              name,
              strict: true,
              schema: z.toJSONSchema(schema),
            },
          },
        },
      })

      if (response instanceof ReadableStream) {
        throw new TaskAiError('invalid_response')
      }

      const content = response.choices[0]?.message.content
      if (typeof content !== 'string') {
        throw new TaskAiError('invalid_response')
      }

      try {
        return schema.parse(JSON.parse(content))
      } catch (cause) {
        throw new TaskAiError('invalid_response', { cause })
      }
    } catch (cause) {
      throw normalizeFailure(cause)
    }
  }

  async breakDownTask({
    task,
    detail,
  }: {
    task: TaskNode
    detail: 1 | 2 | 3 | 4 | 5
  }): Promise<TaskBreakdownSuggestion> {
    if (task.children.length > 0) {
      throw new Error('Only an actionable task can be broken down')
    }

    const result = await this.#complete({
      name: 'task_breakdown',
      schema: breakdownSchema,
      system:
        'Break an actionable task into one level of clear, ordered children. Detail is from 1 to 5: 1 produces a few broad children and 5 produces many small children. Return only the requested JSON. Do not include nested children.',
      input: { title: task.title, detail },
    })

    return { taskId: task.id, children: result.children }
  }

  async estimateTaskDurations({ task }: { task: TaskNode }): Promise<TaskDurationSuggestion> {
    const missing: Array<{ id: string; title: string }> = []

    const visit = (node: TaskNode) => {
      if (node.children.length === 0) {
        if (node.durationSeconds == null) missing.push({ id: node.id, title: node.title })
        return
      }

      node.children.forEach(visit)
    }

    visit(task)
    if (missing.length === 0) return { taskId: task.id, durations: [] }

    // TODO: Consider opt-in support-needs personalization only after a privacy review;
    // keep generated tasks and estimates generic and user-editable until then.
    const result = await this.#complete({
      name: 'task_durations',
      schema: durationSchema,
      system:
        'Estimate the approximate total elapsed seconds for every provided actionable task, including waiting. Use generic assumptions. Return every task ID exactly once and return only the requested JSON.',
      input: { context: task.title, actionableTasks: missing },
    })

    const expectedIds = new Set(missing.map(({ id }) => id))
    const actualIds = result.durations.map(({ taskId }) => taskId)

    if (
      actualIds.length !== expectedIds.size ||
      new Set(actualIds).size !== actualIds.length ||
      actualIds.some((id) => !expectedIds.has(id))
    ) {
      throw new TaskAiError('invalid_response')
    }

    return { taskId: task.id, durations: result.durations }
  }

  async optimizeSubtaskOrder({ task }: { task: TaskNode }): Promise<OrderOptimizationSuggestion> {
    if (task.children.length === 0) {
      throw new Error('Only a summary task can have its order optimized')
    }

    const result = await this.#complete({
      name: 'subtask_order_optimization',
      schema: orderSchema,
      system:
        'Order the immediate children so prerequisites come before dependent work. Do not use duration or importance. Preserve the current order when no dependency requires a change. Return every provided child ID exactly once and return only the requested JSON.',
      input: {
        summaryTask: task.title,
        children: task.children.map(({ id, title }) => ({ id, title })),
      },
    })

    const expectedIds = new Set(task.children.map(({ id }) => id))
    const actualIds = result.orderedTaskIds

    if (
      actualIds.length !== expectedIds.size ||
      new Set(actualIds).size !== actualIds.length ||
      actualIds.some((id) => !expectedIds.has(id))
    ) {
      throw new TaskAiError('invalid_response')
    }

    return { taskId: task.id, orderedTaskIds: actualIds }
  }
}
