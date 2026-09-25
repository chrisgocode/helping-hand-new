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
 * The environment needs its own variable because `expo export` forces
 * `NODE_ENV` to `production`, which would make a preview build and a store
 * build indistinguishable. The names match the EAS environments and `APP_ENV`.
 *
 * Both reads must stay dot-notation literals: Metro substitutes the value at
 * bundle time, and a destructured or computed key is left as `undefined`.
 */
export const config = Object.freeze({
  environment: readEnvironment(process.env.EXPO_PUBLIC_APP_ENV),
  api: Object.freeze({
    origin: readApiOrigin(process.env.EXPO_PUBLIC_API_ORIGIN),
  }),
  /**
   * Whether the capture harness is reachable. It cannot key off `__DEV__`: a
   * build handed to a tester is a release build, which is exactly when the
   * harness has to be visible and never is under that flag.
   */
  captureHarness: process.env.EXPO_PUBLIC_ENABLE_CAPTURE === 'true',
})
