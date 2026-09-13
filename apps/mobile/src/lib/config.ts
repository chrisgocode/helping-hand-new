function readApiOrigin(value: string | undefined) {
  if (!value) throw new Error('EXPO_PUBLIC_API_ORIGIN is required')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('EXPO_PUBLIC_API_ORIGIN must be an absolute HTTP(S) origin')
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('EXPO_PUBLIC_API_ORIGIN must be an absolute HTTP(S) origin')
  }

  return url.origin
}

function readEnvironment(value: string | undefined) {
  if (value === 'development' || value === 'preview' || value === 'production') return value
  throw new Error(`Unsupported application environment: ${value}`)
}

/**
 * The environment is its own variable because `NODE_ENV` cannot name one: a
 * bundle is built with `expo export`, which forces `production`, so a preview
 * build and a store build would be indistinguishable. The names match the EAS
 * environments and the API's `APP_ENV`.
 *
 * Both reads must stay dot-notation literals on `process.env`. Metro substitutes
 * the value at bundle time, and a destructured or computed key is never
 * replaced, so it would silently be `undefined` on a device.
 */
export const config = Object.freeze({
  environment: readEnvironment(process.env.EXPO_PUBLIC_APP_ENV),
  api: Object.freeze({
    origin: readApiOrigin(process.env.EXPO_PUBLIC_API_ORIGIN),
  }),
})
