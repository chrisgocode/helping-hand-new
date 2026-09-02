import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router'
import { authClient } from '../auth/auth-client'
import { useTaskLibrary } from './use-task-library'

export function TaskLibraryPage() {
  const navigate = useNavigate()
  const { tasks, status, error, retry } = useTaskLibrary()

  useEffect(() => {
    if (error?.kind !== 'unauthenticated') return

    void authClient
      .signOut()
      .catch(() => undefined)
      .finally(() => navigate('/sign-in', { replace: true }))
  }, [error, navigate])

  return (
    <main className="task-page dashboard-page">
      <section className="dashboard-intro">
        <div>
          <p className="eyebrow">Task workspace</p>
          <h1>
            Clear help,
            <br />
            one step at a time.
          </h1>
          <p className="intro-copy">
            Create clear, repeatable guidance to use hands-free when you need it.
          </p>
        </div>
        <Link className="primary-button intro-action" to="/tasks/new">
          Create task <span aria-hidden="true">＋</span>
        </Link>
      </section>

      <section className="library-section" id="task-library" aria-labelledby="library-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Task library</p>
            <h2 id="library-heading">Your tasks</h2>
          </div>
          {status === 'ready' && <span className="count-pill">{tasks.length} total</span>}
        </div>

        {status === 'error' && error && error.kind !== 'unauthenticated' && (
          <div className="notice error-notice" role="alert">
            <strong>Tasks could not load.</strong>
            <span>{error.message}</span>
            {error.retryable && (
              <button type="button" onClick={retry}>
                Try again
              </button>
            )}
          </div>
        )}

        {status === 'loading' && tasks.length === 0 && (
          <div className="loading-card" aria-busy="true">
            Loading tasks…
          </div>
        )}

        {status === 'ready' && tasks.length === 0 && (
          <div className="empty-card">
            <span className="empty-rail" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <div>
              <h3>Create your first helping hand</h3>
              <p>Start with a familiar task, then break it into short, clear steps.</p>
              <Link className="empty-action" to="/tasks/new">
                Create a task
              </Link>
            </div>
          </div>
        )}

        {tasks.length > 0 && (
          <div className="task-list">
            {tasks.map((task, index) => (
              <Link className="task-card" key={task.id} to={`/tasks/${task.id}/edit`}>
                <span className="task-number" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="task-card-body">
                  <h3>{task.title}</h3>
                  <p>
                    {task.children.length} top-level {task.children.length === 1 ? 'step' : 'steps'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
