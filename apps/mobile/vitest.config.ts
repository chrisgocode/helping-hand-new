import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Enrollment logic is plain React, so it runs under jsdom without a React Native
 * preset: Expo is reached only through the dependencies the hook is given.
 */
export default defineConfig({
  resolve: {
    // .href because the DOM URL type does not satisfy node's.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url).href) },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Metro inlines these from .env; vitest has no such step.
    env: {
      EXPO_PUBLIC_API_ORIGIN: 'http://localhost:8787',
      EXPO_PUBLIC_APP_ENV: 'development',
    },
  },
})
