import { createApiClient } from '@helping-hand/api-client'
import { config } from './config'

export const apiOrigin = config.api.origin

export const api = createApiClient({
  baseUrl: apiOrigin,
})

export const recipientApi = (token: string) =>
  createApiClient({
    baseUrl: apiOrigin,
    headers: { Authorization: `Bearer ${token}` },
  })
