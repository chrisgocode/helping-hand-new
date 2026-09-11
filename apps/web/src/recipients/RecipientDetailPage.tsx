import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Skeleton } from '../app/Skeleton'
import { authClient } from '../auth/auth-client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog'
import { useTaskLibrary } from '../tasks/use-task-library'
import { AssignmentPicker } from './AssignmentPicker'
import { EnrollmentPanel } from './EnrollmentPanel'
import { useEnrollment } from './use-enrollment'
import { useRecipientAssignments } from './use-recipient-assignments'
import { useRecipients } from './use-recipients'
import './RecipientDetailPage.css'

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading this recipient" aria-busy="true">
      <Skeleton className="recipient-skeleton-name" />
      <Skeleton className="recipient-skeleton-meta" />
    </div>
  )
}

export function RecipientDetailPage() {
  const navigate = useNavigate()
  const { recipientId = '' } = useParams()
  const library = useRecipients()
  const assignments = useRecipientAssignments(recipientId)
  const tasks = useTaskLibrary()
  const recipient = library.recipients.find(({ id }) => id === recipientId) ?? null
  const enrollment = useEnrollment(recipient, { onSettled: library.refresh })
  const deleting = library.mutation.status === 'pending' && library.mutation.action === 'delete'
  const deleteError =
    library.mutation.status === 'failed' && library.mutation.action === 'delete'
      ? library.mutation.error
      : null
  const revoking = library.mutation.status === 'pending' && library.mutation.action === 'revoke'
  const revokeError =
    library.mutation.status === 'failed' && library.mutation.action === 'revoke'
      ? library.mutation.error
      : null
  const enrollmentError = enrollment.phase.status === 'failed' ? enrollment.phase.error : null
  const unauthenticated =
    library.error?.kind === 'unauthenticated' ||
    (library.mutation.status === 'failed' && library.mutation.error.kind === 'unauthenticated') ||
    assignments.error?.kind === 'unauthenticated' ||
    (assignments.mutation.status === 'failed' &&
      assignments.mutation.error.kind === 'unauthenticated') ||
    tasks.error?.kind === 'unauthenticated' ||
    enrollmentError?.kind === 'unauthenticated'
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    if (!unauthenticated) return

    void authClient
      .signOut()
      .catch(() => undefined)
      .finally(() => navigate('/sign-in', { replace: true }))
  }, [navigate, unauthenticated])

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = draftName.trim()
    if (!name || !recipient) return
    const renamed = await library.rename(recipient.id, name)
    if (renamed) setRenaming(false)
  }

  async function revoke() {
    if (!recipient) return
    const revoked = await library.revokeAccess(recipient.id)
    if (revoked) setConfirmingRevoke(false)
  }

  async function remove() {
    if (!recipient) return
    if (await library.remove(recipient.id)) navigate('/recipients', { replace: true })
  }

  if (library.status === 'loading') {
    return (
      <main className="task-page recipient-detail-page">
        <DetailSkeleton />
      </main>
    )
  }

  // There is no endpoint for a single recipient, so an id that is missing from
  // the caretaker's own list is simply not theirs.
  if (!recipient) {
    return (
      <main className="task-page recipient-detail-page">
        <div className="empty-card recipient-missing-card">
          <div>
            <h1>Recipient not found</h1>
            <p>This recipient does not exist, or is no longer one of yours.</p>
            <Link className="primary-button" to="/recipients">
              Back to recipients
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="task-page recipient-detail-page">
      <nav aria-label="Breadcrumb">
        <Link className="back-link" to="/recipients">
          ← All recipients
        </Link>
      </nav>

      <section className="recipient-identity" aria-labelledby="recipient-heading">
        <div>
          <p className="eyebrow">Recipient</p>
          <h1 id="recipient-heading">{recipient.displayName}</h1>
        </div>
        <div className="recipient-identity-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setDraftName(recipient.displayName)
              setRenaming((current) => !current)
            }}
          >
            {renaming ? 'Cancel' : 'Rename'}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => library.setActive(recipient.id, !recipient.isActive)}
          >
            {recipient.isActive ? 'Disable recipient' : 'Enable recipient'}
          </button>
          <AlertDialog
            open={confirmingDelete}
            onOpenChange={(open) => {
              setConfirmingDelete(open)
              if (!open && deleteError) library.dismissMutationError()
            }}
          >
            <AlertDialogTrigger asChild>
              <button className="danger-button" type="button">
                Delete recipient
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent
              onEscapeKeyDown={(event) => {
                if (deleting) event.preventDefault()
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {recipient.displayName} permanently?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes their device access, assignments, and enrollment history. Your task
                  trees stay in your library.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deleteError && (
                <div className="notice error-notice" role="alert">
                  <strong>Recipient could not be deleted.</strong>
                  <span>{deleteError.message}</span>
                </div>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <button className="secondary-button" type="button" disabled={deleting}>
                    Keep recipient
                  </button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={deleting}
                    onClick={(event) => {
                      event.preventDefault()
                      void remove()
                    }}
                  >
                    {deleting
                      ? 'Deleting…'
                      : deleteError
                        ? 'Try deleting again'
                        : `Delete ${recipient.displayName}`}
                  </button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>

      {renaming && (
        <form className="recipient-form" onSubmit={submitRename}>
          <label className="recipient-form-field">
            <span>Recipient name</span>
            <input
              type="text"
              value={draftName}
              maxLength={100}
              onChange={(event) => setDraftName(event.target.value)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={!draftName.trim()}>
            Save name
          </button>
        </form>
      )}

      {!recipient.isActive && (
        <p className="recipient-disabled-note">
          This recipient is disabled. Their device access has ended and no device can be enrolled
          until you enable them again.
        </p>
      )}

      {library.mutation.status === 'failed' &&
        library.mutation.action !== 'delete' &&
        library.mutation.action !== 'revoke' &&
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
        {library.announcement || enrollment.announcement || assignments.announcement}
      </p>

      <section className="library-section" aria-labelledby="device-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Device access</p>
            <h2 id="device-heading">
              {recipient.hasActiveSession ? 'A device is enrolled' : 'No device is enrolled'}
            </h2>
          </div>
        </div>

        <EnrollmentPanel
          phase={enrollment.phase}
          notice={enrollment.notice}
          secondsRemaining={enrollment.secondsRemaining}
          recipientName={recipient.displayName}
          hasActiveSession={recipient.hasActiveSession}
          canEnroll={recipient.isActive}
          onIssue={() => void enrollment.issue()}
          onApprove={() => void enrollment.approve()}
          onCancel={() => void enrollment.cancel()}
          onDismiss={enrollment.dismiss}
        />

        {recipient.hasActiveSession && (
          <AlertDialog
            open={confirmingRevoke}
            onOpenChange={(open) => {
              setConfirmingRevoke(open)
              if (!open && revokeError) library.dismissMutationError()
            }}
          >
            <AlertDialogTrigger asChild>
              <button className="secondary-button" type="button">
                Revoke device access
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent
              onEscapeKeyDown={(event) => {
                if (revoking) event.preventDefault()
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>End this device&apos;s access?</AlertDialogTitle>
                <AlertDialogDescription>
                  {recipient.displayName} keeps their assigned tasks, but the device stops working
                  until you enroll it again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {revokeError && (
                <div className="notice error-notice" role="alert">
                  <strong>Device access could not be revoked.</strong>
                  <span>{revokeError.message}</span>
                </div>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <button className="secondary-button" type="button" disabled={revoking}>
                    Keep access
                  </button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={revoking}
                    onClick={(event) => {
                      event.preventDefault()
                      void revoke()
                    }}
                  >
                    {revoking ? 'Revoking…' : revokeError ? 'Try revoking access' : 'Revoke access'}
                  </button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </section>

      <section className="library-section" aria-labelledby="assignments-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Task assignments</p>
            <h2 id="assignments-heading">What {recipient.displayName} can follow</h2>
          </div>
        </div>

        {assignments.status === 'error' &&
          assignments.error &&
          assignments.error.kind !== 'unauthenticated' && (
            <div className="notice error-notice" role="alert">
              <strong>Assignments could not load.</strong>
              <span>{assignments.error.message}</span>
              {assignments.error.retryable && (
                <button type="button" onClick={assignments.retry}>
                  Try again
                </button>
              )}
            </div>
          )}

        {assignments.mutation.status === 'failed' &&
          assignments.mutation.error.kind !== 'unauthenticated' && (
            <div className="notice error-notice" role="alert">
              <strong>That assignment could not be saved.</strong>
              <span>{assignments.mutation.error.message}</span>
              <button type="button" onClick={assignments.dismissMutationError}>
                Dismiss
              </button>
            </div>
          )}

        {assignments.status === 'loading' ? (
          <div role="status" aria-label="Loading assignments" aria-busy="true">
            <Skeleton className="assignment-skeleton-title" />
          </div>
        ) : (
          <AssignmentPicker
            assignments={assignments.assignments}
            tasks={tasks.tasks}
            tasksLoading={tasks.status === 'loading'}
            mutation={assignments.mutation}
            onAssign={(taskId, title) =>
              void assignments.assign(taskId, title, recipient.displayName)
            }
            onUnassign={(taskId, title) =>
              void assignments.unassign(taskId, title, recipient.displayName)
            }
          />
        )}
      </section>
    </main>
  )
}
