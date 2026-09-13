import { createApiClient } from '@helping-hand/api-client'

const defaultApiOrigin = 'https://api.helpinghand.chrisgo.dev'
export const apiOrigin = new URL(process.env.EXPO_PUBLIC_API_ORIGIN ?? defaultApiOrigin).origin

export const api = createApiClient({
  baseUrl: apiOrigin,
})

export const recipientApi = (token: string) =>
  createApiClient({
    baseUrl: apiOrigin,
    headers: { Authorization: `Bearer ${token}` },
  })
