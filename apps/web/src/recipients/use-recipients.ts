import { useCallback, useEffect, useRef, useState } from 'react'
import { WorkspaceError } from '../lib/workspace-error'
import {
  createRecipient,
  deleteRecipient,
  listRecipients,
  type Recipient,
  revokeRecipientAccess,
  updateRecipient,
} from './recipient-workspace'

export type RecipientAction = 'create' | 'rename' | 'set-active' | 'delete' | 'revoke'
export type RecipientMutation =
  | { status: 'idle' }
  | { status: 'pending'; action: RecipientAction; targetId?: string }
  | { status: 'failed'; action: RecipientAction; targetId?: string; error: WorkspaceError }

type RecipientState = {
  recipients: Recipient[]
  status: 'loading' | 'ready' | 'error'
  error: WorkspaceError | null
}

export function useRecipients() {
  const requestId = useRef(0)
  const inFlight = useRef(false)
  const recipientsRef = useRef<Recipient[]>([])
  const [mutation, setMutation] = useState<RecipientMutation>({ status: 'idle' })
  const [announcement, setAnnouncement] = useState('')
  const [state, setState] = useState<RecipientState>({
    recipients: [],
    status: 'loading',
    error: null,
  })

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setState((current) => ({ ...current, status: 'loading', error: null }))

    try {
      const recipients = await listRecipients()
      if (requestId.current === currentRequest) {
        recipientsRef.current = recipients
        setState({ recipients, status: 'ready', error: null })
      }
    } catch (cause) {
      if (requestId.current === currentRequest) {
        const error =
          cause instanceof WorkspaceError
            ? cause
            : new WorkspaceError('unexpected', false, { cause })
        setState((current) => ({ ...current, status: 'error', error }))
      }
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      requestId.current += 1
    }
  }, [load])

  useEffect(() => {
    if (!announcement) return
    const timeout = window.setTimeout(() => setAnnouncement(''), 4000)
    return () => window.clearTimeout(timeout)
  }, [announcement])

  const beginMutation = useCallback((action: RecipientAction, targetId?: string) => {
    if (inFlight.current) return false
    inFlight.current = true
    setAnnouncement('')
    setMutation({ status: 'pending', action, targetId })
    return true
  }, [])

  const failMutation = useCallback(
    (action: RecipientAction, targetId: string | undefined, cause: unknown) => {
      const error =
        cause instanceof WorkspaceError ? cause : new WorkspaceError('unexpected', false, { cause })
      setMutation({ status: 'failed', action, targetId, error })
    },
    [],
  )

  /** Replaces one record in place, for a recipient a flow refreshed elsewhere. */
  const replace = useCallback((recipient: Recipient) => {
    const recipients = recipientsRef.current.map((current) =>
      current.id === recipient.id ? recipient : current,
    )
    recipientsRef.current = recipients
    setState((current) => ({ ...current, recipients }))
  }, [])

  const create = useCallback(
    async (displayName: string): Promise<Recipient | null> => {
      if (!beginMutation('create')) return null
      try {
        const recipient = await createRecipient(displayName)
        const recipients = [...recipientsRef.current, recipient]
        recipientsRef.current = recipients
        setState((current) => ({ ...current, recipients }))
        setMutation({ status: 'idle' })
        setAnnouncement(`${recipient.displayName} added.`)
        return recipient
      } catch (cause) {
        failMutation('create', undefined, cause)
        return null
      } finally {
        inFlight.current = false
      }
    },
    [beginMutation, failMutation],
  )

  const rename = useCallback(
    async (recipientId: string, displayName: string): Promise<Recipient | null> => {
      if (!beginMutation('rename', recipientId)) return null
      try {
        const recipient = await updateRecipient(recipientId, { displayName })
        replace(recipient)
        setMutation({ status: 'idle' })
        setAnnouncement(`${recipient.displayName} renamed.`)
        return recipient
      } catch (cause) {
        failMutation('rename', recipientId, cause)
        return null
      } finally {
        inFlight.current = false
      }
    },
    [beginMutation, failMutation, replace],
  )

  const setActive = useCallback(
    async (recipientId: string, isActive: boolean): Promise<Recipient | null> => {
      if (!beginMutation('set-active', recipientId)) return null
      try {
        const recipient = await updateRecipient(recipientId, { isActive })
        replace(recipient)
        setMutation({ status: 'idle' })
        setAnnouncement(
          isActive
            ? `${recipient.displayName} can be enrolled again.`
            : `${recipient.displayName} is disabled and their device access ended.`,
        )
        return recipient
      } catch (cause) {
        failMutation('set-active', recipientId, cause)
        return null
      } finally {
        inFlight.current = false
      }
    },
    [beginMutation, failMutation, replace],
  )

  const remove = useCallback(
    async (recipientId: string): Promise<boolean> => {
      if (!beginMutation('delete', recipientId)) return false
      try {
        await deleteRecipient(recipientId)
        const recipients = recipientsRef.current.filter(({ id }) => id !== recipientId)
        recipientsRef.current = recipients
        setState((current) => ({ ...current, recipients }))
        setMutation({ status: 'idle' })
        return true
      } catch (cause) {
        failMutation('delete', recipientId, cause)
        return false
      } finally {
        inFlight.current = false
      }
    },
    [beginMutation, failMutation],
  )

  const revokeAccess = useCallback(
    async (recipientId: string): Promise<boolean> => {
      if (!beginMutation('revoke', recipientId)) return false
      try {
        await revokeRecipientAccess(recipientId)
        // Revocation ends the device session; the profile and assignments stay.
        const recipients = recipientsRef.current.map((current) =>
          current.id === recipientId
            ? { ...current, hasActiveSession: false, pendingEnrollmentId: null }
            : current,
        )
        recipientsRef.current = recipients
        setState((current) => ({ ...current, recipients }))
        setMutation({ status: 'idle' })
        setAnnouncement('Device access revoked.')
        return true
      } catch (cause) {
        failMutation('revoke', recipientId, cause)
        return false
      } finally {
        inFlight.current = false
      }
    },
    [beginMutation, failMutation],
  )

  const dismissMutationError = useCallback(() => setMutation({ status: 'idle' }), [])

  return {
    recipients: state.recipients,
    status: state.status,
    error: state.error,
    mutation,
    announcement,
    retry: load,
    refresh: load,
    replace,
    create,
    rename,
    setActive,
    remove,
    revokeAccess,
    dismissMutationError,
  }
}
