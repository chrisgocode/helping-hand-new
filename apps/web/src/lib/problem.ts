/**
 * Stable problem types the API promises in
 * `docs/recipient-enrollment-client-contract.md`. They are read only where two
 * problems share a status; everything else maps by status alone.
 */
export const PROBLEM = {
  validation: 'urn:helping-hand:problem:validation',
  unauthorized: 'urn:helping-hand:problem:unauthorized',
  forbidden: 'urn:helping-hand:problem:forbidden',
  notFound: 'urn:helping-hand:problem:not-found',
  conflict: 'urn:helping-hand:problem:conflict',
  enrollmentNotFound: 'urn:helping-hand:problem:enrollment-not-found',
  enrollmentConflict: 'urn:helping-hand:problem:enrollment-conflict',
  enrollmentExpired: 'urn:helping-hand:problem:enrollment-expired',
  rateLimited: 'urn:helping-hand:problem:rate-limited',
} as const

/**
 * The parsed problem body openapi-fetch hands back, when it is one. A body that
 * is missing, unparsed, or shaped differently reads as no type at all, so every
 * caller can fall back to the status.
 */
export function problemTypeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  if (!('type' in error)) return null
  const { type } = error as { type: unknown }
  return typeof type === 'string' ? type : null
}

/** The API sends a fixed `Retry-After` in seconds; anything else is ignored. */
export function retryAfterSeconds(response: Response): number | null {
  const header = response.headers.get('Retry-After')
  if (!header) return null
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}
