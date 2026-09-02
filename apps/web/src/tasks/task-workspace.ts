import type { components } from '@helping-hand/api-client'
import type { TaskDetail } from '@helping-hand/schemas'
import { api } from '../lib/api'

export type TaskTree = components['schemas']['TaskTree']
export type TaskTreeDraft = components['schemas']['TaskTreeDraft']
export type TaskBreakdownProposal = components['schemas']['TaskBreakdownProposal']
export type TaskDurationProposal = components['schemas']['TaskDurationProposal']
export type TaskOrderProposal = components['schemas']['OrderOptimizationProposal']
export type TaskWorkspaceFailureKind =
  | 'unauthenticated'
  | 'invalid'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'unavailable'
  | 'ai_timeout'
  | 'ai_invalid_response'
  | 'ai_configuration'
  | 'unexpected'

const failureMessages: Record<TaskWorkspaceFailureKind, string> = {
  unauthenticated: 'Your session has expired. Please sign in again.',
  invalid: 'Review the task and try saving it again.',
  not_found: 'This task could not be found.',
  conflict: 'This task changed before it could be saved.',
  rate_limited: 'Too many requests were made. Please wait a moment and try again.',
  unavailable: 'The task service is temporarily unavailable.',
  ai_timeout: 'AI generation took too long. Try again.',
  ai_invalid_response: 'Something went wrong. Please try again.',
  ai_configuration: 'AI generation is not configured correctly.',
  unexpected: 'The task request could not be completed.',
}

export class TaskWorkspaceError extends Error {
  readonly kind: TaskWorkspaceFailureKind
  readonly retryable: boolean

  constructor(kind: TaskWorkspaceFailureKind, retryable: boolean, options?: ErrorOptions) {
    super(failureMessages[kind], options)
    this.name = 'TaskWorkspaceError'
    this.kind = kind
    this.retryable = retryable
  }
}

function failureForStatus(status: number) {
  if (status === 401) return new TaskWorkspaceError('unauthenticated', false)
  if (status === 400) return new TaskWorkspaceError('invalid', false)
  if (status === 404) return new TaskWorkspaceError('not_found', false)
  if (status === 409) return new TaskWorkspaceError('conflict', false)
  if (status === 429) return new TaskWorkspaceError('rate_limited', true)
  if (status >= 500) return new TaskWorkspaceError('unavailable', true)
  return new TaskWorkspaceError('unexpected', false)
}

function failureForAiStatus(status: number) {
  if (status === 500) return new TaskWorkspaceError('ai_configuration', false)
  if (status === 502) return new TaskWorkspaceError('ai_invalid_response', true)
  if (status === 504) return new TaskWorkspaceError('ai_timeout', true)
  return failureForStatus(status)
}

export async function saveTaskTree(draft: TaskTreeDraft): Promise<TaskTree> {
  try {
    const { data, error, response } = await api.PUT('/api/tasks/{rootId}', {
      params: { path: { rootId: draft.id } },
      body: draft,
    })

    if (error) throw failureForStatus(response.status)
    if (!data) throw new TaskWorkspaceError('unexpected', false)

    return data
  } catch (cause) {
    if (cause instanceof TaskWorkspaceError) throw cause
    throw new TaskWorkspaceError('unavailable', true, { cause })
  }
}

export async function listTaskTrees(): Promise<TaskTree[]> {
  try {
    const { data, error, response } = await api.GET('/api/tasks')

    if (error) throw failureForStatus(response.status)
    if (!data) throw new TaskWorkspaceError('unexpected', false)

    return data
  } catch (cause) {
    if (cause instanceof TaskWorkspaceError) throw cause
    throw new TaskWorkspaceError('unavailable', true, { cause })
  }
}

export async function deleteTaskTree(rootId: string, revision: number): Promise<void> {
  try {
    const { error, response } = await api.DELETE('/api/tasks/{rootId}', {
      params: { path: { rootId } },
      body: { revision },
    })

    if (error) throw failureForStatus(response.status)
  } catch (cause) {
    if (cause instanceof TaskWorkspaceError) throw cause
    throw new TaskWorkspaceError('unavailable', true, { cause })
  }
}

export async function proposeTaskBreakdown(
  draft: TaskTreeDraft,
  taskId: string,
  detail: TaskDetail,
): Promise<TaskBreakdownProposal> {
  try {
    const { data, error, response } = await api.POST('/api/tasks/proposals/breakdown', {
      body: { draft, taskId, detail },
    })

    if (error) throw failureForAiStatus(response.status)
    if (!data) throw new TaskWorkspaceError('unexpected', false)
    return data
  } catch (cause) {
    if (cause instanceof TaskWorkspaceError) throw cause
    throw new TaskWorkspaceError('unavailable', true, { cause })
  }
}

export async function proposeTaskDurations(
  draft: TaskTreeDraft,
  taskId: string,
): Promise<TaskDurationProposal> {
  try {
    const { data, error, response } = await api.POST('/api/tasks/proposals/durations', {
      body: { draft, taskId },
    })

    if (error) throw failureForAiStatus(response.status)
    if (!data) throw new TaskWorkspaceError('unexpected', false)
    return data
  } catch (cause) {
    if (cause instanceof TaskWorkspaceError) throw cause
    throw new TaskWorkspaceError('unavailable', true, { cause })
  }
}

export async function proposeTaskOrder(
  draft: TaskTreeDraft,
  taskId: string,
): Promise<TaskOrderProposal> {
  try {
    const { data, error, response } = await api.POST('/api/tasks/proposals/order', {
      body: { draft, taskId },
    })

    if (error) throw failureForAiStatus(response.status)
    if (!data) throw new TaskWorkspaceError('unexpected', false)
    return data
  } catch (cause) {
    if (cause instanceof TaskWorkspaceError) throw cause
    throw new TaskWorkspaceError('unavailable', true, { cause })
  }
}
