import type { ClientOptions } from 'openapi-fetch'
import createClient from 'openapi-fetch'
import type { paths } from './generated'

type ApiClientOptions = {
  baseUrl: string
  fetch?: ClientOptions['fetch']
  /**
   * Extra headers sent with every request. An enrolled recipient device passes
   * `{ Authorization: 'Bearer <token>' }` here; a caretaker browser relies on
   * the session cookie instead.
   */
  headers?: ClientOptions['headers']
}

export function createApiClient({ baseUrl, fetch, headers }: ApiClientOptions) {
  return createClient<paths>({ baseUrl, credentials: 'include', fetch, headers })
}
