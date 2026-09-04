import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Skeleton } from '../app/Skeleton'
import { authClient } from '../auth/auth-client'
import { CategoryTabs } from '../categories/CategoryTabs'
import { useCategories } from '../categories/use-categories'
import { useTaskLibrary } from './use-task-library'

function TaskLibrarySkeleton() {
  return (
    <div
      className="task-list task-list-skeleton"
      role="status"
      aria-label="Loading tasks"
      aria-busy="true"
    >
      {['first', 'second', 'third'].map((item) => (
        <div className="task-card task-card-skeleton" key={item} aria-hidden="true">
          <Skeleton className="task-skeleton-number" />
          <div className="task-skeleton-copy">
            <Skeleton className="task-skeleton-title" />
            <Skeleton className="task-skeleton-meta" />
          </div>
          <Skeleton className="task-skeleton-action" />
        </div>
      ))}
    </div>
  )
}

export function TaskLibraryPage() {
  const navigate = useNavigate()
  const library = useTaskLibrary()
  const categoryLibrary = useCategories()
  const [categoryFilter, setCategoryFilter] = useState<string | null | undefined>(undefined)
  const categoryNames = useMemo(
    () => new Map(categoryLibrary.categories.map(({ id, name }) => [id, name])),
    [categoryLibrary.categories],
  )
  const visibleTasks = useMemo(
    () =>
      library.tasks.filter((task) => {
        if (categoryFilter === undefined) return true
        return task.categoryId === categoryFilter
      }),
    [categoryFilter, library.tasks],
  )
  const activeCategoryName =
    categoryFilter === null
      ? 'Uncategorized'
      : (categoryNames.get(categoryFilter ?? '') ?? 'this category')
  const categoryCreationHref =
    typeof categoryFilter === 'string'
      ? `/tasks/new?categoryId=${encodeURIComponent(categoryFilter)}`
      : '/tasks/new'

  useEffect(() => {
    if (
      library.error?.kind !== 'unauthenticated' &&
      !(
        categoryLibrary.mutation.status === 'failed' &&
        categoryLibrary.mutation.error.kind === 'unauthenticated'
      ) &&
      categoryLibrary.error?.kind !== 'unauthenticated'
    ) {
      return
    }

    void authClient
      .signOut()
      .catch(() => undefined)
      .finally(() => navigate('/sign-in', { replace: true }))
  }, [categoryLibrary.error, categoryLibrary.mutation, library.error, navigate])

  useEffect(() => {
    const closeOpenMenus = (event: PointerEvent) => {
      document.querySelectorAll<HTMLDetailsElement>('.library-task-menu[open]').forEach((menu) => {
        if (!menu.contains(event.target as Node | null)) menu.open = false
      })
    }
    document.addEventListener('pointerdown', closeOpenMenus)
    return () => document.removeEventListener('pointerdown', closeOpenMenus)
  }, [])

  async function changeTaskCategory(
    rootId: string,
    categoryId: string | null,
    menu: HTMLDetailsElement | null,
  ) {
    const assignment = await categoryLibrary.assignTask(rootId, categoryId)
    if (!assignment) return
    library.setCategory(assignment.rootId, assignment.categoryId)
    menu?.removeAttribute('open')
  }

  async function deleteCategory(categoryId: string) {
    const deleted = await categoryLibrary.remove(categoryId)
    if (deleted) library.clearCategory(categoryId)
    return deleted
  }

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
          {library.status === 'ready' && (
            <span className="count-pill">
              {visibleTasks.length} {categoryFilter === undefined ? 'total' : 'shown'}
            </span>
          )}
        </div>

        <CategoryTabs
          categories={categoryLibrary.categories}
          loading={categoryLibrary.status === 'loading'}
          selected={categoryFilter}
          mutation={categoryLibrary.mutation}
          announcement={categoryLibrary.announcement}
          onSelect={setCategoryFilter}
          onCreate={categoryLibrary.create}
          onRename={categoryLibrary.rename}
          onDelete={deleteCategory}
          onReorder={categoryLibrary.reorder}
        />

        {library.status === 'error' &&
          library.error &&
          library.error.kind !== 'unauthenticated' && (
            <div className="notice error-notice" role="alert">
              <strong>Tasks could not load.</strong>
              <span>{library.error.message}</span>
              {library.error.retryable && (
                <button type="button" onClick={library.retry}>
                  Try again
                </button>
              )}
            </div>
          )}

        {categoryLibrary.status === 'error' &&
          categoryLibrary.error &&
          categoryLibrary.error.kind !== 'unauthenticated' && (
            <div className="notice error-notice" role="alert">
              <strong>Categories could not load.</strong>
              <span>{categoryLibrary.error.message}</span>
              {categoryLibrary.error.retryable && (
                <button type="button" onClick={categoryLibrary.retry}>
                  Try again
                </button>
              )}
            </div>
          )}

        {categoryLibrary.mutation.status === 'failed' &&
          categoryLibrary.mutation.action === 'assign' &&
          categoryLibrary.mutation.error.kind !== 'unauthenticated' && (
            <div className="notice error-notice" role="alert">
              <strong>Category could not update.</strong>
              <span>{categoryLibrary.mutation.error.message}</span>
            </div>
          )}

        <div id="task-library-results" role="tabpanel">
          {library.status === 'loading' && library.tasks.length === 0 && <TaskLibrarySkeleton />}

          {library.status === 'ready' &&
            library.tasks.length === 0 &&
            categoryFilter === undefined && (
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

          {library.status === 'ready' &&
            categoryFilter !== undefined &&
            visibleTasks.length === 0 && (
              <div className="empty-card category-empty-card">
                <div>
                  <h3>No tasks in {activeCategoryName}</h3>
                  <p>
                    {typeof categoryFilter === 'string'
                      ? `Create one here and it will be added to ${activeCategoryName} automatically.`
                      : 'Create a task without assigning it to a category.'}
                  </p>
                  <div className="category-empty-actions">
                    <Link
                      className="secondary-button"
                      to={categoryCreationHref}
                      aria-label={
                        typeof categoryFilter === 'string'
                          ? `Create task in ${activeCategoryName}`
                          : 'Create task'
                      }
                    >
                      Create task
                    </Link>
                    <button
                      type="button"
                      className="empty-action"
                      onClick={() => setCategoryFilter(undefined)}
                    >
                      Show all tasks
                    </button>
                  </div>
                </div>
              </div>
            )}

          {visibleTasks.length > 0 && (
            <div className="task-list">
              {visibleTasks.map((task, index) => (
                <article className="task-card" key={task.id}>
                  <Link className="task-card-link" to={`/tasks/${task.id}/edit`}>
                    <span className="task-number" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="task-card-body">
                      <div className="task-card-title">
                        <h3>{task.title}</h3>
                        {categoryFilter === undefined &&
                          task.categoryId &&
                          categoryNames.has(task.categoryId) && (
                            <span className="category-label">
                              {categoryNames.get(task.categoryId)}
                            </span>
                          )}
                      </div>
                      <p>
                        {task.children.length} top-level{' '}
                        {task.children.length === 1 ? 'step' : 'steps'}
                      </p>
                    </div>
                  </Link>
                  <details className="library-task-menu">
                    <summary aria-label={`Organize ${task.title}`}>
                      <span aria-hidden="true">•••</span>
                    </summary>
                    <div className="library-task-actions">
                      <label>
                        <span>Move to category</span>
                        <select
                          aria-label={`Category for ${task.title}`}
                          value={task.categoryId ?? ''}
                          disabled={categoryLibrary.mutation.status === 'pending'}
                          onChange={(event) =>
                            void changeTaskCategory(
                              task.id,
                              event.target.value || null,
                              event.currentTarget.closest('details'),
                            )
                          }
                        >
                          <option value="">Uncategorized</option>
                          {categoryLibrary.categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </details>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
