import { useCallback, useEffect, useRef, useState } from 'react'
import { listTaskTrees, type TaskTree, TaskWorkspaceError } from './task-workspace'

type TaskLibraryState = {
  tasks: TaskTree[]
  status: 'loading' | 'ready' | 'error'
  error: TaskWorkspaceError | null
}

export function useTaskLibrary() {
  const requestId = useRef(0)
  const [state, setState] = useState<TaskLibraryState>({
    tasks: [],
    status: 'loading',
    error: null,
  })

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setState((current) => ({ ...current, status: 'loading', error: null }))

    try {
      const tasks = await listTaskTrees()
      if (requestId.current === currentRequest) {
        setState({ tasks, status: 'ready', error: null })
      }
    } catch (cause) {
      if (requestId.current === currentRequest) {
        const error =
          cause instanceof TaskWorkspaceError
            ? cause
            : new TaskWorkspaceError('unexpected', false, { cause })
        setState((current) => ({ ...current, status: 'error', error }))
      }
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      requestId.current += 1
    }
  }, [load])

  return { ...state, retry: load }
}
