import { z } from 'zod'
import { base58, unsignedIntegerString } from '../common/scalars.ts'

export const POLICY_SCHEMA_VERSION = 1

/**
 * A non-empty list of addresses, with the messages a screen can print as they are.
 * Zod's defaults ("Array must contain at least 1 element(s)") read as a stack trace
 * next to the rest of this product's language.
 */
const addresses = z
  .array(base58)
  .min(1, 'list at least one address')
  .max(20, 'at most 20 addresses in one class')

/**
 * What a step can select. Every branch is answerable from a single slot — the block
 * is all the evidence the simulator has, so a class like "pools younger than a day"
 * cannot exist here: it lives in history the slot does not carry. A user who means
 * that supplies the pool addresses and gets `account`.
 */
export const selectorSchema = z.discriminatedUnion('match', [
  z.object({ match: z.literal('all') }),
  z.object({ match: z.literal('program'), programs: addresses }),
  z.object({ match: z.literal('signer'), signers: addresses }),
  z.object({ match: z.literal('account'), accounts: addresses }),
  z.object({
    match: z.literal('tokenDeltaAbove'),
    mint: base58,
    amount: unsignedIntegerString,
  }),
])

export type Selector = z.infer<typeof selectorSchema>

const SPEED_BUMP_MIN_MS = 0
const SPEED_BUMP_MAX_MS = 400
const BATCH_MIN_MS = 50
const BATCH_MAX_MS = 400
const MAX_RULES = 20
const MAX_STEPS = 12

export const PRIMITIVES = [
  {
    kind: 'speedBump',
    label: 'Speed bump',
    description: 'Holds transactions of a chosen class for a fixed interval',
    parameter: { field: 'delayMs', unit: 'ms', min: SPEED_BUMP_MIN_MS, max: SPEED_BUMP_MAX_MS },
  },
  {
    kind: 'batchAuction',
    label: 'Batch auction',
    description: 'Groups transactions in a window and settles them at one price',
    parameter: { field: 'windowMs', unit: 'ms', min: BATCH_MIN_MS, max: BATCH_MAX_MS },
  },
  {
    kind: 'allowDeny',
    label: 'Allow / deny',
    description: 'Prioritises or refuses transactions by program or signer',
    parameter: { field: 'rules', unit: 'entries', min: 1, max: MAX_RULES },
  },
] as const

export type PrimitiveKind = (typeof PRIMITIVES)[number]['kind']

/** A parameter in whole milliseconds; the range is printed beside the field anyway. */
function milliseconds(min: number, max: number) {
  return z
    .number()
    .int('whole milliseconds only')
    .min(min, `no less than ${min} ms`)
    .max(max, `no more than ${max} ms`)
}

const stepSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('speedBump'),
    delayMs: milliseconds(SPEED_BUMP_MIN_MS, SPEED_BUMP_MAX_MS),
    appliesTo: selectorSchema,
  }),
  z.object({
    kind: z.literal('batchAuction'),
    windowMs: milliseconds(BATCH_MIN_MS, BATCH_MAX_MS),
    appliesTo: selectorSchema,
  }),
  z.object({
    kind: z.literal('allowDeny'),
    rules: z
      .array(
        z.object({
          effect: z.enum(['prioritise', 'deny']),
          match: selectorSchema,
        }),
      )
      .min(1)
      .max(MAX_RULES),
  }),
])

export type PolicyStep = z.infer<typeof stepSchema>

export const policySchema = z.object({
  schemaVersion: z.literal(POLICY_SCHEMA_VERSION),
  name: z.string().min(1).max(80),
  steps: z
    .array(stepSchema)
    .min(1, 'a policy needs at least one step')
    .max(MAX_STEPS, `at most ${MAX_STEPS} steps`),
})

export type Policy = z.infer<typeof policySchema>
