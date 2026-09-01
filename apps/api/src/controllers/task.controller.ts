import type { Context, ErrorHandler, Handler } from 'hono'
import { problem } from '../lib/problem'
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

export const getTaskTrees: Handler<TaskRouteEnv> = async (c) =>
  c.json(await taskService(c).getTaskTrees(c.get('authenticatedUserId')))

export const saveTaskTree: Handler<TaskRouteEnv> = async (c) => {
  const draft = c.get('saveTaskInput')
  if (draft.id !== c.get('rootId'))
    return c.json({ error: 'Route and task tree IDs must match' }, 400)
  return c.json(await taskService(c).saveTaskTree(c.get('authenticatedUserId'), draft))
}

export const deleteTaskTree: Handler<TaskRouteEnv> = async (c) => {
  await taskService(c).deleteTaskTree(
    c.get('authenticatedUserId'),
    c.get('rootId'),
    c.get('deleteTaskInput').revision,
  )
  return c.body(null, 204)
}

export const proposeBreakdown: Handler<TaskRouteEnv> = async (c) => {
  const { draft, taskId, detail } = c.get('breakdownProposalInput')
  return c.json(await taskService(c).proposeBreakdown(c.get('userId'), draft, taskId, detail))
}

export const proposeDurations: Handler<TaskRouteEnv> = async (c) => {
  const { draft, taskId } = c.get('taskProposalInput')
  return c.json(await taskService(c).proposeDurations(c.get('userId'), draft, taskId))
}

export const proposeOrder: Handler<TaskRouteEnv> = async (c) => {
  const { draft, taskId } = c.get('taskProposalInput')
  return c.json(await taskService(c).proposeOrder(c.get('userId'), draft, taskId))
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
    return c.json({ error: 'Internal server error' }, 500)
  }
  if (error.code === 'unauthorized') return c.json({ error: error.message }, 401)
  if (error.code === 'invalid') return c.json({ error: error.message }, 400)
  if (error.code === 'not_found') return c.json({ error: error.message }, 404)
  return c.json({ error: error.message }, 409)
}
