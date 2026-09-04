import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assignTaskCategory, listCategories } from '../categories/category-workspace'
import { TaskLibraryPage } from './TaskLibraryPage'
import { listTaskTrees } from './task-workspace'

vi.mock('../categories/category-workspace', () => ({
  assignTaskCategory: vi.fn(),
  listCategories: vi.fn(),
}))

vi.mock('./task-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-workspace')>()),
  listTaskTrees: vi.fn(),
}))

const assignCategory = vi.mocked(assignTaskCategory)
const getCategories = vi.mocked(listCategories)
const getTasks = vi.mocked(listTaskTrees)
const homeId = '66e65fa9-dac8-4800-8ce3-482dcc9c6a45'
const errandsId = '9bf8bb56-0fbd-422f-9d4d-7741347dded2'
const coffeeId = 'd9cb5e16-c35e-4c60-8e28-26aa744034ee'
const laundryId = '4799a45d-c843-4521-b192-6c2628c518c4'

const categories = [
  {
    id: homeId,
    name: 'Home',
    position: 0,
    createdAt: '2026-09-02T12:00:00.000Z',
    updatedAt: '2026-09-02T12:00:00.000Z',
  },
  {
    id: errandsId,
    name: 'Errands',
    position: 1,
    createdAt: '2026-09-02T12:00:00.000Z',
    updatedAt: '2026-09-02T12:00:00.000Z',
  },
]

const tasks = [
  {
    id: coffeeId,
    title: 'Make coffee',
    durationSeconds: null,
    categoryId: homeId,
    revision: 1,
    children: [],
  },
  {
    id: laundryId,
    title: 'Do laundry',
    durationSeconds: null,
    categoryId: null,
    revision: 0,
    children: [],
  },
]

function renderLibrary() {
  const router = createMemoryRouter(
    [
      { path: '/tasks', element: <TaskLibraryPage /> },
      { path: '/tasks/:rootId/edit', element: <h1>Task editor</h1> },
    ],
    { initialEntries: ['/tasks'] },
  )
  render(<RouterProvider router={router} />)
}

describe('TaskLibraryPage categories', () => {
  beforeEach(() => {
    assignCategory.mockReset()
    getCategories.mockReset()
    getTasks.mockReset()
    getCategories.mockResolvedValue(categories)
    getTasks.mockResolvedValue(tasks)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('filters complete task trees by their root category', async () => {
    const user = userEvent.setup()
    renderLibrary()

    expect(await screen.findByRole('link', { name: /Make coffee/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Do laundry/ })).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: 'Home' }))

    expect(screen.getByRole('link', { name: /Make coffee/ })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Do laundry/ })).toBeNull()
  })

  it('moves a root task to a category and updates its label', async () => {
    assignCategory.mockResolvedValue({ rootId: laundryId, categoryId: errandsId })
    const user = userEvent.setup()
    renderLibrary()

    await user.click(await screen.findByLabelText('Organize Do laundry'))
    await user.selectOptions(screen.getByLabelText('Category for Do laundry'), errandsId)

    expect(assignCategory).toHaveBeenCalledWith(laundryId, errandsId)
    expect(
      within(await screen.findByRole('link', { name: /Do laundry/ })).getByText('Errands'),
    ).toBeTruthy()
  })

  it('offers to create a task directly in an empty category', async () => {
    getTasks.mockResolvedValue([tasks[1]])
    const user = userEvent.setup()
    renderLibrary()

    await user.click(await screen.findByRole('tab', { name: 'Home' }))

    expect(screen.getByRole('heading', { name: 'No tasks in Home' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create task in Home' }).getAttribute('href')).toBe(
      `/tasks/new?categoryId=${homeId}`,
    )
  })
})
