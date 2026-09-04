import type { components } from '@helping-hand/api-client'
import type { TaskDetail } from '@helping-hand/schemas'
import { api } from '../lib/api'
import { failureForStatus, WorkspaceError as TaskWorkspaceError } from '../lib/workspace-error'

export {
  WorkspaceError as TaskWorkspaceError,
  type WorkspaceFailureKind as TaskWorkspaceFailureKind,
} from '../lib/workspace-error'

export type TaskTree = components['schemas']['TaskTree']
export type TaskTreeDraft = components['schemas']['TaskTreeDraft']
export type TaskBreakdownProposal = components['schemas']['TaskBreakdownProposal']
export type TaskDurationProposal = components['schemas']['TaskDurationProposal']
export type TaskOrderProposal = components['schemas']['OrderOptimizationProposal']

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
