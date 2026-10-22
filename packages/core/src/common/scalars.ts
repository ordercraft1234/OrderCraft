import { z } from 'zod'

/**
 * A base58 account or signature as the RPC writes it. Length, not alphabet, is what
 * separates a mistyped key from a truncated one in practice; the alphabet check
 * catches the `0`, `O`, `I` and `l` that base58 deliberately omits.
 */
export const base58 = z
  .string()
  .min(32)
  .max(88)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'expected base58 (no 0, O, I or l)')

/** An unsigned integer written as a decimal string, so u64 survives JSON. */
export const unsignedIntegerString = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, 'expected a non-negative decimal integer written as a string')

/** The content address `policyHash` produces: 64 lower-case hex characters. */
export const policyHashHex = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'expected a policy hash: 64 lower-case hex characters')

/**
 * The shape of a preset's identifier (FR-015). This is what a stored version is read
 * back with: the API answers with whatever origin it holds, and a screen shows an id
 * the library does not recognise rather than refusing to open the link.
 */
export const presetId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'expected a preset id: lower-case words joined by dashes')
