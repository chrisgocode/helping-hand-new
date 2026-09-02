import { createAuthClient } from 'better-auth/react'
import { apiBaseUrl } from '../lib/api'

export const authClient = createAuthClient({
  baseURL: apiBaseUrl,
  fetchOptions: { credentials: 'include' },
})
