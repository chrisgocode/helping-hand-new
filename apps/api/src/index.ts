import app from './app'
import { cleanupEnrollments } from './services/enrollment.service'
import type { ApiEnv } from './types/api'

export default {
  fetch: app.fetch,

  /**
   * Enrollment data is short-lived, so a scheduled sweep settles what expired
   * and removes what is no longer needed. The work is bounded per run.
   */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupEnrollments(env.database))
  },
} satisfies ExportedHandler<ApiEnv['Bindings']>
