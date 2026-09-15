import { describe, expect, test } from 'vitest'
import { encodeBase64Url, parseEnrollmentPayload } from './enrollment-payload'

const enrollmentId = '44444444-4444-4444-8444-444444444444'
const secret = 'a'.repeat(43)

describe('recipient enrollment payload', () => {
  test('accepts only the versioned QR shape', () => {
    expect(parseEnrollmentPayload(JSON.stringify({ version: 1, enrollmentId, secret }))).toEqual({
      version: 1,
      enrollmentId,
      secret,
    })
    expect(parseEnrollmentPayload('{"version":2}')).toBeNull()
    expect(parseEnrollmentPayload('not-json')).toBeNull()
  })

  test('encodes 32 random bytes as an unpadded base64url secret', () => {
    const encoded = encodeBase64Url(Uint8Array.from({ length: 32 }, (_, index) => index))
    expect(encoded).toHaveLength(43)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})
