import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { authClient } from '../auth/auth-client'

export function AppShell() {
  const navigate = useNavigate()
  const [signOutPending, setSignOutPending] = useState(false)
  const [signOutError, setSignOutError] = useState('')

  async function signOut() {
    setSignOutPending(true)
    setSignOutError('')

    try {
      const { error } = await authClient.signOut()
      if (!error) {
        navigate('/sign-in', { replace: true })
        return
      }
    } catch {
      // The same safe message covers transport and server failures.
    }

    setSignOutError('We could not sign you out. Please try again.')
    setSignOutPending(false)
  }

  return (
    <div className="task-shell">
      <header className="site-header">
        <NavLink className="brand" to="/tasks" aria-label="Helping Hand tasks">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Helping Hand</span>
        </NavLink>
        <nav aria-label="Main navigation">
          <NavLink className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} to="/tasks">
            Tasks
          </NavLink>
          <NavLink
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            to="/recipients"
          >
            Recipients
          </NavLink>
          <button
            className="sign-out-button"
            type="button"
            onClick={signOut}
            disabled={signOutPending}
          >
            {signOutPending ? 'Signing out…' : 'Sign out'}
          </button>
        </nav>
      </header>

      {signOutError && (
        <div className="shell-notice" role="alert">
          {signOutError}
        </div>
      )}

      <Outlet />

      <footer className="site-footer">
        <span>Helping Hand</span>
        <p>Clear, repeatable guidance when you need it.</p>
      </footer>
    </div>
  )
}
