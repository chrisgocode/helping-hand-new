import { describe, expect, test } from 'bun:test'
import { type AuthBindings, createAuth } from './auth'

describe('createAuth', () => {
  test('rejects missing configuration', () => {
    expect(() => createAuth({} as AuthBindings)).toThrow('BETTER_AUTH_SECRET')
  })
})
