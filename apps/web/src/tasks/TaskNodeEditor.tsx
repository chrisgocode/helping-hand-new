import {
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { TASK_TREE_LIMITS } from '@helping-hand/schemas/task-limits'
import { type CSSProperties, useRef } from 'react'
import { getTaskDurationSeconds, type TaskNode } from './task-draft'
import type { AiProposalState } from './use-task-editor'

type TaskNodeEditorProps = {
  node: TaskNode
  parentId: string | null
  depth: number
  index: number
  siblingCount: number
  taskCount: number
  root?: boolean
  disabled: boolean
  aiDisabled: boolean
  aiState: AiProposalState
  onTitleChange: (taskId: string, title: string) => void
  onDurationChange: (taskId: string, durationSeconds: number | null) => void
  onAddChild: (parentId: string) => void
  onDelete: (taskId: string) => void
  onMove: (taskId: string, direction: 'up' | 'down') => void
  onPlace: (taskId: string, targetId: string, placement: 'before' | 'after') => void
  onBreakdown: (taskId: string) => void
  onEstimateDuration: (taskId: string) => void
  onPrioritize: (taskId: string) => void
}

function formatDuration(durationSeconds: number) {
  const hours = Math.floor(durationSeconds / 3600)
  const minutes = Math.floor((durationSeconds % 3600) / 60)
  const seconds = durationSeconds % 60
  const parts = []
  if (hours) parts.push(`${hours} hr`)
  if (minutes) parts.push(`${minutes} min`)
  if (seconds || parts.length === 0) parts.push(`${seconds} sec`)
  return parts.join(' ')
}

const sameLevelCollision: CollisionDetection = (args) => {
  const parentId = args.active.data.current?.parentId
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      ({ data }) => data.current?.parentId === parentId,
    ),
  })
}

export function TaskNodeEditor(props: TaskNodeEditorProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function finishDrag({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const source = active.data.current
    const target = over.data.current
    if (!source || !target || source.parentId !== target.parentId) return
    props.onPlace(
      String(active.id),
      String(over.id),
      source.index < target.index ? 'after' : 'before',
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={sameLevelCollision} onDragEnd={finishDrag}>
      <SortableTaskNode {...props} />
    </DndContext>
  )
}

function SortableTaskNode({
  node,
  parentId,
  depth,
  index,
  siblingCount,
  taskCount,
  root = false,
  disabled,
  aiDisabled,
  aiState,
  onTitleChange,
  onDurationChange,
  onAddChild,
  onDelete,
  onMove,
  onPlace,
  onBreakdown,
  onEstimateDuration,
  onPrioritize,
}: TaskNodeEditorProps) {
  const actionMenu = useRef<HTMLDetailsElement>(null)
  const { attributes, isDragging, listeners, setActivatorNodeRef, setNodeRef, transform, transition } =
    useSortable({
      id: node.id,
      disabled: root || disabled,
      data: { parentId, index },
    })
  const name = node.title.trim() || 'untitled task'
  const canAdd = depth < TASK_TREE_LIMITS.maxDepth && taskCount < TASK_TREE_LIMITS.maxTasksPerRoot
  const actionable = node.children.length === 0
  const runningHere = aiState.status === 'running' && aiState.taskId === node.id
  const durationSeconds = getTaskDurationSeconds(node)
  const minutes = node.durationSeconds === null ? 0 : Math.floor(node.durationSeconds / 60)
  const seconds = node.durationSeconds === null ? 0 : node.durationSeconds % 60
  const style: CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
      : undefined,
    transition,
  }

  function changeDuration(part: 'minutes' | 'seconds', rawValue: string) {
    const value = rawValue === '' ? null : Number(rawValue)
    if (
      value !== null &&
      (!Number.isInteger(value) || value < 0 || (part === 'seconds' && value > 59))
    ) {
      return
    }
    const nextMinutes = part === 'minutes' ? value : minutes
    const nextSeconds = part === 'seconds' ? value : seconds
    onDurationChange(
      node.id,
      nextMinutes === null && (nextSeconds ?? 0) === 0
        ? null
        : (nextMinutes ?? 0) * 60 + (nextSeconds ?? 0),
    )
  }

  function remove() {
    if (node.children.length > 0 && !window.confirm(`Delete “${name}” and all of its subtasks?`)) {
      return
    }
    onDelete(node.id)
  }

  function runAction(action: () => void) {
    actionMenu.current?.removeAttribute('open')
    action()
  }

  return (
    <div
      ref={setNodeRef}
      className={`task-node${root ? ' root-task-node' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={style}
    >
      <fieldset className={`task-node-row${root ? ' root-task-row' : ''}`} aria-label={`${name} task`}>
        {!root && (
          <button
            type="button"
            className="task-drag-handle"
            ref={setActivatorNodeRef}
            disabled={disabled}
            aria-label={`Reorder ${name}`}
            {...attributes}
            {...listeners}
          >
            <span aria-hidden="true">⠿</span>
          </button>
        )}
        <label className="task-title-field">
          {root && <span>Task title</span>}
          <input
            aria-label={root ? 'Task title' : `Task title, level ${depth}, position ${index + 1}`}
            value={node.title}
            maxLength={200}
            disabled={disabled}
            onChange={(event) => onTitleChange(node.id, event.target.value)}
            placeholder={root ? 'e.g. Make coffee' : 'Describe this subtask'}
          />
        </label>

        <details className="task-action-menu" ref={actionMenu}>
          <summary aria-label={`Actions for ${name}`}>
            <span aria-hidden="true">•••</span>
          </summary>
          <div className="task-node-actions">
            {durationSeconds === null && (
              <button
                className="ai-task-action"
                type="button"
                disabled={disabled || aiDisabled || node.title.trim().length === 0}
                onClick={() => runAction(() => onEstimateDuration(node.id))}
                aria-label={`Estimate missing times for ${name}`}
              >
                {runningHere && aiState.action === 'durations' ? 'Estimating…' : '⏱ Estimate time'}
              </button>
            )}
            {actionable && (
              <button
                className="ai-task-action"
                type="button"
                disabled={disabled || aiDisabled || !canAdd || node.title.trim().length === 0}
                onClick={() => runAction(() => onBreakdown(node.id))}
                aria-label={`Break down ${name} with AI`}
              >
                ✨ Break down
              </button>
            )}
            {node.children.length >= 2 && (
              <button
                className="ai-task-action"
                type="button"
                disabled={disabled || aiDisabled || node.title.trim().length === 0}
                onClick={() => runAction(() => onPrioritize(node.id))}
                aria-label={`Prioritize subtasks for ${name}`}
              >
                {runningHere && aiState.action === 'order'
                  ? 'Prioritizing…'
                  : '↕ Prioritize subtasks'}
              </button>
            )}
            <button
              className="add-task-action"
              type="button"
              disabled={disabled || !canAdd}
              onClick={() => runAction(() => onAddChild(node.id))}
              aria-label={`Add subtask to ${name}`}
            >
              + Add subtask
            </button>
            {!root && (
              <>
                <button
                  type="button"
                  disabled={disabled || index === 0}
                  onClick={() => runAction(() => onMove(node.id, 'up'))}
                  aria-label={`Move ${name} up`}
                >
                  ↑ Move up
                </button>
                <button
                  type="button"
                  disabled={disabled || index === siblingCount - 1}
                  onClick={() => runAction(() => onMove(node.id, 'down'))}
                  aria-label={`Move ${name} down`}
                >
                  ↓ Move down
                </button>
                <button
                  className="danger-action"
                  type="button"
                  disabled={disabled}
                  onClick={() => runAction(remove)}
                  aria-label={`Delete ${name}`}
                >
                  × Delete
                </button>
              </>
            )}
          </div>
        </details>
      </fieldset>

      {aiState.status === 'order-unchanged' && aiState.taskId === node.id && (
        <p className="task-ai-status" role="status" aria-live="polite">
          ✓ These subtasks are already in a logical order.
        </p>
      )}

      {actionable ? (
        <fieldset className="task-duration-editor">
          <legend>Estimated elapsed time</legend>
          <label>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={node.durationSeconds === null ? '' : minutes}
              disabled={disabled}
              aria-label={`Estimated minutes for ${name}`}
              onChange={(event) => changeDuration('minutes', event.target.value)}
            />
            minutes
          </label>
          <label>
            <input
              type="number"
              min="0"
              max="59"
              step="1"
              inputMode="numeric"
              value={node.durationSeconds === null ? '' : seconds}
              disabled={disabled}
              aria-label={`Estimated seconds for ${name}`}
              onChange={(event) => changeDuration('seconds', event.target.value)}
            />
            seconds
          </label>
        </fieldset>
      ) : (
        <p className="summary-duration">
          Total elapsed time:{' '}
          <strong>
            {durationSeconds === null ? 'Estimate incomplete' : formatDuration(durationSeconds)}
          </strong>
        </p>
      )}

      {node.children.length > 0 && (
        <SortableContext
          items={node.children.map(({ id }) => id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="task-node-children">
            {node.children.map((child, childIndex) => (
              <li key={child.id}>
                <SortableTaskNode
                  node={child}
                  parentId={node.id}
                  depth={depth + 1}
                  index={childIndex}
                  siblingCount={node.children.length}
                  taskCount={taskCount}
                  disabled={disabled}
                  aiDisabled={aiDisabled}
                  aiState={aiState}
                  onTitleChange={onTitleChange}
                  onDurationChange={onDurationChange}
                  onAddChild={onAddChild}
                  onDelete={onDelete}
                  onMove={onMove}
                  onPlace={onPlace}
                  onBreakdown={onBreakdown}
                  onEstimateDuration={onEstimateDuration}
                  onPrioritize={onPrioritize}
                />
              </li>
            ))}
          </ol>
        </SortableContext>
      )}
    </div>
  )
}
