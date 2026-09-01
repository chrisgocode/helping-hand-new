import type { components } from '@helping-hand/api-client'
import { useEffect, useState } from 'react'
import './App.css'
import { api } from './lib/api'

type TaskTree = components['schemas']['TaskTree']

function App() {
  const [tasks, setTasks] = useState<TaskTree[]>([])
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void api
      .GET('/api/tasks')
      .then(({ data, error }) => {
        if (error) {
          setError(error.detail)
          return
        }
        setTasks(data)
      })
      .catch(() => setError('The API is unavailable.'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main>
      <header>
        <p className="eyebrow">Helping Hand</p>
        <h1>Your tasks</h1>
      </header>

      {loading && <p>Loading tasks…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && tasks.length === 0 && <p>No saved tasks yet.</p>}
      {tasks.length > 0 && (
        <ul className="tasks">
          {tasks.map((task) => (
            <li key={task.id}>{task.title}</li>
          ))}
        </ul>
      )}
    </main>
  )
}

export default App
