import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthPage } from './AuthPage'
import { authClient } from './auth-client'

vi.mock('./auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
  },
}))

const signIn = vi.mocked(authClient.signIn.email)

function renderSignIn() {
  render(
    <MemoryRouter initialEntries={['/sign-in']}>
      <Routes>
        <Route path="/sign-in" element={<AuthPage mode="sign-in" />} />
        <Route path="/tasks" element={<h1>Your tasks</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AuthPage', () => {
  beforeEach(() => signIn.mockReset())
  afterEach(cleanup)

  it('signs in and opens the task library', async () => {
    signIn.mockResolvedValueOnce({ data: {}, error: null } as never)
    const user = userEvent.setup()
    renderSignIn()

    await user.type(screen.getByLabelText('Email'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(signIn).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'password123',
    })
    expect(await screen.findByRole('heading', { name: 'Your tasks' })).toBeTruthy()
  })

  it('keeps the form visible when sign-in fails', async () => {
    signIn.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid email or password' },
    } as never)
    const user = userEvent.setup()
    renderSignIn()

    await user.type(screen.getByLabelText('Email'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'incorrect-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })
})
