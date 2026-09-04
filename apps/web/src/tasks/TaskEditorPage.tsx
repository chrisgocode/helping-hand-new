import { setTaskCategoryInputSchema, type TaskDetail } from '@helping-hand/schemas'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Link,
  useBeforeUnload,
  useBlocker,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router'
import { Skeleton } from '../app/Skeleton'
import { authClient } from '../auth/auth-client'
import { useCategories } from '../categories/use-categories'
import { TaskNodeEditor } from './TaskNodeEditor'
import { countDraftTasks, createTaskDraft, type TaskTreeDraft } from './task-draft'
import { deleteTaskTree, TaskWorkspaceError } from './task-workspace'
import { useTaskEditor } from './use-task-editor'
import { useTaskLibrary } from './use-task-library'

type EditorProps = {
  initialDraft?: TaskTreeDraft
  reload?: () => Promise<void>
}

function TaskEditorSkeleton() {
  return (
    <main
      className="task-page editor-page editor-page-skeleton"
      role="status"
      aria-label="Loading task"
      aria-busy="true"
    >
      <header className="editor-heading">
        <div className="editor-heading-skeleton-copy">
          <Skeleton className="editor-skeleton-eyebrow" />
          <Skeleton className="editor-skeleton-title" />
          <Skeleton className="editor-skeleton-copy" />
        </div>
        <Skeleton className="editor-skeleton-count" />
      </header>
      <section className="editor-workspace editor-workspace-skeleton">
        <div className="editor-skeleton-setting">
          <Skeleton className="editor-skeleton-label" />
          <Skeleton className="editor-skeleton-control" />
          <Skeleton className="editor-skeleton-help" />
        </div>
        <div className="editor-skeleton-setting editor-skeleton-detail">
          <div>
            <Skeleton className="editor-skeleton-label" />
            <Skeleton className="editor-skeleton-help" />
          </div>
          <Skeleton className="editor-skeleton-slider" />
        </div>
        <div className="task-node root-task-node editor-skeleton-node">
          <Skeleton className="editor-skeleton-field-label" />
          <Skeleton className="editor-skeleton-field" />
        </div>
      </section>
    </main>
  )
}

function Editor({ initialDraft, reload }: EditorProps) {
  const navigate = useNavigate()
  const editor = useTaskEditor(initialDraft)
  const categoryLibrary = useCategories()
  const [breakdownDetail, setBreakdownDetail] = useState<TaskDetail>(3)
  const allowNavigation = useRef(false)
  const blocker = useBlocker(
    useCallback(() => editor.isDirty && !allowNavigation.current, [editor.isDirty]),
  )
  const [deleteState, setDeleteState] = useState<{
    deleting: boolean
    error: TaskWorkspaceError | null
  }>({ deleting: false, error: null })
  const saving = editor.status === 'saving'
  const aiRunning = editor.ai.state.status === 'running'
  const busy = saving || deleteState.deleting || aiRunning
  const taskCount = countDraftTasks(editor.draft)
  const error = deleteState.error ?? editor.error
  const existing = editor.draft.revision !== null
  const categoriesLoading = categoryLibrary.status === 'loading'

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!editor.isDirty) return
        event.preventDefault()
        event.returnValue = ''
      },
      [editor.isDirty],
    ),
  )

  useEffect(() => {
    if (editor.status === 'saved') navigate('/tasks', { replace: true })
  }, [editor.status, navigate])

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm('Discard your unsaved changes?')) blocker.proceed()
    else blocker.reset()
  }, [blocker])

  useEffect(() => {
    const aiRequiresSignIn =
      editor.ai.state.status === 'failed' && editor.ai.state.recovery === 'sign-in'
    if (
      error?.kind !== 'unauthenticated' &&
      categoryLibrary.error?.kind !== 'unauthenticated' &&
      !aiRequiresSignIn
    )
      return
    void authClient
      .signOut()
      .catch(() => undefined)
      .finally(() => navigate('/sign-in', { replace: true }))
  }, [categoryLibrary.error, editor.ai.state, error, navigate])

  const handleDelete = useCallback(async () => {
    const revision = editor.draft.revision
    if (revision === null) return
    if (!window.confirm(`Delete “${editor.draft.title}” and all its subtasks?`)) return

    setDeleteState({ deleting: true, error: null })
    try {
      await deleteTaskTree(editor.draft.id, revision)
      allowNavigation.current = true
      navigate('/tasks', { replace: true })
    } catch (cause) {
      setDeleteState({
        deleting: false,
        error:
          cause instanceof TaskWorkspaceError
            ? cause
            : new TaskWorkspaceError('unexpected', false, { cause }),
      })
    }
  }, [editor.draft, navigate])

  const handleReload = useCallback(() => {
    if (!reload) return
    if (editor.isDirty && !window.confirm('Replace your local changes with the saved version?'))
      return
    setDeleteState({ deleting: false, error: null })
    void reload()
  }, [editor.isDirty, reload])

  return (
    <main className="task-page editor-page">
      <header className="editor-heading">
        <div>
          <p className="eyebrow">{existing ? 'Edit task tree' : 'New task tree'}</p>
          <h1>Build clear guidance.</h1>
          <p>Start with the overall task, then add the actions someone can follow one at a time.</p>
        </div>
        <span className="count-pill">{taskCount} of 100 tasks</span>
      </header>

      <section className="editor-workspace" aria-label="Task tree editor">
        <div className="task-category-setting" aria-busy={categoriesLoading || undefined}>
          <label htmlFor="task-category">Category</label>
          {categoriesLoading ? (
            <>
              <span className="visually-hidden" role="status">
                Loading categories
              </span>
              <Skeleton className="task-category-select-skeleton" />
            </>
          ) : (
            <select
              id="task-category"
              aria-label="Task category"
              value={editor.draft.categoryId ?? ''}
              disabled={busy || categoryLibrary.status !== 'ready'}
              onChange={(event) => editor.updateCategory(event.target.value || null)}
            >
              <option value="">Uncategorized</option>
              {editor.draft.categoryId &&
                !categoryLibrary.categories.some(({ id }) => id === editor.draft.categoryId) && (
                  <option value={editor.draft.categoryId}>Unavailable category</option>
                )}
              {categoryLibrary.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
          <span>Applies to the overall task and all its subtasks.</span>
        </div>

        {categoryLibrary.status === 'error' &&
          categoryLibrary.error?.kind !== 'unauthenticated' && (
            <div className="task-category-error" role="status">
              <span>Categories could not load.</span>
              {categoryLibrary.error?.retryable && (
                <button type="button" onClick={() => void categoryLibrary.retry()}>
                  Try again
                </button>
              )}
            </div>
          )}

        <div className="breakdown-detail-setting">
          <div>
            <strong>Step detail</strong>
            <span className="detail-setting-description" aria-live="polite">
              {editor.ai.state.status === 'running' && editor.ai.state.action === 'breakdown'
                ? 'Generating subtasks…'
                : 'Used for every AI breakdown in this task tree.'}
            </span>
          </div>
          <label className="detail-slider" htmlFor="breakdown-detail">
            <span>Simple</span>
            <input
              id="breakdown-detail"
              aria-label="Step detail"
              type="range"
              min="1"
              max="5"
              step="1"
              value={breakdownDetail}
              disabled={aiRunning}
              onChange={(event) => setBreakdownDetail(Number(event.target.value) as TaskDetail)}
            />
            <span>Detailed</span>
            <output htmlFor="breakdown-detail">{breakdownDetail}</output>
          </label>
        </div>

        <TaskNodeEditor
          node={editor.draft}
          parentId={null}
          depth={1}
          index={0}
          taskCount={taskCount}
          root
          disabled={busy}
          aiDisabled={aiRunning || Boolean(editor.validationIssue)}
          aiState={editor.ai.state}
          onTitleChange={editor.updateTitle}
          onDurationChange={editor.updateDuration}
          onAddChild={editor.addChild}
          onDelete={editor.removeTask}
          onPlace={editor.placeTask}
          onBreakdown={(taskId) => void editor.ai.breakDown(taskId, breakdownDetail)}
          onEstimateDuration={(taskId) => void editor.ai.generateDurations(taskId)}
          onPrioritize={(taskId) => void editor.ai.optimizeOrder(taskId)}
        />
      </section>

      {editor.ai.state.status === 'failed' && editor.ai.state.recovery !== 'sign-in' && (
        <div className="notice error-notice editor-notice" role="alert">
          <strong>
            {editor.ai.state.action === 'breakdown'
              ? 'Task breakdown could not be completed.'
              : editor.ai.state.action === 'durations'
                ? 'Time estimates could not be generated.'
                : 'Subtasks could not be prioritized.'}
          </strong>
          <span>{editor.ai.state.message}</span>
          {editor.ai.state.recovery === 'reload' && reload ? (
            <button type="button" onClick={handleReload}>
              Reload saved version
            </button>
          ) : (
            editor.ai.state.recovery === 'retry' && (
              <button type="button" onClick={() => void editor.ai.retry()}>
                Try again
              </button>
            )
          )}
        </div>
      )}

      {error && error.kind !== 'unauthenticated' && (
        <div className="notice error-notice editor-notice" role="alert">
          <strong>
            {deleteState.error ? 'Task could not be deleted.' : 'Task could not save.'}
          </strong>
          <span>{error.message}</span>
          {error.kind === 'conflict' && reload ? (
            <button type="button" onClick={handleReload}>
              Reload saved version
            </button>
          ) : (
            error.retryable && (
              <button
                type="button"
                onClick={() => void (deleteState.error ? handleDelete() : editor.save())}
              >
                Try again
              </button>
            )
          )}
        </div>
      )}

      <footer className="editor-footer">
        <div>
          {editor.validationIssue ? (
            <p className="editor-validation">{editor.validationIssue}</p>
          ) : (
            <p>
              {editor.isDirty
                ? 'Your changes are only on this device until you save.'
                : existing
                  ? 'This task is up to date.'
                  : 'No changes yet.'}
            </p>
          )}
        </div>
        <div className="editor-footer-actions">
          {existing && (
            <button className="danger-button" type="button" disabled={busy} onClick={handleDelete}>
              {deleteState.deleting ? 'Deleting…' : 'Delete task'}
            </button>
          )}
          <Link className="secondary-button" to="/tasks">
            Cancel
          </Link>
          <button
            className="primary-button"
            type="button"
            disabled={!editor.isDirty || Boolean(editor.validationIssue) || busy}
            onClick={() => void editor.save()}
          >
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Save task'}
          </button>
        </div>
      </footer>
    </main>
  )
}

function SavedEditor() {
  const { rootId } = useParams()
  const navigate = useNavigate()
  const library = useTaskLibrary()
  const task = library.tasks.find(({ id }) => id === rootId)

  useEffect(() => {
    if (library.error?.kind !== 'unauthenticated') return
    void authClient
      .signOut()
      .catch(() => undefined)
      .finally(() => navigate('/sign-in', { replace: true }))
  }, [library.error, navigate])

  if (library.status === 'loading' && !task) {
    return <TaskEditorSkeleton />
  }

  if (library.status === 'error' && !task) {
    return (
      <main className="task-page editor-page">
        <div className="notice error-notice" role="alert">
          <strong>Task could not load.</strong>
          <span>{library.error?.message}</span>
          {library.error?.retryable && (
            <button type="button" onClick={() => void library.retry()}>
              Try again
            </button>
          )}
        </div>
      </main>
    )
  }

  if (!task) {
    return (
      <main className="task-page editor-page">
        <div className="empty-card">
          <div>
            <h1>Task not found</h1>
            <Link className="empty-action" to="/tasks">
              Return to your tasks
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return <Editor key={`${task.id}:${task.revision}`} initialDraft={task} reload={library.retry} />
}

export function TaskEditorPage({ saved = false }: { saved?: boolean }) {
  return saved ? <SavedEditor /> : <NewEditor />
}

function NewEditor() {
  const [searchParams] = useSearchParams()
  const requestedCategoryId = searchParams.get('categoryId')
  const initialDraft = useMemo(() => {
    const parsed = setTaskCategoryInputSchema.safeParse({ categoryId: requestedCategoryId })
    return createTaskDraft(parsed.success ? (parsed.data.categoryId ?? undefined) : undefined)
  }, [requestedCategoryId])

  return <Editor initialDraft={initialDraft} />
}
