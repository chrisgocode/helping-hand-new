import { type EnrollmentPayload, enrollmentPayloadSchema } from '@helping-hand/schemas'

export function parseEnrollmentPayload(value: string): EnrollmentPayload | null {
  try {
    const result = enrollmentPayloadSchema.safeParse(JSON.parse(value))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function encodeBase64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let result = ''

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    const value = (first << 16) | ((second ?? 0) << 8) | (third ?? 0)
    result += alphabet[(value >> 18) & 63]
    result += alphabet[(value >> 12) & 63]
    if (second !== undefined) result += alphabet[(value >> 6) & 63]
    if (third !== undefined) result += alphabet[value & 63]
  }

  return result
}
