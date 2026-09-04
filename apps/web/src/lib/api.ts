import { createApiClient } from '@helping-hand/api-client'
import { config } from '../config'

export const api = createApiClient({
  baseUrl: config.api.origin,
})
