import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('config', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllEnvs())

  it('reads and normalizes the configured API origin', async () => {
    vi.stubEnv('VITE_API_ORIGIN', 'https://api.helpinghand.chrisgo.dev/')
    vi.stubEnv('MODE', 'production')

    const { config } = await import('./config')

    expect(config).toEqual({
      environment: 'production',
      api: { origin: 'https://api.helpinghand.chrisgo.dev' },
    })
  })

  it.each(['', 'not-a-url', 'ftp://api.example.com', 'https://api.example.com/v1'])(
    'rejects an invalid API origin: %s',
    async (value) => {
      vi.stubEnv('VITE_API_ORIGIN', value)
      vi.stubEnv('MODE', 'test')

      await expect(import('./config')).rejects.toThrow('VITE_API_ORIGIN')
    },
  )

  it('rejects an unsupported environment', async () => {
    vi.stubEnv('VITE_API_ORIGIN', 'https://api.example.com')
    vi.stubEnv('MODE', 'preview')

    await expect(import('./config')).rejects.toThrow('Unsupported application environment')
  })
})
