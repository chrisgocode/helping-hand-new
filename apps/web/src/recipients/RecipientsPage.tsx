import { RECIPIENT_LIMITS } from '@helping-hand/schemas'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Skeleton } from '../app/Skeleton'
import { authClient } from '../auth/auth-client'
import type { Recipient } from './recipient-workspace'
import { useRecipients } from './use-recipients'
import './RecipientsPage.css'

function RecipientsSkeleton() {
  return (
    <div
      className="recipient-list recipient-list-skeleton"
      role="status"
      aria-label="Loading recipients"
      aria-busy="true"
    >
      {['first', 'second', 'third'].map((item) => (
        <div className="recipient-card recipient-card-skeleton" key={item} aria-hidden="true">
          <div className="recipient-skeleton-copy">
            <Skeleton className="recipient-skeleton-name" />
            <Skeleton className="recipient-skeleton-meta" />
          </div>
          <Skeleton className="recipient-skeleton-action" />
        </div>
      ))}
    </div>
  )
}

/** The one status a caretaker most needs to see at a glance. */
function statusChip(recipient: Recipient) {
  if (!recipient.isActive) return { label: 'Disabled', modifier: 'disabled' }
  if (recipient.hasActiveSession) return { label: 'Device active', modifier: 'active' }
  if (recipient.pendingEnrollmentId) return { label: 'Enrollment pending', modifier: 'pending' }
  return { label: 'No device', modifier: 'none' }
}

export function RecipientsPage() {
  const navigate = useNavigate()
  const library = useRecipients()
  const [displayName, setDisplayName] = useState('')
  const atLimit = library.recipients.length >= RECIPIENT_LIMITS.maxRecipientsPerCaretaker
  const creating = library.mutation.status === 'pending' && library.mutation.action === 'create'

  useEffect(() => {
    const unauthenticated =
      library.error?.kind === 'unauthenticated' ||
      (library.mutation.status === 'failed' && library.mutation.error.kind === 'unauthenticated')
    if (!unauthenticated) return

    void authClient
      .signOut()
      .catch(() => undefined)
      .finally(() => navigate('/sign-in', { replace: true }))
  }, [library.error, library.mutation, navigate])

  async function addRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = displayName.trim()
    if (!name || atLimit) return
    const recipient = await library.create(name)
    if (recipient) setDisplayName('')
  }

  return (
    <main className="task-page dashboard-page">
      <section className="dashboard-intro">
        <div>
          <p className="eyebrow">Recipient access</p>
          <h1>
            The people
            <br />
            you support.
          </h1>
          <p className="intro-copy">
            Each recipient follows the task trees you assign on their own device. Enroll a device to
            give them access, and end it whenever you need to.
          </p>
        </div>
      </section>

      <section className="library-section" aria-labelledby="recipients-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recipients</p>
            <h2 id="recipients-heading">Everyone you support</h2>
          </div>
          {library.status === 'ready' && (
            <span className="count-pill">
              {library.recipients.length} of {RECIPIENT_LIMITS.maxRecipientsPerCaretaker}
            </span>
          )}
        </div>

        <form className="recipient-form" onSubmit={addRecipient}>
          <label className="recipient-form-field">
            <span>Recipient name</span>
            <input
              type="text"
              value={displayName}
              maxLength={100}
              placeholder="Add someone you support"
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={atLimit}
            />
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={creating || atLimit || !displayName.trim()}
          >
            {creating ? 'Adding…' : 'Add recipient'}
          </button>
        </form>

        {atLimit && (
          <p className="recipient-limit-note">
            You can support up to {RECIPIENT_LIMITS.maxRecipientsPerCaretaker} recipients. Delete
            one before adding another.
          </p>
        )}

        {library.status === 'error' &&
          library.error &&
          library.error.kind !== 'unauthenticated' && (
            <div className="notice error-notice" role="alert">
              <strong>Recipients could not load.</strong>
              <span>{library.error.message}</span>
              {library.error.retryable && (
                <button type="button" onClick={library.retry}>
                  Try again
                </button>
              )}
            </div>
          )}

        {library.mutation.status === 'failed' &&
          library.mutation.error.kind !== 'unauthenticated' && (
            <div className="notice error-notice" role="alert">
              <strong>That change could not be saved.</strong>
              <span>{library.mutation.error.message}</span>
              <button type="button" onClick={library.dismissMutationError}>
                Dismiss
              </button>
            </div>
          )}

        <p className="visually-hidden" aria-live="polite">
          {library.announcement}
        </p>

        {library.status === 'loading' && <RecipientsSkeleton />}

        {library.status === 'ready' && library.recipients.length === 0 && (
          <div className="empty-card">
            <span className="empty-rail" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <div>
              <h3>No recipients yet</h3>
              <p>
                Add the first person you support to start assigning tasks and enrolling a device.
              </p>
            </div>
          </div>
        )}

        {library.status === 'ready' && library.recipients.length > 0 && (
          <ul className="recipient-list">
            {library.recipients.map((recipient) => {
              const chip = statusChip(recipient)
              return (
                <li className="recipient-card" key={recipient.id}>
                  <div className="recipient-card-copy">
                    <h3>{recipient.displayName}</h3>
                    <span className={`recipient-status-chip ${chip.modifier}`}>{chip.label}</span>
                  </div>
                  <Link className="secondary-button" to={`/recipients/${recipient.id}`}>
                    Manage
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}
