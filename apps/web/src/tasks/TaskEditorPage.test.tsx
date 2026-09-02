import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskEditorPage } from './TaskEditorPage'
import {
  deleteTaskTree,
  listTaskTrees,
  proposeTaskBreakdown,
  proposeTaskDurations,
  proposeTaskOrder,
  saveTaskTree,
  TaskWorkspaceError,
} from './task-workspace'

vi.mock('./task-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-workspace')>()),
  deleteTaskTree: vi.fn(),
  listTaskTrees: vi.fn(),
  proposeTaskBreakdown: vi.fn(),
  proposeTaskDurations: vi.fn(),
  proposeTaskOrder: vi.fn(),
  saveTaskTree: vi.fn(),
}))

const deleteTree = vi.mocked(deleteTaskTree)
const listTrees = vi.mocked(listTaskTrees)
const proposeBreakdown = vi.mocked(proposeTaskBreakdown)
const proposeDurations = vi.mocked(proposeTaskDurations)
const proposeOrder = vi.mocked(proposeTaskOrder)
const saveDraft = vi.mocked(saveTaskTree)

function renderEditor() {
  const router = createMemoryRouter(
    [
      { path: '/tasks/new', element: <TaskEditorPage /> },
      { path: '/tasks', element: <h1>Task library</h1> },
    ],
    { initialEntries: ['/tasks/new'] },
  )
  render(<RouterProvider router={router} />)
}

function renderSavedEditor() {
  const router = createMemoryRouter(
    [
      { path: '/tasks/:rootId/edit', element: <TaskEditorPage saved /> },
      { path: '/tasks', element: <h1>Task library</h1> },
    ],
    { initialEntries: ['/tasks/d9cb5e16-c35e-4c60-8e28-26aa744034ee/edit'] },
  )
  render(<RouterProvider router={router} />)
}

const savedTask = {
  id: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
  title: 'Make coffee',
  durationSeconds: null,
  revision: 2,
  children: [
    {
      id: '66e65fa9-dac8-4800-8ce3-482dcc9c6a45',
      title: 'Fill the coffee maker',
      durationSeconds: null,
      children: [],
    },
  ],
}

describe('TaskEditorPage', () => {
  beforeEach(() => {
    deleteTree.mockReset()
    listTrees.mockReset()
    proposeBreakdown.mockReset()
    proposeDurations.mockReset()
    proposeOrder.mockReset()
    saveDraft.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('creates and saves a recursive task tree', async () => {
    saveDraft.mockImplementationOnce(async (draft) => ({ ...draft, revision: 0 }))
    const user = userEvent.setup()
    renderEditor()

    await user.type(screen.getByLabelText('Task title'), 'Make coffee')
    await user.click(screen.getByRole('button', { name: 'Add subtask to Make coffee' }))
    await user.type(
      screen.getByLabelText('Task title, level 2, position 1'),
      'Fill the coffee maker',
    )
    await user.click(screen.getByRole('button', { name: 'Save task' }))

    expect(await screen.findByRole('heading', { name: 'Task library' })).toBeTruthy()
    expect(saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Make coffee',
        children: [expect.objectContaining({ title: 'Fill the coffee maker' })],
      }),
    )
  })

  it('generates and appends an AI breakdown without saving it', async () => {
    proposeBreakdown.mockImplementationOnce(async (_draft, taskId) => ({
      taskId,
      children: [
        { id: '66e65fa9-dac8-4800-8ce3-482dcc9c6a45', title: 'Get a mug' },
        { id: '9bf8bb56-0fbd-422f-9d4d-7741347dded2', title: 'Start the coffee maker' },
      ],
    }))
    const user = userEvent.setup()
    renderEditor()

    await user.type(screen.getByLabelText('Task title'), 'Make coffee')
    await user.click(screen.getByRole('button', { name: 'Break down Make coffee with AI' }))
    fireEvent.change(screen.getByRole('slider', { name: /Step detail/ }), {
      target: { value: '4' },
    })
    await user.click(screen.getByRole('button', { name: 'Generate subtasks' }))

    expect(await screen.findByDisplayValue('Get a mug')).toBeTruthy()
    expect(screen.getByDisplayValue('Start the coffee maker')).toBeTruthy()
    expect(screen.queryByText('AI proposal')).toBeNull()
    expect(proposeBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Make coffee', children: [] }),
      expect.any(String),
      4,
    )
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('preserves the draft when AI generation fails', async () => {
    proposeBreakdown.mockRejectedValueOnce(new TaskWorkspaceError('ai_timeout', true))
    const user = userEvent.setup()
    renderEditor()

    await user.type(screen.getByLabelText('Task title'), 'Make coffee')
    await user.click(screen.getByRole('button', { name: 'Break down Make coffee with AI' }))
    await user.click(screen.getByRole('button', { name: 'Generate subtasks' }))

    expect((await screen.findByRole('alert')).textContent).toContain('AI generation took too long')
    expect(screen.getByDisplayValue('Make coffee')).toBeTruthy()
    expect(screen.queryByLabelText('Task title, level 2, position 1')).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('estimates an actionable task locally without saving it', async () => {
    proposeDurations.mockImplementationOnce(async (_draft, taskId) => ({
      taskId,
      durations: [{ taskId, durationSeconds: 300 }],
    }))
    const user = userEvent.setup()
    renderEditor()

    await user.type(screen.getByLabelText('Task title'), 'Make coffee')
    await user.click(screen.getByRole('button', { name: 'Estimate missing times for Make coffee' }))

    expect(
      ((await screen.findByLabelText('Estimated minutes for Make coffee')) as HTMLInputElement)
        .value,
    ).toBe('5')
    expect(proposeDurations).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Make coffee' }),
      expect.any(String),
    )
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('edits actionable durations and derives the summary total', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.type(screen.getByLabelText('Task title'), 'Make coffee')
    await user.click(screen.getByRole('button', { name: 'Add subtask to Make coffee' }))
    await user.type(screen.getByLabelText('Task title, level 2, position 1'), 'Get a mug')
    await user.type(screen.getByLabelText('Estimated minutes for Get a mug'), '2')

    expect(screen.queryByLabelText('Estimated minutes for Make coffee')).toBeNull()
    expect(screen.getByText('2 min')).toBeTruthy()
  })

  it('asks before discarding an edited draft', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const user = userEvent.setup()
    renderEditor()

    await user.type(screen.getByLabelText('Task title'), 'Make coffee')
    await user.click(screen.getByRole('link', { name: 'Cancel' }))

    expect((screen.getByLabelText('Task title') as HTMLInputElement).value).toBe('Make coffee')

    await user.click(screen.getByRole('link', { name: 'Cancel' }))
    expect(await screen.findByRole('heading', { name: 'Task library' })).toBeTruthy()
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('loads and saves an existing tree at its current revision', async () => {
    listTrees.mockResolvedValueOnce([savedTask])
    saveDraft.mockImplementationOnce(async (draft) => ({ ...draft, revision: 3 }))
    const user = userEvent.setup()
    renderSavedEditor()

    const title = await screen.findByLabelText('Task title')
    expect((title as HTMLInputElement).value).toBe('Make coffee')
    await user.clear(title)
    await user.type(title, 'Make tea')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Make tea', revision: 2 }),
    )
    expect(await screen.findByRole('heading', { name: 'Task library' })).toBeTruthy()
  })

  it('estimates missing durations from a selected summary task', async () => {
    listTrees.mockResolvedValueOnce([savedTask])
    proposeDurations.mockResolvedValueOnce({
      taskId: savedTask.id,
      durations: [{ taskId: savedTask.children[0].id, durationSeconds: 60 }],
    })
    const user = userEvent.setup()
    renderSavedEditor()

    await user.click(
      await screen.findByRole('button', { name: 'Estimate missing times for Make coffee' }),
    )

    expect(proposeDurations).toHaveBeenCalledWith(savedTask, savedTask.id)
    expect(
      (
        (await screen.findByLabelText(
          'Estimated minutes for Fill the coffee maker',
        )) as HTMLInputElement
      ).value,
    ).toBe('1')
    expect(screen.getByText('1 min')).toBeTruthy()
  })

  it('prioritizes immediate subtasks locally while preserving their descendants', async () => {
    const secondId = '9bf8bb56-0fbd-422f-9d4d-7741347dded2'
    const nestedId = '4799a45d-c843-4521-b192-6c2628c518c4'
    const task = {
      ...savedTask,
      children: [
        {
          ...savedTask.children[0],
          children: [{ id: nestedId, title: 'Add water', durationSeconds: null, children: [] }],
        },
        { id: secondId, title: 'Get a mug', durationSeconds: null, children: [] },
      ],
    }
    listTrees.mockResolvedValueOnce([task])
    proposeOrder.mockResolvedValueOnce({
      taskId: task.id,
      orderedTaskIds: [secondId, task.children[0].id],
    })
    const user = userEvent.setup()
    renderSavedEditor()

    await user.click(
      await screen.findByRole('button', { name: 'Prioritize subtasks for Make coffee' }),
    )

    expect(
      (screen.getByLabelText('Task title, level 2, position 1') as HTMLInputElement).value,
    ).toBe('Get a mug')
    expect(screen.getByDisplayValue('Add water')).toBeTruthy()
    expect(proposeOrder).toHaveBeenCalledWith(task, task.id)
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('reports when subtasks are already in a logical order without dirtying the draft', async () => {
    const secondId = '9bf8bb56-0fbd-422f-9d4d-7741347dded2'
    const task = {
      ...savedTask,
      children: [
        savedTask.children[0],
        { id: secondId, title: 'Get a mug', durationSeconds: null, children: [] },
      ],
    }
    listTrees.mockResolvedValueOnce([task])
    proposeOrder.mockResolvedValueOnce({
      taskId: task.id,
      orderedTaskIds: task.children.map(({ id }) => id),
    })
    const user = userEvent.setup()
    renderSavedEditor()

    await user.click(
      await screen.findByRole('button', { name: 'Prioritize subtasks for Make coffee' }),
    )

    expect((await screen.findByRole('status')).textContent).toContain(
      'These subtasks are already in a logical order.',
    )
    expect(
      (screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('keeps local edits after a conflict and reloads only after confirmation', async () => {
    listTrees
      .mockResolvedValueOnce([savedTask])
      .mockResolvedValueOnce([{ ...savedTask, title: 'Latest coffee steps', revision: 3 }])
    saveDraft.mockRejectedValueOnce(new TaskWorkspaceError('conflict', false))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderSavedEditor()

    const title = await screen.findByLabelText('Task title')
    await user.clear(title)
    await user.type(title, 'My local coffee steps')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect((screen.getByLabelText('Task title') as HTMLInputElement).value).toBe(
      'My local coffee steps',
    )
    await user.click(screen.getByRole('button', { name: 'Reload saved version' }))

    expect(await screen.findByDisplayValue('Latest coffee steps')).toBeTruthy()
  })

  it('deletes an existing tree after confirmation', async () => {
    listTrees.mockResolvedValueOnce([savedTask])
    deleteTree.mockResolvedValueOnce()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderSavedEditor()

    await user.click(await screen.findByRole('button', { name: 'Delete task' }))

    expect(deleteTree).toHaveBeenCalledWith(savedTask.id, savedTask.revision)
    expect(await screen.findByRole('heading', { name: 'Task library' })).toBeTruthy()
  })
})
