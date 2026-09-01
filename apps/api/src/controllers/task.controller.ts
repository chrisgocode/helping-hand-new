import type { RouteHandler } from '@hono/zod-openapi'
import type { Context, ErrorHandler } from 'hono'
import { problem } from '../lib/problem'
import type {
  deleteTaskTreeRoute,
  getTaskTreesRoute,
  proposeTaskBreakdownRoute,
  proposeTaskDurationsRoute,
  proposeTaskOrderRoute,
  saveTaskTreeRoute,
} from '../schemas/task.schema'
import { TaskService, TaskServiceError } from '../services/task.service'
import { TaskAi, TaskAiError, type TaskAiFailureKind } from '../services/task-ai'
import type { TaskRouteEnv } from '../types/task'

const aiProblems = {
  timeout: {
    status: 504,
    type: 'urn:helping-hand:problem:ai-timeout',
    title: 'AI generation timed out',
    detail: 'The AI service did not respond in time. Try again.',
  },
  unavailable: {
    status: 503,
    type: 'urn:helping-hand:problem:ai-unavailable',
    title: 'AI generation is temporarily unavailable',
    detail: 'The AI service is temporarily unavailable. Try again.',
  },
  invalid_response: {
    status: 502,
    type: 'urn:helping-hand:problem:ai-invalid-response',
    title: 'AI generation returned an invalid response',
    detail: 'The AI service returned an unusable response. Try again.',
  },
  configuration: {
    status: 500,
    type: 'urn:helping-hand:problem:internal-error',
    title: 'Internal server error',
    detail: 'The request could not be completed.',
  },
  unknown: {
    status: 500,
    type: 'urn:helping-hand:problem:internal-error',
    title: 'Internal server error',
    detail: 'The request could not be completed.',
  },
} as const satisfies Record<
  TaskAiFailureKind,
  { status: 500 | 502 | 503 | 504; type: string; title: string; detail: string }
>

function taskService(c: Context<TaskRouteEnv>) {
  return new TaskService({
    database: c.env.database,
    taskAi: new TaskAi({
      apiKey: c.env.OPENROUTER_API_KEY,
      model: c.env.OPENROUTER_MODEL,
    }),
  })
}

export const getTaskTrees: RouteHandler<typeof getTaskTreesRoute, TaskRouteEnv> = async (c) =>
  c.json(await taskService(c).getTaskTrees(c.get('authenticatedUserId')), 200)

export const saveTaskTree: RouteHandler<typeof saveTaskTreeRoute, TaskRouteEnv> = async (c) => {
  const draft = c.req.valid('json')
  const { rootId } = c.req.valid('param')
  if (draft.id !== rootId) {
    return problem(
      c,
      {
        type: 'urn:helping-hand:problem:validation',
        title: 'Invalid request',
        detail: 'Route and task tree IDs must match.',
        retryable: false,
      },
      400,
    )
  }
  return c.json(await taskService(c).saveTaskTree(c.get('authenticatedUserId'), draft), 200)
}

export const deleteTaskTree: RouteHandler<typeof deleteTaskTreeRoute, TaskRouteEnv> = async (c) => {
  const { rootId } = c.req.valid('param')
  await taskService(c).deleteTaskTree(
    c.get('authenticatedUserId'),
    rootId,
    c.req.valid('json').revision,
  )
  return c.body(null, 204)
}

export const proposeBreakdown: RouteHandler<
  typeof proposeTaskBreakdownRoute,
  TaskRouteEnv
> = async (c) => {
  c.set('aiRequestObserved', true)
  const { draft, taskId, detail } = c.req.valid('json')
  return c.json(await taskService(c).proposeBreakdown(c.get('userId'), draft, taskId, detail), 200)
}

export const proposeDurations: RouteHandler<
  typeof proposeTaskDurationsRoute,
  TaskRouteEnv
> = async (c) => {
  c.set('aiRequestObserved', true)
  const { draft, taskId } = c.req.valid('json')
  return c.json(await taskService(c).proposeDurations(c.get('userId'), draft, taskId), 200)
}

export const proposeOrder: RouteHandler<typeof proposeTaskOrderRoute, TaskRouteEnv> = async (c) => {
  c.set('aiRequestObserved', true)
  const { draft, taskId } = c.req.valid('json')
  return c.json(await taskService(c).proposeOrder(c.get('userId'), draft, taskId), 200)
}

export const handleTaskError: ErrorHandler<TaskRouteEnv> = (error, c) => {
  if (error instanceof TaskAiError) {
    c.set('aiFailureKind', error.kind)
    c.set('aiProviderStatus', error.providerStatus)
    const { status, ...details } = aiProblems[error.kind]
    const headers =
      error.retryAfterSeconds === undefined
        ? undefined
        : { 'Retry-After': String(error.retryAfterSeconds) }
    return problem(c, { ...details, retryable: error.retryable }, status, headers)
  }
  if (!(error instanceof TaskServiceError)) {
    c.get('logger').error({
      event: 'unhandled_error',
      code: 'internal_error',
      route: c.req.routePath,
    })
    return problem(
      c,
      {
        type: 'urn:helping-hand:problem:internal-error',
        title: 'Internal server error',
        detail: 'The request could not be completed.',
        retryable: false,
      },
      500,
    )
  }
  if (error.code === 'unauthorized') {
    return problem(
      c,
      {
        type: 'urn:helping-hand:problem:unauthorized',
        title: 'Authentication required',
        detail: error.message,
        retryable: false,
      },
      401,
    )
  }
  if (error.code === 'invalid') {
    return problem(
      c,
      {
        type: 'urn:helping-hand:problem:validation',
        title: 'Invalid request',
        detail: error.message,
        retryable: false,
      },
      400,
    )
  }
  if (error.code === 'not_found') {
    return problem(
      c,
      {
        type: 'urn:helping-hand:problem:not-found',
        title: 'Task not found',
        detail: error.message,
        retryable: false,
      },
      404,
    )
  }
  return problem(
    c,
    {
      type: 'urn:helping-hand:problem:conflict',
      title: 'Task conflict',
      detail: error.message,
      retryable: false,
    },
    409,
  )
}
