import { RECIPIENT_LIMITS } from '@helping-hand/schemas'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Skeleton } from '../app/Skeleton'
import type { TaskTree } from '../tasks/task-workspace'
import type { RecipientAssignment } from './recipient-workspace'
import type { AssignmentMutation } from './use-recipient-assignments'
import './AssignmentPicker.css'

type AssignmentPickerProps = {
  assignments: RecipientAssignment[]
  tasks: TaskTree[]
  tasksLoading: boolean
  mutation: AssignmentMutation
  onAssign: (taskId: string, title: string) => void
  onUnassign: (taskId: string, title: string) => void
}

export function AssignmentPicker({
  assignments,
  tasks,
  tasksLoading,
  mutation,
  onAssign,
  onUnassign,
}: AssignmentPickerProps) {
  const [selected, setSelected] = useState('')
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const assignedIds = useMemo(
    () => new Set(assignments.map(({ rootTaskId }) => rootTaskId)),
    [assignments],
  )
  const assignable = useMemo(
    () =>
      tasks
        .filter((task) => !assignedIds.has(task.id))
        .sort((left, right) => left.title.localeCompare(right.title)),
    [assignedIds, tasks],
  )
  const atLimit = assignments.length >= RECIPIENT_LIMITS.maxAssignmentsPerRecipient
  const pending = mutation.status === 'pending'

  function assignSelected() {
    const task = tasksById.get(selected)
    if (!task) return
    onAssign(task.id, task.title)
    setSelected('')
  }

  return (
    <div className="assignment-picker">
      <div className="assignment-toolbar">
        <label className="assignment-select">
          <span className="visually-hidden">Task to assign</span>
          <select
            value={selected}
            disabled={tasksLoading || atLimit || assignable.length === 0}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Choose a task…</option>
            {assignable.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary-button"
          type="button"
          disabled={!selected || pending || atLimit}
          onClick={assignSelected}
        >
          Assign task
        </button>
        <span className="count-pill">
          {assignments.length} of {RECIPIENT_LIMITS.maxAssignmentsPerRecipient}
        </span>
      </div>

      {atLimit && (
        <p className="assignment-limit-note">
          This recipient has the maximum of {RECIPIENT_LIMITS.maxAssignmentsPerRecipient} assigned
          tasks. Remove one before assigning another.
        </p>
      )}

      {!tasksLoading && tasks.length === 0 && (
        <div className="empty-card">
          <span className="empty-rail" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div>
            <h3>No tasks to assign yet</h3>
            <p>
              Build a task tree first, then assign it here. <Link to="/tasks/new">Create task</Link>
            </p>
          </div>
        </div>
      )}

      {assignments.length === 0 && tasks.length > 0 && (
        <p className="assignment-empty">
          Nothing is assigned yet. Choose a task above to give this recipient something to follow.
        </p>
      )}

      {assignments.length > 0 && (
        <ul className="assignment-list">
          {assignments.map((assignment) => {
            const task = tasksById.get(assignment.rootTaskId)
            const title = task?.title ?? 'This task is no longer in your library'
            return (
              <li className="assignment-row" key={assignment.rootTaskId}>
                <div className="assignment-copy">
                  {tasksLoading && !task ? (
                    <Skeleton className="assignment-skeleton-title" />
                  ) : (
                    <span className={task ? 'assignment-title' : 'assignment-title missing'}>
                      {title}
                    </span>
                  )}
                  {task && (
                    <span className="assignment-meta">
                      {task.children.length}{' '}
                      {task.children.length === 1 ? 'top-level step' : 'top-level steps'}
                    </span>
                  )}
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={pending}
                  onClick={() => onUnassign(assignment.rootTaskId, title)}
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
