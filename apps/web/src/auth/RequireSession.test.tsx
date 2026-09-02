import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authClient } from './auth-client'
import { RequireSession } from './RequireSession'

vi.mock('./auth-client', () => ({ authClient: { useSession: vi.fn() } }))

const useSession = vi.mocked(authClient.useSession)

function renderProtectedRoute() {
  render(
    <MemoryRouter initialEntries={['/tasks']}>
      <Routes>
        <Route element={<RequireSession />}>
          <Route path="/tasks" element={<h1>Your tasks</h1>} />
        </Route>
        <Route path="/sign-in" element={<h1>Sign in</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireSession', () => {
  beforeEach(() => useSession.mockReset())
  afterEach(cleanup)

  it('waits for the session before rendering protected content', () => {
    useSession.mockReturnValue({ data: null, isPending: true } as never)

    renderProtectedRoute()

    expect(screen.getByText('Checking your session…')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Your tasks' })).toBeNull()
  })

  it('redirects a guest to sign in', () => {
    useSession.mockReturnValue({ data: null, isPending: false } as never)

    renderProtectedRoute()

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
  })

  it('offers a retry when the session request fails', async () => {
    const refetch = vi.fn()
    useSession.mockReturnValue({
      data: null,
      isPending: false,
      error: new Error('network failure'),
      refetch,
    } as never)
    const user = userEvent.setup()

    renderProtectedRoute()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(refetch).toHaveBeenCalledOnce()
  })

  it('renders protected content for a signed-in user', () => {
    useSession.mockReturnValue({
      data: { session: { id: 'session-id' }, user: { id: 'user-id' } },
      isPending: false,
    } as never)

    renderProtectedRoute()

    expect(screen.getByRole('heading', { name: 'Your tasks' })).toBeTruthy()
  })
})
