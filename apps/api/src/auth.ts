import { betterAuth } from 'better-auth'

export type AuthBindings = {
  database: D1Database
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  TRUSTED_ORIGIN: string
}

export function createAuth(env: AuthBindings) {
  if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL || !env.TRUSTED_ORIGIN) {
    throw new Error('BETTER_AUTH_SECRET, BETTER_AUTH_URL, and TRUSTED_ORIGIN are required')
  }

  return betterAuth({
    database: env.database,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.TRUSTED_ORIGIN],
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    emailAndPassword: { enabled: true },
  })
}
