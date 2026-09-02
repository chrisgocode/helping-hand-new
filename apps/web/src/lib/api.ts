import { createApiClient } from '@helping-hand/api-client'

export const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'

export const api = createApiClient({
  baseUrl: apiBaseUrl,
})
