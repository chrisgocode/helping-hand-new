const SECRET_BYTES = 32

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

/** 32 random bytes encoded as unpadded base64url. */
export function generateSecret(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)))
}

/** Only the hash of a secret is ever stored. */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Constant-time comparison for equal-length hex digests and short codes. A
 * matching code is not a credential, so it shares this helper only to avoid
 * leaking length or position through early exit.
 */
export function constantTimeEquals(left: string | null, right: string | null): boolean {
  if (left === null || right === null || left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}
