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
