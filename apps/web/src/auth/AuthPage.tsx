import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { authClient } from './auth-client'

type AuthMode = 'sign-in' | 'sign-up'

export function AuthPage({ mode }: { mode: AuthMode }) {
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const signingUp = mode === 'sign-up'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')

    try {
      const form = new FormData(event.currentTarget)
      const email = String(form.get('email'))
      const password = String(form.get('password'))
      const result = signingUp
        ? await authClient.signUp.email({
            email,
            password,
            name: String(form.get('name')),
          })
        : await authClient.signIn.email({ email, password })

      if (!result.error) {
        navigate('/tasks', { replace: true })
        return
      }

      setError(result.error.message ?? 'Authentication failed. Please try again.')
    } catch {
      setError('The authentication service is unavailable. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-heading">
        <Link className="brand auth-brand" to="/tasks" aria-label="Helping Hand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Helping Hand</span>
        </Link>

        <p className="eyebrow">{signingUp ? 'Create your account' : 'Welcome back'}</p>
        <h1 id="auth-heading">{signingUp ? 'Start building clear guidance.' : 'Sign in.'}</h1>
        <p className="auth-intro">
          {signingUp
            ? 'Create repeatable, step-by-step tasks you can use when you need them.'
            : 'Return to your task library and continue where you left off.'}
        </p>

        <form onSubmit={submit}>
          {signingUp && (
            <label>
              Name
              <input name="name" autoComplete="name" required />
            </label>
          )}

          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>

          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={signingUp ? 'new-password' : 'current-password'}
              minLength={8}
              required
            />
          </label>

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <button className="primary-button auth-submit" type="submit" disabled={pending}>
            {pending ? 'Please wait…' : signingUp ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="auth-switch">
          {signingUp ? 'Already have an account?' : 'New to Helping Hand?'}{' '}
          <Link to={signingUp ? '/sign-in' : '/sign-up'}>
            {signingUp ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </section>
    </main>
  )
}
