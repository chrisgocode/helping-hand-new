const MATCHING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MATCHING_CODE_LENGTH = 6

/**
 * A short visual confirmation value shown on both devices. It confirms that two
 * devices are looking at the same enrollment; it never authenticates, so it only
 * has to be hard to confuse.
 */
export function generateMatchingCode(): string {
  const values = crypto.getRandomValues(new Uint8Array(MATCHING_CODE_LENGTH))
  return Array.from(
    values,
    (value) => MATCHING_CODE_ALPHABET[value % MATCHING_CODE_ALPHABET.length],
  ).join('')
}
