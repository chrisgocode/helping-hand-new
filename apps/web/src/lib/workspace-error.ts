export type WorkspaceFailureKind =
  | 'unauthenticated'
  | 'invalid'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'rate_limited'
  | 'unavailable'
  | 'ai_timeout'
  | 'ai_invalid_response'
  | 'ai_configuration'
  | 'unexpected'

const failureMessages: Record<WorkspaceFailureKind, string> = {
  unauthenticated: 'Your session has expired. Please sign in again.',
  invalid: 'Review your changes and try again.',
  not_found: 'The requested item could not be found.',
  conflict: 'This information changed before it could be saved.',
  gone: 'This is no longer available.',
  rate_limited: 'Too many requests were made. Please wait a moment and try again.',
  unavailable: 'The service is temporarily unavailable.',
  ai_timeout: 'AI generation took too long. Try again.',
  ai_invalid_response: 'Something went wrong. Please try again.',
  ai_configuration: 'AI generation is not configured correctly.',
  unexpected: 'The request could not be completed.',
}

export class WorkspaceError extends Error {
  readonly kind: WorkspaceFailureKind
  readonly retryable: boolean

  constructor(kind: WorkspaceFailureKind, retryable: boolean, options?: ErrorOptions) {
    super(failureMessages[kind], options)
    this.name = 'WorkspaceError'
    this.kind = kind
    this.retryable = retryable
  }
}

export function failureForStatus(status: number) {
  if (status === 401) return new WorkspaceError('unauthenticated', false)
  if (status === 400) return new WorkspaceError('invalid', false)
  if (status === 404) return new WorkspaceError('not_found', false)
  if (status === 409) return new WorkspaceError('conflict', false)
  if (status === 410) return new WorkspaceError('gone', false)
  if (status === 429) return new WorkspaceError('rate_limited', true)
  if (status >= 500) return new WorkspaceError('unavailable', true)
  return new WorkspaceError('unexpected', false)
}
