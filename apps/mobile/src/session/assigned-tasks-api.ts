import type { RecipientTaskTree } from '@helping-hand/schemas'
import { recipientApi } from '@/lib/api'

export class AssignedTasksApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AssignedTasksApiError'
  }

  /**
   * The device's access is gone rather than unreachable. Retrying cannot repair
   * it; the recipient has to be enrolled again.
   */
  get revoked() {
    return this.status === 401 || this.status === 403
  }
}

/**
 * The complete task trees assigned to this device. Access checks run on every
 * request, so a revoked device learns it has been revoked here rather than from
 * stale local state.
 */
export async function getAssignedTaskTrees(token: string): Promise<RecipientTaskTree[]> {
  const { data, error, response } = await recipientApi(token).GET('/api/recipient/tasks')

  if (!data) {
    const detail =
      typeof error === 'object' && error && 'detail' in error && typeof error.detail === 'string'
        ? error.detail
        : 'The assigned routines could not be loaded.'
    throw new AssignedTasksApiError(response.status, detail)
  }

  return data
}
