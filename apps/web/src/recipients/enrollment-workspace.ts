import type { components } from '@helping-hand/api-client'
import { api } from '../lib/api'
import { PROBLEM, problemTypeOf, retryAfterSeconds } from '../lib/problem'
import { failureForStatus, WorkspaceError, type WorkspaceFailureKind } from '../lib/workspace-error'

export type IssuedEnrollment = components['schemas']['IssuedEnrollment']
export type EnrollmentStatus = components['schemas']['EnrollmentStatus']
export type EnrollmentPayload = IssuedEnrollment['payload']

class EnrollmentWorkspaceError extends WorkspaceError {
  readonly problemType: string | null
  readonly retryAfterSeconds: number | null

  constructor(
    kind: WorkspaceFailureKind,
    retryable: boolean,
    message: string,
    details: { problemType?: string | null; retryAfterSeconds?: number | null } = {},
  ) {
    super(kind, retryable)
    this.name = 'EnrollmentWorkspaceError'
    this.message = message
    this.problemType = details.problemType ?? null
    this.retryAfterSeconds = details.retryAfterSeconds ?? null
  }
}

export function isEnrollmentError(error: unknown): error is EnrollmentWorkspaceError {
  return error instanceof EnrollmentWorkspaceError
}

function rateLimited(response: Response, message: string) {
  return new EnrollmentWorkspaceError('rate_limited', true, message, {
    problemType: PROBLEM.rateLimited,
    retryAfterSeconds: retryAfterSeconds(response),
  })
}

/**
 * The QR symbol carries the payload object verbatim, with this key order. The
 * device client decodes it with the matching reader below, so the two halves
 * only agree if this stays fixed.
 */
export function encodeEnrollmentPayload(payload: EnrollmentPayload): string {
  return JSON.stringify({
    version: payload.version,
    enrollmentId: payload.enrollmentId,
    secret: payload.secret,
  })
}

/** The executable half of the encoding contract; the device client mirrors it. */
export function decodeEnrollmentPayload(encoded: string): EnrollmentPayload | null {
  try {
    const parsed: unknown = JSON.parse(encoded)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { version, enrollmentId, secret } = parsed as Record<string, unknown>
    if (version !== 1 || typeof enrollmentId !== 'string' || typeof secret !== 'string') return null
    return { version, enrollmentId, secret }
  } catch {
    return null
  }
}

export async function issueEnrollment(recipientId: string): Promise<IssuedEnrollment> {
  try {
    const { data, error, response } = await api.POST('/api/recipients/{recipientId}/enrollments', {
      params: { path: { recipientId } },
    })

    if (error) {
      if (response.status === 404) {
        throw new EnrollmentWorkspaceError('not_found', false, 'This recipient could not be found.')
      }
      if (response.status === 409) {
        throw new EnrollmentWorkspaceError(
          'conflict',
          false,
          'This recipient is disabled. Turn their access back on before enrolling a device.',
        )
      }
      if (response.status === 429) {
        throw rateLimited(
          response,
          'Too many enrollments were started. Wait a minute and try again.',
        )
      }
      throw failureForStatus(response.status)
    }
    if (!data) throw new WorkspaceError('unexpected', false)

    return data
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function getEnrollment(enrollmentId: string): Promise<EnrollmentStatus> {
  try {
    const { data, error, response } = await api.GET('/api/enrollments/{enrollmentId}', {
      params: { path: { enrollmentId } },
    })

    if (error) {
      if (response.status === 404) {
        throw new EnrollmentWorkspaceError(
          'not_found',
          false,
          'This enrollment is no longer available.',
        )
      }
      if (response.status === 429) {
        throw rateLimited(response, 'Checking less often for a moment.')
      }
      throw failureForStatus(response.status)
    }
    if (!data) throw new WorkspaceError('unexpected', false)

    return data
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function approveEnrollment(
  enrollmentId: string,
  matchingCode: string,
): Promise<EnrollmentStatus> {
  try {
    const { data, error, response } = await api.POST('/api/enrollments/{enrollmentId}/approve', {
      params: { path: { enrollmentId } },
      body: { matchingCode },
    })

    if (error) {
      const problemType = problemTypeOf(error)

      if (response.status === 400) {
        throw new EnrollmentWorkspaceError(
          'invalid',
          false,
          'Enter the six-character matching code shown on the device.',
        )
      }
      if (response.status === 404) {
        throw new EnrollmentWorkspaceError(
          'not_found',
          false,
          'This enrollment is no longer available. Show a new code.',
        )
      }
      // Two different 409s share this status: a stale code the caretaker is
      // still looking at, and an enrollment that is not awaiting approval.
      if (response.status === 409 && problemType === PROBLEM.enrollmentConflict) {
        throw new EnrollmentWorkspaceError(
          'conflict',
          false,
          'The device is not showing this code any more. Compare the codes again before approving.',
          { problemType },
        )
      }
      if (response.status === 409) {
        throw new EnrollmentWorkspaceError(
          'conflict',
          false,
          'This enrollment is not waiting for approval. Show a new code.',
          { problemType },
        )
      }
      if (response.status === 410) {
        throw new EnrollmentWorkspaceError(
          'gone',
          false,
          'This enrollment expired. Show a new code to continue.',
          { problemType },
        )
      }
      if (response.status === 429) {
        throw rateLimited(response, 'Too many requests were made. Wait a moment and try again.')
      }
      throw failureForStatus(response.status)
    }
    if (!data) throw new WorkspaceError('unexpected', false)

    return data
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}

export async function cancelEnrollment(enrollmentId: string): Promise<void> {
  try {
    const { response } = await api.DELETE('/api/enrollments/{enrollmentId}', {
      params: { path: { enrollmentId } },
    })

    // Cancelling an enrollment that is already gone achieved the goal.
    if (!response.ok && response.status !== 404) throw failureForStatus(response.status)
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause
    throw new WorkspaceError('unavailable', true, { cause })
  }
}
