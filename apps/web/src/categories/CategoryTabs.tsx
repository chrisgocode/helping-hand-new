import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { categoryNameSchema } from '@helping-hand/schemas'
import type { CSSProperties, FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Skeleton } from '../app/Skeleton'
import type { Category } from './category-workspace'
import type { CategoryMutation } from './use-categories'

type CategoryTabsProps = {
  categories: Category[]
  loading: boolean
  selected: string | null | undefined
  mutation: CategoryMutation
  announcement: string
  onSelect: (categoryId: string | null | undefined) => void
  onCreate: (name: string) => Promise<Category | null>
  onRename: (categoryId: string, name: string) => Promise<Category | null>
  onDelete: (categoryId: string) => Promise<boolean>
  onReorder: (categoryIds: string[]) => Promise<boolean>
}

type EditorState =
  | { mode: 'idle' }
  | { mode: 'create'; name: string }
  | { mode: 'rename'; categoryId: string; name: string }
  | { mode: 'delete'; categoryId: string }

const idleEditor: EditorState = { mode: 'idle' }

function validateName(name: string) {
  return categoryNameSchema.safeParse(name).success
    ? null
    : 'Enter a category name between 1 and 100 characters.'
}

export function CategoryTabs({
  categories,
  loading,
  selected,
  mutation,
  announcement,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onReorder,
}: CategoryTabsProps) {
  const [editor, setEditor] = useState<EditorState>(idleEditor)
  const [validationError, setValidationError] = useState<string | null>(null)
  const actions = useRef<HTMLDetailsElement>(null)
  const activeCategory =
    typeof selected === 'string' ? categories.find(({ id }) => id === selected) : undefined
  const pending = mutation.status === 'pending'
  const editing = editor.mode !== 'idle'
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    if (typeof selected === 'string' && !activeCategory) onSelect(undefined)
  }, [activeCategory, onSelect, selected])

  useEffect(() => {
    const closeActions = (event: PointerEvent) => {
      if (!actions.current?.contains(event.target as Node | null))
        actions.current?.removeAttribute('open')
    }
    document.addEventListener('pointerdown', closeActions)
    return () => document.removeEventListener('pointerdown', closeActions)
  }, [])

  function select(categoryId: string | null | undefined) {
    setEditor(idleEditor)
    setValidationError(null)
    onSelect(categoryId)
  }

  function updateName(name: string) {
    setValidationError(null)
    setEditor((current) =>
      current.mode === 'create'
        ? { mode: 'create', name }
        : current.mode === 'rename'
          ? { ...current, name }
          : current,
    )
  }

  async function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editor.mode !== 'create' && editor.mode !== 'rename') return
    const issue = validateName(editor.name)
    if (issue) {
      setValidationError(issue)
      return
    }

    if (editor.mode === 'create') {
      const category = await onCreate(editor.name.trim())
      if (category) {
        setEditor(idleEditor)
        onSelect(category.id)
      }
      return
    }

    if (await onRename(editor.categoryId, editor.name.trim())) setEditor(idleEditor)
  }

  async function confirmDelete() {
    if (editor.mode !== 'delete') return
    if (await onDelete(editor.categoryId)) {
      if (selected === editor.categoryId) onSelect(undefined)
      setEditor(idleEditor)
    }
  }

  function finishDrag({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = categories.findIndex(({ id }) => id === active.id)
    const to = categories.findIndex(({ id }) => id === over.id)
    if (from < 0 || to < 0) return
    void onReorder(arrayMove(categories, from, to).map(({ id }) => id))
  }

  function runAction(action: () => void) {
    actions.current?.removeAttribute('open')
    setValidationError(null)
    action()
  }

  const mutationError =
    mutation.status === 'failed' && mutation.action !== 'assign' ? mutation.error.message : null
  const deleteCategory =
    editor.mode === 'delete' ? categories.find(({ id }) => id === editor.categoryId) : undefined

  return (
    <div className="category-tabs-workspace">
      <div className="category-tabs-toolbar">
        <div className="category-tabs-scroll">
          <div className="category-tab-list" role="tablist" aria-label="Task categories">
            <button
              className="category-tab fixed-category-tab"
              id="category-tab-all"
              type="button"
              role="tab"
              aria-controls="task-library-results"
              aria-selected={selected === undefined}
              onClick={() => select(undefined)}
            >
              All tasks
            </button>

            <DndContext sensors={sensors} onDragEnd={finishDrag}>
              <SortableContext
                items={categories.map(({ id }) => id)}
                strategy={horizontalListSortingStrategy}
              >
                <div className="user-category-tabs" role="presentation">
                  {loading ? (
                    <>
                      <span className="visually-hidden" role="status">
                        Loading categories
                      </span>
                      <Skeleton className="category-tab-skeleton category-tab-skeleton-short" />
                      <Skeleton className="category-tab-skeleton" />
                    </>
                  ) : (
                    categories.map((category) =>
                      editor.mode === 'rename' && editor.categoryId === category.id ? (
                        <CategoryNameEditor
                          key={category.id}
                          name={editor.name}
                          pending={mutation.status === 'pending' && mutation.action === 'rename'}
                          submitLabel="Save"
                          inputLabel={`Rename ${category.name}`}
                          onChange={updateName}
                          onCancel={() => setEditor(idleEditor)}
                          onSubmit={submitName}
                        />
                      ) : (
                        <SortableCategoryTab
                          key={category.id}
                          category={category}
                          selected={selected === category.id}
                          disabled={pending || editing}
                          onSelect={() => select(category.id)}
                        />
                      ),
                    )
                  )}
                </div>
              </SortableContext>
            </DndContext>

            <button
              className="category-tab fixed-category-tab"
              id="category-tab-uncategorized"
              type="button"
              role="tab"
              aria-controls="task-library-results"
              aria-selected={selected === null}
              onClick={() => select(null)}
            >
              Uncategorized
            </button>
          </div>
        </div>

        <div className="category-tab-controls">
          {editor.mode === 'create' ? (
            <CategoryNameEditor
              name={editor.name}
              pending={mutation.status === 'pending' && mutation.action === 'create'}
              submitLabel="Add"
              inputLabel="New category name"
              onChange={updateName}
              onCancel={() => setEditor(idleEditor)}
              onSubmit={submitName}
            />
          ) : (
            <button
              className="category-add-button"
              type="button"
              aria-label="Add category"
              title={categories.length >= 50 ? 'You can create up to 50 categories.' : undefined}
              disabled={loading || pending || categories.length >= 50}
              onClick={() => {
                setValidationError(null)
                setEditor({ mode: 'create', name: '' })
              }}
            >
              <span aria-hidden="true">＋</span>
            </button>
          )}

          {activeCategory && editor.mode !== 'create' && (
            <details className="category-action-menu" ref={actions}>
              <summary aria-label={`Actions for ${activeCategory.name}`}>
                <span aria-hidden="true">•••</span>
              </summary>
              <div className="category-actions">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    runAction(() =>
                      setEditor({
                        mode: 'rename',
                        categoryId: activeCategory.id,
                        name: activeCategory.name,
                      }),
                    )
                  }
                >
                  Rename category
                </button>
                <button
                  className="danger-action"
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    runAction(() => setEditor({ mode: 'delete', categoryId: activeCategory.id }))
                  }
                >
                  Delete category
                </button>
              </div>
            </details>
          )}
        </div>
      </div>

      {categories.length >= 50 && editor.mode !== 'create' && (
        <p className="category-limit">You have reached the limit of 50 categories.</p>
      )}

      {(validationError || mutationError) && (
        <p className="category-error" role="alert">
          {validationError ?? mutationError}
        </p>
      )}

      {deleteCategory && (
        <div className="category-delete-confirmation" role="alertdialog" aria-live="polite">
          <div>
            <strong>Delete “{deleteCategory.name}”?</strong>
            <p>Its tasks will become uncategorized. No tasks or subtasks will be deleted.</p>
          </div>
          <div>
            <button type="button" disabled={pending} onClick={() => setEditor(idleEditor)}>
              Cancel
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={pending}
              onClick={() => void confirmDelete()}
            >
              {mutation.status === 'pending' && mutation.action === 'delete'
                ? 'Deleting…'
                : 'Delete category'}
            </button>
          </div>
        </div>
      )}

      <p className="category-announcement" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}

type CategoryNameEditorProps = {
  name: string
  pending: boolean
  submitLabel: 'Add' | 'Save'
  inputLabel: string
  onChange: (name: string) => void
  onCancel: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

function CategoryNameEditor({
  name,
  pending,
  submitLabel,
  inputLabel,
  onChange,
  onCancel,
  onSubmit,
}: CategoryNameEditorProps) {
  return (
    <form className="category-name-editor" aria-label={inputLabel} onSubmit={onSubmit}>
      <input
        aria-label={inputLabel}
        value={name}
        maxLength={100}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
      />
      <button type="submit" disabled={pending}>
        {pending ? `${submitLabel}ing…` : submitLabel}
      </button>
      <button type="button" disabled={pending} onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}

type SortableCategoryTabProps = {
  category: Category
  selected: boolean
  disabled: boolean
  onSelect: () => void
}

function SortableCategoryTab({ category, selected, disabled, onSelect }: SortableCategoryTabProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: category.id, disabled })
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      className={`sortable-category-tab${selected ? ' active' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={style}
      role="presentation"
    >
      <button
        className="category-drag-handle"
        type="button"
        ref={setActivatorNodeRef}
        disabled={disabled}
        aria-label={`Reorder ${category.name}`}
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <button
        className="category-tab"
        id={`category-tab-${category.id}`}
        type="button"
        role="tab"
        aria-controls="task-library-results"
        aria-selected={selected}
        onClick={onSelect}
      >
        {category.name}
      </button>
    </div>
  )
}
