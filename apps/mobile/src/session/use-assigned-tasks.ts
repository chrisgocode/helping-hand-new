import type { RecipientTaskTree } from '@helping-hand/schemas'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EnrollmentStorage } from '../enrollment/enrollment-storage'
import { AssignedTasksApiError } from './assigned-tasks-api'

/** The one request this hook makes, as a seam tests can stand in for. */
export type AssignedTasksApi = {
  getAssignedTaskTrees(token: string): Promise<RecipientTaskTree[]>
}

export type AssignedTasksDependencies = {
  storage: EnrollmentStorage
  api: AssignedTasksApi
}

export type AssignedTasksState =
  | { status: 'loading' }
  | { status: 'ready'; trees: RecipientTaskTree[] }
  | { status: 'unenrolled' }
  | { status: 'revoked' }
  | { status: 'error'; message: string }

export type AssignedTasksController = {
  readonly state: AssignedTasksState
  reload(): Promise<void>
}

/**
 * Loads what this device has been assigned.
 *
 * The token is read from storage rather than taken as an argument, so it never
 * travels through navigation. An enrollment that is missing or no longer
 * accepted is a state of its own: the recipient is told to see their caretaker
 * rather than shown an empty list they cannot explain.
 */
export function useAssignedTasks({ storage, api }: AssignedTasksDependencies) {
  const [state, setState] = useState<AssignedTasksState>({ status: 'loading' })

  // Dependencies are read through a ref so that loading is tied to mounting
  // rather than to the identity of the objects passed in. A caller constructing
  // them inline would otherwise reload on every render it caused.
  const dependencies = useRef({ storage, api })
  dependencies.current = { storage, api }

  const load = useCallback(async () => {
    setState({ status: 'loading' })

    const { storage: store, api: client } = dependencies.current

    try {
      // Restoring reads secure storage, which can reject. Left outside this
      // block it produced an unhandled rejection and the screen stayed on
      // "loading" with nothing to act on.
      const restored = await store.restore()
      if (restored.status !== 'active') {
        setState({ status: 'unenrolled' })
        return
      }

      setState({
        status: 'ready',
        trees: await client.getAssignedTaskTrees(restored.session.token),
      })
    } catch (error) {
      if (error instanceof AssignedTasksApiError && error.revoked) {
        setState({ status: 'revoked' })
        return
      }

      setState({
        status: 'error',
        message:
          error instanceof AssignedTasksApiError
            ? error.message
            : 'The assigned routines could not be loaded.',
      })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { state, reload: load }
}
