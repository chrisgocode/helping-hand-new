import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Enrollment logic is plain React, so it runs under jsdom without a React Native
 * preset: Expo is reached only through the dependencies the hook is given.
 */
export default defineConfig({
  resolve: {
    // The .href keeps this off the DOM URL type, which does not match node's.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url).href) },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Metro inlines these from .env; under vitest they have to come from somewhere.
    env: {
      EXPO_PUBLIC_API_ORIGIN: 'http://localhost:8787',
      EXPO_PUBLIC_APP_ENV: 'development',
    },
  },
})
