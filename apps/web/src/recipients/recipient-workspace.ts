import type { components } from '@helping-hand/api-client'
import { api } from '../lib/api'
import { failureForStatus, WorkspaceError } from '../lib/workspace-error'

export type Recipient = components['schemas']['Recipient']
export type RecipientAssignment = components['schemas']['RecipientAssignment']

type RecipientAction = 'create' | 'rename' | 'update' | 'delete' | 'revoke' | 'assign' | 'unassign'

class RecipientWorkspaceError extends WorkspaceError {
  constructor(kind: 'invalid' | 'not_found' | 'conflict', message: string) {
    super(kind, false)
    this.name = 'RecipientWorkspaceError'
    this.message = message
  }
}

function failureForRecipientStatus(status: number, action?: RecipientAction) {
  if (status === 400 && (action === 'create' || action === 'rename')) {
    return new RecipientWorkspaceError('invalid', 'Enter a name between 1 and 100 characters.')
  }
  if (status === 400 && action === 'assign') {
    return new RecipientWorkspaceError(
      'invalid',
      'Only a whole task can be assigned. Choose a task from your library.',
    )
  }
  if (status === 404 && action === 'assign') {
    return new RecipientWorkspaceError('not_found', 'That recipient or task could not be found.')
  }
  if (status === 404) {
    return new RecipientWorkspaceError('not_found', 'This recipient could not be found.')
  }
  if (status === 409 && action === 'create') {
    return new RecipientWorkspaceError(
      'conflict',
      'You can support up to 25 recipients. Delete one before adding another.',
    )
  }
  if (status === 409 && action === 'assign') {
    return new RecipientWorkspaceError(
      'conflict',
      'This recipient already has 50 assigned tasks. Remove one before assigning another.',
    )
  }
  return failureForStatus(status)
}

export async function listRecipients(): Promise<Recipient[]> {
  try {
    const { data, error, response } = await api.GET('/api/recipients')

    if (error) throw failureForStatus(response.status)
    if (!data) throw new WorkspaceError('unexpected', false)

    return data
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function createRecipient(displayName: string): Promise<Recipient> {
  try {
    const { data, error, response } = await api.POST('/api/recipients', { body: { displayName } })

    if (error) throw failureForRecipientStatus(response.status, 'create')
    if (!data) throw new WorkspaceError('unexpected', false)

    return data
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function updateRecipient(
  recipientId: string,
  changes: { displayName?: string; isActive?: boolean },
): Promise<Recipient> {
  const action = changes.displayName === undefined ? 'update' : 'rename'

  try {
    const { data, error, response } = await api.PATCH('/api/recipients/{recipientId}', {
      params: { path: { recipientId } },
      body: changes,
    })

    if (error) throw failureForRecipientStatus(response.status, action)
    if (!data) throw new WorkspaceError('unexpected', false)

    return data
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function deleteRecipient(recipientId: string): Promise<void> {
  try {
    const { response } = await api.DELETE('/api/recipients/{recipientId}', {
      params: { path: { recipientId } },
    })

    if (!response.ok) throw failureForRecipientStatus(response.status, 'delete')
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function revokeRecipientAccess(recipientId: string): Promise<void> {
  try {
    // A 204 carries no body, so openapi-fetch reports no error either way.
    const { response } = await api.DELETE('/api/recipients/{recipientId}/session', {
      params: { path: { recipientId } },
    })

    if (!response.ok) throw failureForRecipientStatus(response.status, 'revoke')
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function listRecipientAssignments(
  recipientId: string,
): Promise<RecipientAssignment[]> {
  try {
    const { data, error, response } = await api.GET('/api/recipients/{recipientId}/tasks', {
      params: { path: { recipientId } },
    })

    if (error) throw failureForRecipientStatus(response.status)
    if (!data) throw new WorkspaceError('unexpected', false)

    return data
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function assignRecipientTask(recipientId: string, taskId: string): Promise<void> {
  try {
    const { response } = await api.PUT('/api/recipients/{recipientId}/tasks/{taskId}', {
      params: { path: { recipientId, taskId } },
    })

    if (!response.ok) throw failureForRecipientStatus(response.status, 'assign')
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function unassignRecipientTask(recipientId: string, taskId: string): Promise<void> {
  try {
    const { response } = await api.DELETE('/api/recipients/{recipientId}/tasks/{taskId}', {
      params: { path: { recipientId, taskId } },
    })

    if (!response.ok) throw failureForRecipientStatus(response.status, 'unassign')
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}
