import { Navigate, Outlet } from 'react-router'
import { Skeleton } from '../app/Skeleton'
import { authClient } from './auth-client'

function SessionLoading() {
  return (
    <main
      className="session-loading"
      role="status"
      aria-label="Checking your session"
      aria-busy="true"
    >
      <div className="session-skeleton">
        <Skeleton className="session-skeleton-mark" />
        <Skeleton className="session-skeleton-title" />
        <Skeleton className="session-skeleton-copy" />
      </div>
    </main>
  )
}

function SessionRoute({ guest }: { guest: boolean }) {
  const { data: session, isPending, error, refetch } = authClient.useSession()

  if (isPending) return <SessionLoading />
  if (error) {
    return (
      <main className="session-loading" role="alert">
        <div className="session-error">
          <strong>We could not check your session.</strong>
          <button type="button" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      </main>
    )
  }
  if (guest && session) return <Navigate to="/tasks" replace />
  if (!guest && !session) return <Navigate to="/sign-in" replace />

  return <Outlet />
}

export function RequireSession() {
  return <SessionRoute guest={false} />
}

export function RequireGuest() {
  return <SessionRoute guest />
}
