import type { ProblemDetails } from '@helping-hand/schemas'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { TaskRouteEnv } from '../types/task'

export function problem(
  c: Context<TaskRouteEnv>,
  input: Omit<ProblemDetails, 'status' | 'instance'>,
  status: ContentfulStatusCode,
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
