import { PRESETS } from '@ordercraft/core'
import { z } from 'zod'

/**
 * Upper bound on a slot number the API will look at.
 *
 * The chain stood near 445 million in September 2026 and advances about 2.5 slots a
 * second, so a trillion is some twelve thousand years away. The bound is not about
 * plausibility; it keeps a request from carrying `1e300` into a file name or a SQL
 * parameter, where "an integer" alone is not a promise about size.
 */
export const MAX_SLOT = 1_000_000_000_000

export const slotNumber = z
  .number()
  .int('a slot is a whole number')
  .nonnegative('a slot cannot be negative')
  .max(MAX_SLOT, 'slot is outside the range this service will look at')

/**
 * A slot arriving as a path segment. Digits only — `Number('1e9')` and `Number(' 7 ')`
 * both parse, and a path that accepted them would file the slot under a name nobody
 * typed.
 */
export const slotSegment = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, 'expected a slot number')
  .transform(Number)
  .pipe(slotNumber)

/** The content address `policyHash` produces: 64 lower-case hex characters. */
export const policyHashHex = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'expected a policy hash: 64 lower-case hex characters')

export const uuid = z.string().uuid()

/** RFC 3339 in UTC, the way `Date#toISOString` writes it. Offsets are not accepted. */
export const timestamp = z.string().datetime({ message: 'expected an ISO-8601 timestamp in UTC' })

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

const SHIPPED_PRESETS = new Set(PRESETS.map((preset) => preset.id))

/**
 * An origin a new version may be recorded under: one of the presets in
 * `packages/core/src/presets/`. Presets are never removed — their hashes are pinned — so
 * an id accepted here stays meaningful for as long as the version exists.
 */
export const knownPresetId = presetId.refine((id) => SHIPPED_PRESETS.has(id), {
  message: `expected one of the shipped presets: ${[...SHIPPED_PRESETS].join(', ')}`,
})

/** A signed integer written as a decimal string, so a bigint survives JSON. */
export const integerString = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)$/, 'expected a decimal integer written as a string')

/** `integerString`, read back into a bigint on the way in. */
export const bigintString = integerString.transform((value) => BigInt(value))
