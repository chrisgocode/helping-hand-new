import type { ProblemDetails } from '@helping-hand/schemas'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

type ProblemEnv = { Variables: { requestId: string } }

export function problem<E extends ProblemEnv, S extends ContentfulStatusCode>(
  c: Context<E>,
  input: Omit<ProblemDetails, 'status' | 'instance'>,
  status: S,
  headers?: Record<string, string>,
) {
  return c.json(
    {
      ...input,
      status,
      instance: `urn:request:${c.get('requestId')}`,
    } satisfies ProblemDetails,
    status,
    { 'Content-Type': 'application/problem+json', ...headers },
  )
}
