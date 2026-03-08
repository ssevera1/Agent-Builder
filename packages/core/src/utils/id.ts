/**
 * ID generation utility.
 * Produces URL-safe, compact, unique identifiers without external dependencies.
 * Uses Node.js crypto.randomBytes for cryptographic randomness.
 */

import { randomBytes } from 'node:crypto';

/**
 * URL-safe alphabet (A-Z, a-z, 0-9, - and _) — 64 characters.
 */
const URL_SAFE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Generate a random ID string of the specified length using a URL-safe alphabet.
 *
 * The generated IDs have ~6 bits of entropy per character (log2(64) = 6).
 * Default length of 21 provides ~126 bits of entropy, comparable to UUIDv4.
 *
 * @param size - Number of characters in the ID. Default: 21.
 * @returns A random URL-safe string.
 *
 * @example
 * ```ts
 * generateId();     // e.g., "V1StGXR8_Z5jdHi6B-myT"
 * generateId(12);   // e.g., "R4nd0mStr1ng"
 * ```
 */
export function generateId(size: number = 21): string {
  const bytes = randomBytes(size);
  const chars = new Array<string>(size);

  for (let i = 0; i < size; i++) {
    // Mask to 6 bits (0-63) to index into our 64-char alphabet.
    // This introduces a negligible bias since 256 mod 64 = 0.
    chars[i] = URL_SAFE_ALPHABET[bytes[i]! & 63]!;
  }

  return chars.join('');
}

/**
 * Generate a prefixed ID for typed entities.
 *
 * @param prefix - Entity type prefix (e.g., 'agt', 'ses', 'wf', 'mem', 'ep', 'tc').
 * @param size - Length of the random portion. Default: 21.
 * @returns A prefixed ID like "agt_V1StGXR8_Z5jdHi6B-myT".
 *
 * @example
 * ```ts
 * generatePrefixedId('agt');  // "agt_V1StGXR8_Z5jdHi6B-myT"
 * generatePrefixedId('ses');  // "ses_Kx9Bz3mN_wQ7pL1rY-abC"
 * ```
 */
export function generatePrefixedId(prefix: string, size: number = 21): string {
  return `${prefix}_${generateId(size)}`;
}

/**
 * Validate that a string looks like a valid generated ID.
 * Checks that it uses only URL-safe characters and meets minimum length.
 *
 * @param id - The string to validate.
 * @param minLength - Minimum acceptable length. Default: 8.
 * @returns True if the string is a plausible ID.
 */
export function isValidId(id: string, minLength: number = 8): boolean {
  if (id.length < minLength) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

/**
 * Generate a timestamp-prefixed ID for sortable ordering.
 * Format: base36-encoded millisecond timestamp + random suffix.
 *
 * @param size - Length of the random suffix. Default: 12.
 * @returns A sortable ID like "m2x9k4p7_R4nd0mStr1ng".
 */
export function generateSortableId(size: number = 12): string {
  const timestamp = Date.now().toString(36);
  const random = generateId(size);
  return `${timestamp}_${random}`;
}
