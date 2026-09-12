import { createApiClient } from '@helping-hand/api-client'

const defaultApiOrigin = 'https://api.helpinghand.chrisgo.dev'

export const api = createApiClient({
  baseUrl: new URL(process.env.EXPO_PUBLIC_API_ORIGIN ?? defaultApiOrigin).origin,
})
