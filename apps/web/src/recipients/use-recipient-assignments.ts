import { useCallback, useEffect, useRef, useState } from 'react'
import { WorkspaceError } from '../lib/workspace-error'
import {
  assignRecipientTask,
  listRecipientAssignments,
  type RecipientAssignment,
  unassignRecipientTask,
} from './recipient-workspace'

export type AssignmentAction = 'assign' | 'unassign'
export type AssignmentMutation =
  | { status: 'idle' }
  | { status: 'pending'; action: AssignmentAction; taskId: string }
  | { status: 'failed'; action: AssignmentAction; taskId: string; error: WorkspaceError }

type AssignmentState = {
  assignments: RecipientAssignment[]
  status: 'loading' | 'ready' | 'error'
  error: WorkspaceError | null
}

export function useRecipientAssignments(recipientId: string) {
  const requestId = useRef(0)
  const inFlight = useRef(false)
  const assignmentsRef = useRef<RecipientAssignment[]>([])
  const [mutation, setMutation] = useState<AssignmentMutation>({ status: 'idle' })
  const [announcement, setAnnouncement] = useState('')
  const [state, setState] = useState<AssignmentState>({
    assignments: [],
    status: 'loading',
    error: null,
  })

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setState((current) => ({ ...current, status: 'loading', error: null }))

    try {
      const assignments = await listRecipientAssignments(recipientId)
      if (requestId.current === currentRequest) {
        assignmentsRef.current = assignments
        setState({ assignments, status: 'ready', error: null })
      }
    } catch (cause) {
      if (requestId.current === currentRequest) {
        const error =
          cause instanceof WorkspaceError
            ? cause
            : new WorkspaceError('unexpected', false, { cause })
        setState((current) => ({ ...current, status: 'error', error }))
      }
    }
  }, [recipientId])

  useEffect(() => {
    void load()
    return () => {
      requestId.current += 1
    }
  }, [load])

  useEffect(() => {
    if (!announcement) return
    const timeout = window.setTimeout(() => setAnnouncement(''), 4000)
    return () => window.clearTimeout(timeout)
  }, [announcement])

  const commit = useCallback((assignments: RecipientAssignment[]) => {
    assignmentsRef.current = assignments
    setState((current) => ({ ...current, assignments }))
  }, [])

  const assign = useCallback(
    async (taskId: string, title: string, recipientName: string): Promise<boolean> => {
      if (inFlight.current) return false
      inFlight.current = true
      setAnnouncement('')
      setMutation({ status: 'pending', action: 'assign', taskId })

      const previous = assignmentsRef.current
      commit([...previous, { rootTaskId: taskId, createdAt: new Date().toISOString() }])

      try {
        await assignRecipientTask(recipientId, taskId)
        setMutation({ status: 'idle' })
        setAnnouncement(`${title} assigned to ${recipientName}.`)
        return true
      } catch (cause) {
        commit(previous)
        const error =
          cause instanceof WorkspaceError
            ? cause
            : new WorkspaceError('unexpected', false, { cause })
        setMutation({ status: 'failed', action: 'assign', taskId, error })
        return false
      } finally {
        inFlight.current = false
      }
    },
    [commit, recipientId],
  )

  const unassign = useCallback(
    async (taskId: string, title: string, recipientName: string): Promise<boolean> => {
      if (inFlight.current) return false
      inFlight.current = true
      setAnnouncement('')
      setMutation({ status: 'pending', action: 'unassign', taskId })

      const previous = assignmentsRef.current
      commit(previous.filter((assignment) => assignment.rootTaskId !== taskId))

      try {
        await unassignRecipientTask(recipientId, taskId)
        setMutation({ status: 'idle' })
        setAnnouncement(`${title} removed from ${recipientName}.`)
        return true
      } catch (cause) {
        commit(previous)
        const error =
          cause instanceof WorkspaceError
            ? cause
            : new WorkspaceError('unexpected', false, { cause })
        setMutation({ status: 'failed', action: 'unassign', taskId, error })
        return false
      } finally {
        inFlight.current = false
      }
    },
    [commit, recipientId],
  )

  const dismissMutationError = useCallback(() => setMutation({ status: 'idle' }), [])

  return {
    assignments: state.assignments,
    status: state.status,
    error: state.error,
    mutation,
    announcement,
    retry: load,
    assign,
    unassign,
    dismissMutationError,
  }
}
