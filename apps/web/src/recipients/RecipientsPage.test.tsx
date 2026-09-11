import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceError } from '../lib/workspace-error'
import { RecipientsPage } from './RecipientsPage'
import { createRecipient, listRecipients } from './recipient-workspace'

vi.mock('./recipient-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recipient-workspace')>()),
  createRecipient: vi.fn(),
  listRecipients: vi.fn(),
}))

vi.mock('../auth/auth-client', () => ({
  authClient: { signOut: vi.fn().mockResolvedValue({ error: null }) },
}))

const getRecipients = vi.mocked(listRecipients)
const addRecipient = vi.mocked(createRecipient)

const base = {
  isActive: true,
  hasActiveSession: false,
  pendingEnrollmentId: null,
  createdAt: '2026-09-02T12:00:00.000Z',
  updatedAt: '2026-09-02T12:00:00.000Z',
}

const alex = { ...base, id: '11111111-1111-4111-8111-111111111111', displayName: 'Alex' }
const dad = {
  ...base,
  id: '22222222-2222-4222-8222-222222222222',
  displayName: 'Dad',
  hasActiveSession: true,
}
const sam = {
  ...base,
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'Sam',
  pendingEnrollmentId: '44444444-4444-4444-8444-444444444444',
}
const kim = {
  ...base,
  id: '55555555-5555-4555-8555-555555555555',
  displayName: 'Kim',
  isActive: false,
}

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/recipients', element: <RecipientsPage /> },
      { path: '/recipients/:recipientId', element: <h1>Recipient detail</h1> },
      { path: '/sign-in', element: <h1>Sign in</h1> },
    ],
    { initialEntries: ['/recipients'] },
  )
  render(<RouterProvider router={router} />)
}

describe('RecipientsPage', () => {
  beforeEach(() => {
    getRecipients.mockReset()
    addRecipient.mockReset()
  })

  afterEach(cleanup)

  it('shows a skeleton while recipients load', () => {
    getRecipients.mockReturnValue(new Promise(() => undefined))
    renderPage()

    expect(screen.getByRole('status', { name: 'Loading recipients' })).toBeTruthy()
  })

  it('names the access state of every recipient', async () => {
    getRecipients.mockResolvedValue([alex, dad, sam, kim])
    renderPage()

    const list = await screen.findByRole('list')
    const rows = within(list).getAllByRole('listitem')

    expect(within(rows[0]).getByText('No device')).toBeTruthy()
    expect(within(rows[1]).getByText('Device active')).toBeTruthy()
    expect(within(rows[2]).getByText('Enrollment pending')).toBeTruthy()
    expect(within(rows[3]).getByText('Disabled')).toBeTruthy()
    expect(within(rows[1]).getByRole('link', { name: 'Manage' }).getAttribute('href')).toBe(
      `/recipients/${dad.id}`,
    )
  })

  it('invites a first recipient when there are none', async () => {
    getRecipients.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText('No recipients yet')).toBeTruthy()
  })

  it('adds a recipient and announces it', async () => {
    const user = userEvent.setup()
    getRecipients.mockResolvedValue([])
    addRecipient.mockResolvedValue(alex)
    renderPage()

    await screen.findByText('No recipients yet')
    await user.type(screen.getByLabelText('Recipient name'), 'Alex')
    await user.click(screen.getByRole('button', { name: 'Add recipient' }))

    expect(addRecipient).toHaveBeenCalledWith('Alex')
    expect(await screen.findByRole('heading', { name: 'Alex' })).toBeTruthy()
    expect(screen.getByText('Alex added.')).toBeTruthy()
    expect((screen.getByLabelText('Recipient name') as HTMLInputElement).value).toBe('')
  })

  it('explains a failed load and offers a retry when the failure is retryable', async () => {
    const user = userEvent.setup()
    getRecipients.mockRejectedValueOnce(new WorkspaceError('unavailable', true))
    getRecipients.mockResolvedValueOnce([alex])
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Recipients could not load.')).toBeTruthy()

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: 'Alex' })).toBeTruthy()
  })

  it('reports a failed change without dropping the list', async () => {
    const user = userEvent.setup()
    getRecipients.mockResolvedValue([alex])
    addRecipient.mockRejectedValue(new WorkspaceError('conflict', false))
    renderPage()

    await screen.findByRole('heading', { name: 'Alex' })
    await user.type(screen.getByLabelText('Recipient name'), 'Dad')
    await user.click(screen.getByRole('button', { name: 'Add recipient' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('That change could not be saved.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Alex' })).toBeTruthy()
  })

  it('stops new recipients at the supported limit', async () => {
    getRecipients.mockResolvedValue(
      Array.from({ length: 25 }, (_item, index) => ({
        ...base,
        id: `${`${index}`.padStart(8, '0')}-0000-4000-8000-000000000000`,
        displayName: `Recipient ${index}`,
      })),
    )
    renderPage()

    await screen.findByText('25 of 25')
    expect((screen.getByLabelText('Recipient name') as HTMLInputElement).disabled).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Add recipient' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      screen.getByText('You can support up to 25 recipients. Delete one before adding another.'),
    ).toBeTruthy()
  })
})
