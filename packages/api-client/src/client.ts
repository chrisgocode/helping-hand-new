import type { ClientOptions } from 'openapi-fetch'
import createClient from 'openapi-fetch'
import type { paths } from './generated'

type ApiClientOptions = {
  baseUrl: string
  fetch?: ClientOptions['fetch']
}

export function createApiClient({ baseUrl, fetch }: ApiClientOptions) {
  return createClient<paths>({ baseUrl, credentials: 'include', fetch })
}
