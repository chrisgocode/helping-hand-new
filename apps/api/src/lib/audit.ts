import type { Context } from 'hono'
import type { ApiEnv } from '../types/api'

/** Audit records name internal IDs only; secrets are never logged. */
export function audit(c: Context<ApiEnv>, event: string, fields: Record<string, string>) {
  c.get('logger').info({ event, ...fields })
}
