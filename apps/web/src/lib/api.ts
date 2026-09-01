import { createApiClient } from '@helping-hand/api-client'

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:8787',
})
