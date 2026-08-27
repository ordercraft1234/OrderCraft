import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue }

/**
 * The text a policy hash is taken over. Deterministic by construction: object keys
 * sorted by code point, no whitespace, and every value type JSON cannot carry back
 * unchanged rejected rather than coerced.
 */
export function canonicalize(value: unknown, path = '$'): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new Error(
          `${path} is ${value}: policy values must be safe integers — a fractional or oversized parameter would hash differently on another platform`,
        )
      }
      return String(value)
    case 'bigint':
      throw new Error(`${path} is a bigint; write it as an integer or a string instead`)
    case 'undefined':
      throw new Error(`${path} is undefined; omit the key instead of leaving it empty`)
    case 'object':
      break
    default:
      throw new Error(`${path} is a ${typeof value}, which has no canonical form`)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, position) => canonicalize(item, `${path}[${position}]`)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item, `${path}.${key}`)}`)
    .join(',')}}`
}

/** Content address of a policy: 64 lower-case hex characters. */
export function policyHash(policy: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalize(policy))))
}
