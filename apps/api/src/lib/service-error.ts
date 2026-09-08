import type { ErrorHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApiEnv } from '../types/api'
import { problem } from './problem'

type ServiceError<Code extends string> = Error & { readonly code: Code }

/** One problem per service error code. `detail` defaults to the error message. */
type ProblemByCode<Code extends string> = Record<
  Code,
  { type: string; title: string; status: ContentfulStatusCode; detail?: string }
>

/**
 * Every service reports failures as a small set of codes, and every controller
 * turns those codes into problems the same way. Only the mapping differs, so
 * each controller supplies one and shares the unhandled-error response.
 */
export function serviceErrorHandler<Code extends string>(
  serviceError: abstract new (...args: never[]) => ServiceError<Code>,
  problems: ProblemByCode<Code>,
): ErrorHandler<ApiEnv> {
  return (error, c) => {
    if (!(error instanceof serviceError)) {
      c.get('logger').error({
        event: 'unhandled_error',
        code: 'internal_error',
        route: c.req.routePath,
      })
      return problem(
        c,
        {
          type: 'urn:helping-hand:problem:internal-error',
          title: 'Internal server error',
          detail: 'The request could not be completed.',
          retryable: false,
        },
        500,
      )
    }

    const { status, detail, ...rest } = problems[error.code]
    return problem(c, { ...rest, detail: detail ?? error.message, retryable: false }, status)
  }
}
