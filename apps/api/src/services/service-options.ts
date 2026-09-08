import type { Context } from 'hono'
import type { ApiEnv } from '../types/api'
import { createRecipientAuth } from './recipient-auth'

/** Every recipient-aware service is built from the same request-scoped dependencies. */
export function serviceOptions(c: Context<ApiEnv>) {
  return { database: c.env.database, recipientAuth: createRecipientAuth(c.env) }
}
