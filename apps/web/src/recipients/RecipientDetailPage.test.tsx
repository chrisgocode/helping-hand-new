import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authClient } from '../auth/auth-client'
import { WorkspaceError } from '../lib/workspace-error'
import { listTaskTrees } from '../tasks/task-workspace'
import { issueEnrollment } from './enrollment-workspace'
import { RecipientDetailPage } from './RecipientDetailPage'
import {
  assignRecipientTask,
  deleteRecipient,
  listRecipientAssignments,
  listRecipients,
  revokeRecipientAccess,
  unassignRecipientTask,
  updateRecipient,
} from './recipient-workspace'

vi.mock('./recipient-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recipient-workspace')>()),
  assignRecipientTask: vi.fn(),
  deleteRecipient: vi.fn(),
  listRecipientAssignments: vi.fn(),
  listRecipients: vi.fn(),
  revokeRecipientAccess: vi.fn(),
  unassignRecipientTask: vi.fn(),
  updateRecipient: vi.fn(),
}))

vi.mock('../tasks/task-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tasks/task-workspace')>()),
  listTaskTrees: vi.fn(),
}))

vi.mock('./enrollment-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./enrollment-workspace')>()),
  issueEnrollment: vi.fn(),
}))

vi.mock('../auth/auth-client', () => ({
  authClient: { signOut: vi.fn().mockResolvedValue({ error: null }) },
}))

const assign = vi.mocked(assignRecipientTask)
const removeRecipient = vi.mocked(deleteRecipient)
const getAssignments = vi.mocked(listRecipientAssignments)
const getRecipients = vi.mocked(listRecipients)
const getTasks = vi.mocked(listTaskTrees)
const revoke = vi.mocked(revokeRecipientAccess)
const unassign = vi.mocked(unassignRecipientTask)
const update = vi.mocked(updateRecipient)
const issue = vi.mocked(issueEnrollment)
const signOut = vi.mocked(authClient.signOut)

const recipientId = '11111111-1111-4111-8111-111111111111'
const coffeeId = 'd9cb5e16-c35e-4c60-8e28-26aa744034ee'
const laundryId = '4799a45d-c843-4521-b192-6c2628c518c4'
const goneId = '99999999-9999-4999-8999-999999999999'

const alex = {
  id: recipientId,
  displayName: 'Alex',
  isActive: true,
  hasActiveSession: true,
  pendingEnrollmentId: null,
  createdAt: '2026-09-02T12:00:00.000Z',
  updatedAt: '2026-09-02T12:00:00.000Z',
}

const tasks = [
  {
    id: coffeeId,
    title: 'Make coffee',
    durationSeconds: null,
    categoryId: null,
    revision: 1,
    children: [],
  },
  {
    id: laundryId,
    title: 'Do laundry',
    durationSeconds: null,
    categoryId: null,
    revision: 1,
    children: [{ id: 'child', title: 'Sort colours', durationSeconds: 60, children: [] }],
  },
]

function renderPage(id = recipientId) {
  const router = createMemoryRouter(
    [
      { path: '/recipients/:recipientId', element: <RecipientDetailPage /> },
      { path: '/recipients', element: <h1>All recipients</h1> },
      { path: '/sign-in', element: <h1>Sign in</h1> },
    ],
    { initialEntries: [`/recipients/${id}`] },
  )
  render(<RouterProvider router={router} />)
}

describe('RecipientDetailPage', () => {
  beforeEach(() => {
    assign.mockReset()
    removeRecipient.mockReset()
    getAssignments.mockReset()
    getRecipients.mockReset()
    getTasks.mockReset()
    revoke.mockReset()
    unassign.mockReset()
    update.mockReset()
    issue.mockReset()
    signOut.mockClear()
    getRecipients.mockResolvedValue([alex])
    getAssignments.mockResolvedValue([
      { rootTaskId: laundryId, createdAt: '2026-09-02T12:00:00.000Z' },
    ])
    getTasks.mockResolvedValue(tasks as never)
  })

  afterEach(cleanup)

  it("says so when the id is not one of the caretaker's recipients", async () => {
    renderPage(goneId)

    expect(await screen.findByRole('heading', { name: 'Recipient not found' })).toBeTruthy()
  })

  it('signs out when enrollment reports an expired caretaker session', async () => {
    issue.mockRejectedValue(new WorkspaceError('unauthenticated', false))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Replace this device' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('names assigned tasks using the caretaker task library', async () => {
    renderPage()

    const row = await screen.findByRole('listitem')
    expect(within(row).getByText('Do laundry')).toBeTruthy()
    expect(within(row).getByText('1 top-level step')).toBeTruthy()
  })

  it('keeps an assignment whose task has left the library removable', async () => {
    getAssignments.mockResolvedValue([
      { rootTaskId: goneId, createdAt: '2026-09-02T12:00:00.000Z' },
    ])
    unassign.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    const row = await screen.findByRole('listitem')
    expect(within(row).getByText('This task is no longer in your library')).toBeTruthy()

    await user.click(within(row).getByRole('button', { name: 'Remove' }))

    expect(unassign).toHaveBeenCalledWith(recipientId, goneId)
  })

  it('assigns a task the recipient does not have yet', async () => {
    assign.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('listitem')
    await user.selectOptions(screen.getByLabelText('Task to assign'), coffeeId)
    await user.click(screen.getByRole('button', { name: 'Assign task' }))

    expect(assign).toHaveBeenCalledWith(recipientId, coffeeId)
    expect(await screen.findByText('Make coffee assigned to Alex.')).toBeTruthy()
  })

  it('confirms before ending device access', async () => {
    revoke.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Revoke device access' }))

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText("End this device's access?")).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Revoke access' }))

    expect(revoke).toHaveBeenCalledWith(recipientId)
    expect(await screen.findByRole('heading', { name: 'No device is enrolled' })).toBeTruthy()
  })

  it('closes the revoke modal with Escape and restores focus', async () => {
    const user = userEvent.setup()
    renderPage()

    const trigger = await screen.findByRole('button', { name: 'Revoke device access' })
    await user.click(trigger)
    expect(screen.getByRole('alertdialog', { name: "End this device's access?" })).toBeTruthy()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('alertdialog', { name: "End this device's access?" })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('permanently deletes a recipient only after confirmation', async () => {
    removeRecipient.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Delete recipient' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Delete Alex permanently?' })
    expect(within(dialog).getByText('Delete Alex permanently?')).toBeTruthy()
    expect(removeRecipient).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Delete Alex' }))

    expect(removeRecipient).toHaveBeenCalledWith(recipientId)
    expect(await screen.findByRole('heading', { name: 'All recipients' })).toBeTruthy()
  })

  it('closes the deletion modal with Escape and restores focus', async () => {
    const user = userEvent.setup()
    renderPage()

    const trigger = await screen.findByRole('button', { name: 'Delete recipient' })
    await user.click(trigger)
    expect(screen.getByRole('alertdialog', { name: 'Delete Alex permanently?' })).toBeTruthy()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('alertdialog', { name: 'Delete Alex permanently?' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('does not present an unrelated mutation as deletion', async () => {
    let resolveRename!: (value: typeof alex) => void
    update.mockImplementationOnce(() => new Promise((resolve) => (resolveRename = resolve)))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Rename' }))
    await user.clear(screen.getByLabelText('Recipient name'))
    await user.type(screen.getByLabelText('Recipient name'), 'Alexander')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    await user.click(screen.getByRole('button', { name: 'Delete recipient' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Delete Alex permanently?' })
    expect(
      within(dialog).getByRole('button', { name: 'Delete Alex' }).hasAttribute('disabled'),
    ).toBe(false)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog', { name: 'Delete Alex permanently?' })).toBeNull()

    await act(async () => resolveRename({ ...alex, displayName: 'Alexander' }))
  })

  it('shows a deletion failure in the modal and lets the caretaker retry', async () => {
    removeRecipient
      .mockRejectedValueOnce(new WorkspaceError('unavailable', true))
      .mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Delete recipient' }))
    await user.click(screen.getByRole('button', { name: 'Delete Alex' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Delete Alex permanently?' })
    const failure = await within(dialog).findByRole('alert')
    expect(within(failure).getByText('The service is temporarily unavailable.')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Try deleting again' }))

    expect(removeRecipient).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('heading', { name: 'All recipients' })).toBeTruthy()
  })

  it('clears a deletion failure when the modal closes', async () => {
    removeRecipient.mockRejectedValueOnce(new WorkspaceError('unavailable', true))
    const user = userEvent.setup()
    renderPage()

    const trigger = await screen.findByRole('button', { name: 'Delete recipient' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Delete Alex' }))
    expect(await screen.findByRole('alert')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Keep recipient' }))
    await user.click(trigger)

    const dialog = screen.getByRole('alertdialog', { name: 'Delete Alex permanently?' })
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Delete Alex' })).toBeTruthy()
  })

  it('shows a revoke failure in the modal and lets the caretaker retry', async () => {
    revoke
      .mockRejectedValueOnce(new WorkspaceError('unavailable', true))
      .mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Revoke device access' }))
    await user.click(screen.getByRole('button', { name: 'Revoke access' }))

    const dialog = screen.getByRole('alertdialog', { name: "End this device's access?" })
    const failure = await within(dialog).findByRole('alert')
    expect(within(failure).getByText('The service is temporarily unavailable.')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Try revoking access' }))

    expect(revoke).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('heading', { name: 'No device is enrolled' })).toBeTruthy()
  })
})
