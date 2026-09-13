import type { components } from '@helping-hand/api-client'
import type { EnrollmentPayload, RecipientSession } from '@helping-hand/schemas'
import { api, apiOrigin, recipientApi } from '@/lib/api'

type EnrollmentClaim = components['schemas']['EnrollmentClaim']
type RecipientIdentity = components['schemas']['RecipientIdentity']

export class EnrollmentApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message)
    this.name = 'EnrollmentApiError'
  }

  /**
   * Retrying cannot repair any of these: the enrollment is gone, in the wrong
   * state, or the request the device has stored is itself invalid.
   */
  get terminal() {
    return [400, 404, 409, 410].includes(this.status)
  }
}

function failure(response: Response, error: unknown) {
  const detail =
    typeof error === 'object' && error && 'detail' in error && typeof error.detail === 'string'
      ? error.detail
      : 'The request could not be completed.'
  const retryAfter = Number(response.headers.get('retry-after'))
  return new EnrollmentApiError(
    response.status,
    detail,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  )
}

export async function claimEnrollment(
  payload: EnrollmentPayload,
  claimantSecret: string,
): Promise<EnrollmentClaim> {
  const { data, error, response } = await api.POST('/api/enrollments/claim', {
    body: { payload, claimantSecret },
  })
  if (!data) throw failure(response, error)
  return data
}

export async function collectEnrollmentSession(
  enrollmentId: string,
  claimantSecret: string,
): Promise<RecipientSession | { state: 'claimed'; pollIntervalSeconds: number }> {
  const { data, error, response } = await api.POST('/api/enrollments/{enrollmentId}/session', {
    params: { path: { enrollmentId } },
    body: { claimantSecret },
  })
  if (!data) throw failure(response, error)
  return data
}

export async function getRecipientIdentity(token: string): Promise<RecipientIdentity> {
  const { data, error, response } = await recipientApi(token).GET('/api/recipient/me')
  if (!data) throw failure(response, error)
  return data
}

export async function signOutRecipient(token: string) {
  const response = await fetch(`${apiOrigin}/api/auth/sign-out`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw failure(response, await response.json().catch(() => null))
}
