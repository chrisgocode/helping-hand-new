import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('config', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllEnvs())

  it('reads and normalizes the configured API origin', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_ORIGIN', 'https://api.helpinghand.chrisgo.dev/')
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'production')

    const { config } = await import('./config')

    expect(config).toEqual({
      environment: 'production',
      api: { origin: 'https://api.helpinghand.chrisgo.dev' },
      captureHarness: false,
    })
  })

  it('reaches the capture harness only when the build opts in', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_ORIGIN', 'https://api.example.com')
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'preview')
    vi.stubEnv('EXPO_PUBLIC_ENABLE_CAPTURE', 'true')

    expect((await import('./config')).config.captureHarness).toBe(true)
  })

  it.each(['false', '1', 'yes', undefined])(
    'keeps the capture harness out of a build that did not ask for it: %s',
    async (value) => {
      vi.stubEnv('EXPO_PUBLIC_API_ORIGIN', 'https://api.example.com')
      vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'production')
      vi.stubEnv('EXPO_PUBLIC_ENABLE_CAPTURE', value)

      expect((await import('./config')).config.captureHarness).toBe(false)
    },
  )

  it.each(['', 'not-a-url', 'ftp://api.example.com', 'https://api.example.com/v1'])(
    'rejects an invalid API origin: %s',
    async (value) => {
      vi.stubEnv('EXPO_PUBLIC_API_ORIGIN', value)
      vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'development')

      await expect(import('./config')).rejects.toThrow('EXPO_PUBLIC_API_ORIGIN')
    },
  )

  it.each(['', 'test', 'staging'])('rejects an unsupported environment: %s', async (value) => {
    vi.stubEnv('EXPO_PUBLIC_API_ORIGIN', 'https://api.example.com')
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', value)

    await expect(import('./config')).rejects.toThrow('Unsupported application environment')
  })

  it.each(['development', 'preview', 'production'])('accepts the %s environment', async (value) => {
    vi.stubEnv('EXPO_PUBLIC_API_ORIGIN', 'https://api.example.com')
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', value)

    expect((await import('./config')).config.environment).toBe(value)
  })
})
