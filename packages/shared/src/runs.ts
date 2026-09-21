import {
  type BrokenReason,
  type ExtractedValue,
  type Ordering,
  PRIMITIVES,
  type Placement,
  type PrimitiveKind,
  type SlotBundle,
  base58,
} from '@ordercraft/core'
import { z } from 'zod'
import { bigintString, policyHashHex, slotNumber, timestamp, uuid } from './scalars.ts'

/** The kinds a placement can name as what moved it, read off the primitive table. */
const primitiveKind = z.enum(
  PRIMITIVES.map((primitive) => primitive.kind) as [PrimitiveKind, ...PrimitiveKind[]],
)

const index = z.number().int().nonnegative()

/**
 * A `Placement` without its signature.
 *
 * The signature is the tail of the sort key inside the kernel, but on the wire it is
 * eighty-eight bytes per transaction that the slot already carries. A run is addressed
 * by `(policyHash, slot)`, so whoever holds the run holds the slot too, and
 * `hydrateOrdering` puts the signatures back by index. What stays is exactly what the
 * screens read: where each transaction went, when, and which primitive sent it there.
 */
export const placementSchema = z.object({
  index,
  status: z.enum(['kept', 'deferred', 'dropped']),
  timeMs: z.number().int().nonnegative(),
  changedBy: primitiveKind.nullable(),
  batch: z.number().int().nonnegative().nullable(),
  prioritised: z.boolean(),
})

export type PlacementWire = z.infer<typeof placementSchema>

export const orderingSchema = z.object({
  slot: slotNumber,
  policyHash: policyHashHex,
  /** In policy order — the block as the policy would have built it. */
  included: z.array(placementSchema),
  /** Deferred and dropped, in recorded order. */
  excluded: z.array(placementSchema),
})

export type OrderingWire = z.infer<typeof orderingSchema>

const tokenAmountSchema = z.object({
  mint: base58,
  amount: bigintString,
})

/** `ExtractedValue` with its bigints as strings on the way in and bigints on the way out. */
export const extractedValueSchema = z.object({
  tokens: z.array(tokenAmountSchema),
  lamports: bigintString,
  fees: bigintString,
})

export type SerializedExtractedValue = z.input<typeof extractedValueSchema>

/**
 * A sandwich the detector marked on the recorded block, with what its author walked
 * away with (FR-012, FR-025). The value is computed on the baseline once and stored
 * with the run, because it is arithmetic on recorded balances and does not depend on
 * what the policy did.
 */
export const attackSchema = z.object({
  front: index,
  victims: z.array(index).min(1),
  back: index,
  signer: base58,
  mint: base58,
  pool: base58,
  extracted: extractedValueSchema,
})

export type Attack = z.infer<typeof attackSchema>
export type SerializedAttack = z.input<typeof attackSchema>

const brokenReason = z.enum([
  'legLeftBlock',
  'victimsLeftBlock',
  'sameBatch',
  'orderChanged',
] satisfies [BrokenReason, ...BrokenReason[]])

/** `TripleOutcome` as the kernel reports it (FR-013). */
export const tripleOutcomeSchema = z.object({
  broken: z.boolean(),
  reason: brokenReason.nullable(),
  by: primitiveKind.nullable(),
})

const percentilesSchema = z.object({
  p10: z.number().int().nonnegative(),
  p50: z.number().int().nonnegative(),
  p90: z.number().int().nonnegative(),
  p95: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
})

const count = z.number().int().nonnegative()

/** `RunMetrics` as the kernel reports it (FR-010): whole numbers only, no bigints. */
export const runMetricsSchema = z.object({
  recorded: count,
  included: count,
  deferred: count,
  dropped: count,
  moved: count,
  delayed: count,
  reorderedPerMille: z.number().int().min(0).max(1000),
  addedDelayMs: percentilesSchema,
})

/**
 * One stored run (FR-029): what the detector found on the recorded block, what the
 * policy did to the block, and what became of each marked triple.
 *
 * `result.outcomes[i]` is the fate of `baseline.attacks[i]`; the two are the same length
 * by construction and the schema says so, because a run whose outcomes drifted from its
 * attacks would render as an attack screen with the wrong verdict under it.
 */
export const runSchema = z
  .object({
    id: uuid,
    policyHash: policyHashHex,
    slot: slotNumber,
    baseline: z.object({
      attacks: z.array(attackSchema),
    }),
    result: z.object({
      ordering: orderingSchema,
      outcomes: z.array(tripleOutcomeSchema),
    }),
    metrics: runMetricsSchema,
    createdAt: timestamp,
  })
  .superRefine((run, ctx) => {
    if (run.result.outcomes.length !== run.baseline.attacks.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['result', 'outcomes'],
        message: `expected one outcome per attack: ${run.baseline.attacks.length} attacks, ${run.result.outcomes.length} outcomes`,
      })
    }
    if (run.result.ordering.slot !== run.slot) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['result', 'ordering', 'slot'],
        message: `ordering is for slot ${run.result.ordering.slot}, run is for slot ${run.slot}`,
      })
    }
    if (run.result.ordering.policyHash !== run.policyHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['result', 'ordering', 'policyHash'],
        message: 'ordering was produced by a different policy than the run names',
      })
    }
  })

export type Run = z.infer<typeof runSchema>
export type SerializedRun = z.input<typeof runSchema>

/** `POST /runs` — idempotent on `(hash, slot)`; the second call returns the first run. */
export const createRunRequestSchema = z.object({
  hash: policyHashHex,
  slot: slotNumber,
})

export type CreateRunRequest = z.infer<typeof createRunRequestSchema>

export const runIdParamSchema = z.object({ id: uuid })

/** Drops the signatures. The rest of a placement is already JSON. */
export function serializeOrdering(ordering: Ordering): OrderingWire {
  return {
    slot: ordering.slot,
    policyHash: ordering.policyHash,
    included: ordering.included.map(stripSignature),
    excluded: ordering.excluded.map(stripSignature),
  }
}

/**
 * Puts the signatures back from the slot the run was made on. A wire ordering that
 * names another slot, or an index the slot does not have, is a programming error
 * upstream — the two are stored under the same key — and is thrown rather than patched.
 */
export function hydrateOrdering(wire: OrderingWire, bundle: SlotBundle): Ordering {
  if (wire.slot !== bundle.slot) {
    throw new Error(`ordering is for slot ${wire.slot}, bundle is slot ${bundle.slot}`)
  }

  const withSignature = (placement: PlacementWire): Placement => {
    const transaction = bundle.transactions[placement.index]
    if (transaction === undefined) {
      throw new Error(`placement ${placement.index} has no transaction in slot ${bundle.slot}`)
    }

    return { ...placement, signature: transaction.signature }
  }

  return {
    slot: wire.slot,
    policyHash: wire.policyHash,
    included: wire.included.map(withSignature),
    excluded: wire.excluded.map(withSignature),
  }
}

export function serializeExtractedValue(value: ExtractedValue): SerializedExtractedValue {
  return {
    tokens: value.tokens.map((token) => ({ mint: token.mint, amount: token.amount.toString() })),
    lamports: value.lamports.toString(),
    fees: value.fees.toString(),
  }
}

/** The run as it is written to JSON and to the database: every bigint a string. */
export function serializeRun(run: Run): SerializedRun {
  return {
    ...run,
    baseline: {
      attacks: run.baseline.attacks.map((attack) => ({
        ...attack,
        extracted: serializeExtractedValue(attack.extracted),
      })),
    },
  }
}

function stripSignature({ signature: _signature, ...placement }: Placement): PlacementWire {
  return placement
}
