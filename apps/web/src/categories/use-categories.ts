import { useCallback, useEffect, useRef, useState } from 'react'
import { WorkspaceError } from '../lib/workspace-error'
import {
  assignTaskCategory,
  type Category,
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  reorderCategories,
  type TaskCategoryAssignment,
} from './category-workspace'

export type CategoryAction = 'create' | 'rename' | 'delete' | 'reorder' | 'assign'
export type CategoryMutation =
  | { status: 'idle' }
  | { status: 'pending'; action: CategoryAction; targetId?: string }
  | { status: 'failed'; action: CategoryAction; targetId?: string; error: WorkspaceError }

type CategoryState = {
  categories: Category[]
  status: 'loading' | 'ready' | 'error'
  error: WorkspaceError | null
}

export function useCategories() {
  const requestId = useRef(0)
  const inFlight = useRef(false)
  const categoriesRef = useRef<Category[]>([])
  const [mutation, setMutation] = useState<CategoryMutation>({ status: 'idle' })
  const [announcement, setAnnouncement] = useState('')
  const [state, setState] = useState<CategoryState>({
    categories: [],
    status: 'loading',
    error: null,
  })

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setState((current) => ({ ...current, status: 'loading', error: null }))

    try {
      const categories = await listCategories()
      if (requestId.current === currentRequest) {
        categoriesRef.current = categories
        setState({ categories, status: 'ready', error: null })
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
  }, [])

  useEffect(() => {
    void load()
    return () => {
      requestId.current += 1
    }
  }, [load])

  const beginMutation = useCallback((action: CategoryAction, targetId?: string) => {
    if (inFlight.current) return false
    inFlight.current = true
    setAnnouncement('')
    setMutation({ status: 'pending', action, targetId })
    return true
  }, [])

  const failMutation = useCallback(
    (action: CategoryAction, targetId: string | undefined, cause: unknown) => {
      const error =
        cause instanceof WorkspaceError ? cause : new WorkspaceError('unexpected', false, { cause })
      setMutation({ status: 'failed', action, targetId, error })
    },
    [],
  )

  const create = useCallback(
    async (name: string): Promise<Category | null> => {
      if (!beginMutation('create')) return null
      try {
        const category = await createCategory(name)
        const categories = [...categoriesRef.current, category]
        categoriesRef.current = categories
        setState((current) => ({ ...current, categories }))
        setMutation({ status: 'idle' })
        setAnnouncement(`${category.name} added.`)
        return category
      } catch (cause) {
        failMutation('create', undefined, cause)
        return null
      } finally {
        inFlight.current = false
      }
    },
    [beginMutation, failMutation],
  )

  const rename = useCallback(
    async (categoryId: string, name: string): Promise<Category | null> => {
      if (!beginMutation('rename', categoryId)) return null
      try {
        const category = await renameCategory(categoryId, name)
        const categories = categoriesRef.current.map((current) =>
          current.id === category.id ? category : current,
        )
        categoriesRef.current = categories
        setState((current) => ({ ...current, categories }))
        setMutation({ status: 'idle' })
        setAnnouncement(`${category.name} renamed.`)
        return category
      } catch (cause) {
        failMutation('rename', categoryId, cause)
        return null
      } finally {
        inFlight.current = false
      }
    },
    [beginMutation, failMutation],
  )

  const remove = useCallback(
    async (categoryId: string): Promise<boolean> => {
      if (!beginMutation('delete', categoryId)) return false
      try {
        await deleteCategory(categoryId)
        const categories = categoriesRef.current.filter(({ id }) => id !== categoryId)
        categoriesRef.current = categories
        setState((current) => ({ ...current, categories }))
        setMutation({ status: 'idle' })
        setAnnouncement('Category deleted.')
        return true
      } catch (cause) {
        failMutation('delete', categoryId, cause)
        return false
      } finally {
        inFlight.current = false
      }
    },
    [beginMutation, failMutation],
  )

  const reorder = useCallback(
    async (categoryIds: string[]): Promise<boolean> => {
      if (!beginMutation('reorder')) return false
      const previous = categoriesRef.current
      const categoriesById = new Map(previous.map((category) => [category.id, category]))
      const optimistic = categoryIds.flatMap((id, position) => {
        const category = categoriesById.get(id)
        return category ? [{ ...category, position }] : []
      })

      categoriesRef.current = optimistic
      setState((current) => ({ ...current, categories: optimistic }))
      try {
        const categories = await reorderCategories(categoryIds)
        categoriesRef.current = categories
        setState((current) => ({ ...current, categories }))
        setMutation({ status: 'idle' })
        setAnnouncement('Category order saved.')
        return true
      } catch (cause) {
        categoriesRef.current = previous
        setState((current) => ({ ...current, categories: previous }))
        failMutation('reorder', undefined, cause)
        return false
      } finally {
        inFlight.current = false
      }
    },
    [beginMutation, failMutation],
  )

  const assignTask = useCallback(
    async (rootId: string, categoryId: string | null): Promise<TaskCategoryAssignment | null> => {
      if (!beginMutation('assign', rootId)) return null
      try {
        const assignment = await assignTaskCategory(rootId, categoryId)
        setMutation({ status: 'idle' })
        setAnnouncement('Task category updated.')
        return assignment
      } catch (cause) {
        failMutation('assign', rootId, cause)
        return null
      } finally {
        inFlight.current = false
      }
    },
    [beginMutation, failMutation],
  )

  return {
    ...state,
    retry: load,
    mutation,
    announcement,
    create,
    rename,
    remove,
    reorder,
    assignTask,
  }
}
