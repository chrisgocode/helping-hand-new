import type { TaskDetail } from '@helping-hand/schemas'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router'
import { authClient } from '../auth/auth-client'
import { TaskNodeEditor } from './TaskNodeEditor'
import { countDraftTasks, type TaskTreeDraft } from './task-draft'
import { deleteTaskTree, TaskWorkspaceError } from './task-workspace'
import { useTaskEditor } from './use-task-editor'
import { useTaskLibrary } from './use-task-library'

type EditorProps = {
  initialDraft?: TaskTreeDraft
  reload?: () => Promise<void>
}

function Editor({ initialDraft, reload }: EditorProps) {
  const navigate = useNavigate()
  const editor = useTaskEditor(initialDraft)
  const [breakdown, setBreakdown] = useState<{ taskId: string; detail: TaskDetail } | null>(null)
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
    if (error?.kind !== 'unauthenticated' && !aiRequiresSignIn) return
    void authClient
      .signOut()
      .catch(() => undefined)
      .finally(() => navigate('/sign-in', { replace: true }))
  }, [editor.ai.state, error, navigate])

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

  const generateBreakdown = useCallback(async () => {
    if (!breakdown) return
    if ((await editor.ai.breakDown(breakdown.taskId, breakdown.detail)) === 'applied') {
      setBreakdown(null)
    }
  }, [breakdown, editor.ai])

  const retryAiProposal = useCallback(async () => {
    const failedAction = editor.ai.state.status === 'failed' ? editor.ai.state.action : null
    if ((await editor.ai.retry()) === 'applied' && failedAction === 'breakdown') {
      setBreakdown(null)
    }
  }, [editor.ai])

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
        <TaskNodeEditor
          node={editor.draft}
          parentId={null}
          depth={1}
          index={0}
          siblingCount={1}
          taskCount={taskCount}
          root
          disabled={busy}
          aiDisabled={breakdown !== null || aiRunning || Boolean(editor.validationIssue)}
          aiState={editor.ai.state}
          onTitleChange={editor.updateTitle}
          onDurationChange={editor.updateDuration}
          onAddChild={editor.addChild}
          onDelete={editor.removeTask}
          onMove={editor.reorderTask}
          onPlace={editor.placeTask}
          onBreakdown={(taskId) => setBreakdown({ taskId, detail: 3 })}
          onEstimateDuration={(taskId) => void editor.ai.generateDurations(taskId)}
          onPrioritize={(taskId) => void editor.ai.optimizeOrder(taskId)}
        />
      </section>

      {breakdown && (
        <section className="breakdown-panel" aria-labelledby="breakdown-heading">
          <div className="breakdown-heading">
            <div>
              <p className="eyebrow">AI breakdown</p>
              <h2 id="breakdown-heading">Break this task into subtasks</h2>
            </div>
            <button type="button" disabled={aiRunning} onClick={() => setBreakdown(null)}>
              Cancel
            </button>
          </div>

          <label className="detail-control" htmlFor="breakdown-detail">
            <span>Step detail</span>
            <input
              id="breakdown-detail"
              type="range"
              min="1"
              max="5"
              step="1"
              value={breakdown.detail}
              disabled={aiRunning}
              onChange={(event) =>
                setBreakdown((current) =>
                  current
                    ? { ...current, detail: Number(event.target.value) as TaskDetail }
                    : current,
                )
              }
            />
            <output htmlFor="breakdown-detail">{breakdown.detail}</output>
          </label>
          <div className="detail-labels" aria-hidden="true">
            <span>Simple</span>
            <span>Detailed</span>
          </div>

          {editor.ai.state.status === 'running' && editor.ai.state.action === 'breakdown' && (
            <p className="breakdown-loading" aria-live="polite">
              Generating subtasks…
            </p>
          )}

          <div className="breakdown-actions">
            <button
              className="primary-button"
              type="button"
              disabled={aiRunning}
              onClick={() => void generateBreakdown()}
            >
              Generate subtasks
            </button>
          </div>
        </section>
      )}

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
              <button type="button" onClick={() => void retryAiProposal()}>
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
    return <main className="task-page editor-page loading-card">Loading task…</main>
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
  return saved ? <SavedEditor /> : <Editor />
}
