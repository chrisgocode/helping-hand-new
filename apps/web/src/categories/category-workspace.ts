import type { components } from '@helping-hand/api-client'
import { api } from '../lib/api'
import { failureForStatus, WorkspaceError } from '../lib/workspace-error'

export type Category = components['schemas']['Category']
export type TaskCategoryAssignment = components['schemas']['TaskCategoryAssignment']

type CategoryMutation = 'create' | 'rename' | 'reorder'

class CategoryWorkspaceError extends WorkspaceError {
  constructor(kind: 'invalid' | 'conflict', message: string) {
    super(kind, false)
    this.name = 'CategoryWorkspaceError'
    this.message = message
  }
}

function failureForCategoryStatus(status: number, mutation?: CategoryMutation) {
  if (status === 400 && (mutation === 'create' || mutation === 'rename')) {
    return new CategoryWorkspaceError(
      'invalid',
      'Enter a category name between 1 and 100 characters.',
    )
  }
  if (status === 409 && (mutation === 'create' || mutation === 'rename')) {
    return new CategoryWorkspaceError('conflict', 'A category with this name already exists.')
  }
  if (status === 409 && mutation === 'reorder') {
    return new CategoryWorkspaceError(
      'conflict',
      'Categories changed elsewhere. Reload and try again.',
    )
  }
  return failureForStatus(status)
}

export async function listCategories(): Promise<Category[]> {
  try {
    const { data, error, response } = await api.GET('/api/categories')

    if (error) throw failureForStatus(response.status)
    if (!data) throw new WorkspaceError('unexpected', false)

    return data
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function createCategory(name: string): Promise<Category> {
  try {
    const { data, error, response } = await api.POST('/api/categories', { body: { name } })

    if (error) throw failureForCategoryStatus(response.status, 'create')
    if (!data) throw new WorkspaceError('unexpected', false)
    return data
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function renameCategory(categoryId: string, name: string): Promise<Category> {
  try {
    const { data, error, response } = await api.PATCH('/api/categories/{categoryId}', {
      params: { path: { categoryId } },
      body: { name },
    })

    if (error) throw failureForCategoryStatus(response.status, 'rename')
    if (!data) throw new WorkspaceError('unexpected', false)
    return data
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function deleteCategory(categoryId: string): Promise<void> {
  try {
    const { error, response } = await api.DELETE('/api/categories/{categoryId}', {
      params: { path: { categoryId } },
    })

    if (error) throw failureForCategoryStatus(response.status)
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function reorderCategories(categoryIds: string[]): Promise<Category[]> {
  try {
    const { data, error, response } = await api.PUT('/api/categories/order', {
      body: { categoryIds },
    })

    if (error) throw failureForCategoryStatus(response.status, 'reorder')
    if (!data) throw new WorkspaceError('unexpected', false)
    return data
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function assignTaskCategory(
  rootId: string,
  categoryId: string | null,
): Promise<TaskCategoryAssignment> {
  try {
    const { data, error, response } = await api.PATCH('/api/tasks/{rootId}/category', {
      params: { path: { rootId } },
      body: { categoryId },
    })

    if (error) throw failureForStatus(response.status)
    if (!data) throw new WorkspaceError('unexpected', false)

    return data
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}
