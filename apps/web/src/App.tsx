import type { components } from '@helping-hand/api-client'
import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { api } from './lib/api'

type TaskTree = components['schemas']['TaskTree']

function App() {
  const [tasks, setTasks] = useState<TaskTree[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const loadTasks = useCallback(() => {
    setLoading(true)
    void api
      .GET('/api/tasks')
      .then(({ data, error }) => {
        if (error) {
          setError(error.detail)
          return
        }
        setError('')
        setTasks(data)
      })
      .catch(() => setError('The API is unavailable.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  return (
    <div className="task-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Helping Hand tasks">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Helping Hand</span>
        </a>
        <nav aria-label="Main navigation">
          <a className="active" href="#task-library">
            Tasks
          </a>
        </nav>
      </header>

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
          <a className="primary-button intro-action" href="#task-library">
            View tasks <span aria-hidden="true">↓</span>
          </a>
        </section>

        <section className="library-section" id="task-library" aria-labelledby="library-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Task library</p>
              <h2 id="library-heading">Your tasks</h2>
            </div>
            {!loading && !error && <span className="count-pill">{tasks.length} total</span>}
          </div>

          {error && (
            <div className="notice error-notice" role="alert">
              <strong>Tasks could not load.</strong>
              <span>{error}</span>
              <button type="button" onClick={loadTasks}>
                Try again
              </button>
            </div>
          )}

          {loading && <div className="loading-card">Loading tasks…</div>}

          {!loading && !error && tasks.length === 0 && (
            <div className="empty-card">
              <span className="empty-rail" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <div>
                <h3>Create your first helping hand</h3>
                <p>Start with a familiar task, then break it into short, clear steps.</p>
              </div>
            </div>
          )}

          {!loading && !error && tasks.length > 0 && (
            <div className="task-list">
              {tasks.map((task, index) => (
                <article className="task-card" key={task.id}>
                  <span className="task-number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="task-card-body">
                    <h3>{task.title}</h3>
                    <p>
                      {task.children.length} top-level{' '}
                      {task.children.length === 1 ? 'step' : 'steps'}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="site-footer">
        <span>Helping Hand</span>
        <p>Clear, repeatable guidance when you need it.</p>
      </footer>
    </div>
  )
}

export default App
