function readApiOrigin(value: string | undefined) {
  if (!value) throw new Error('VITE_API_ORIGIN is required')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('VITE_API_ORIGIN must be an absolute HTTP(S) origin')
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('VITE_API_ORIGIN must be an absolute HTTP(S) origin')
  }

  return url.origin
}

function readEnvironment(value: string) {
  if (value === 'development' || value === 'test' || value === 'production') return value
  throw new Error(`Unsupported application environment: ${value}`)
}

export const config = Object.freeze({
  environment: readEnvironment(import.meta.env.MODE),
  api: Object.freeze({
    origin: readApiOrigin(import.meta.env.VITE_API_ORIGIN),
  }),
})
