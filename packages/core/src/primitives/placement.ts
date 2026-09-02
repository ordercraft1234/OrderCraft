import type { PrimitiveKind } from '../policy/schema.ts'
import type { SlotBundle } from '../slot/schema.ts'

/**
 * Nominal slot duration. The arrival scale is defined against it — this is a modelling
 * constant, not a measurement, and the product has to say so on the result screen.
 */
export const SLOT_DURATION_MS = 400

/**
 * What the policy did to a transaction, at the level of mechanism.
 *
 * - `kept` — still in this block, possibly at a different time.
 * - `deferred` — pushed past the end of the slot. It was not refused: at this arrival
 *   scale it simply would not have made this block.
 * - `dropped` — refused outright by a rule.
 *
 * `deferred` and `dropped` are kept apart on purpose. Merging them would make the
 * extracted-value metric count a late transaction the same way it counts a denied one.
 * The screen vocabulary (`moved`, `delayed`, `dropped`, `deferred`) is derived from
 * this by comparing against the recorded order — it is not stored here.
 */
export type PlacementStatus = 'kept' | 'deferred' | 'dropped'

export interface Placement {
  /** Position in the recorded block. The tail of every sort key, so ties cannot happen. */
  index: number
  signature: string
  status: PlacementStatus
  /** Modelled arrival plus whatever the policy added. Whole milliseconds. */
  timeMs: number
  /** The last primitive that moved this transaction, for the comparison screen. */
  changedBy: PrimitiveKind | null
  /**
   * Settlement time of the batch this transaction belongs to, or `null` if it settles
   * on its own. Two transactions are in the same batch exactly when this matches: at
   * one settlement time the model has no "before" and "after" to give an attacker.
   */
  batch: number | null
}

/**
 * The synthetic arrival scale: `arrival(i) = floor(i × 400 / N)`.
 *
 * A Solana block records order and a slot-level timestamp, never per-transaction
 * arrival — but speed bumps and batch auctions are rules about time. This spreads the
 * recorded order evenly across the slot so those rules have something to bite on.
 * It is an assumption, and the consequence is that a 5 ms bump on a 1500-transaction
 * slot moves roughly 19 positions rather than "almost nothing".
 */
export function arrivalMs(index: number, count: number): number {
  if (count <= 0) return 0

  // Integer division without `Math.floor`: `Math` is banned in this package, and
  // subtracting the remainder first makes the division exact rather than merely rounded.
  const scaled = index * SLOT_DURATION_MS
  return (scaled - (scaled % count)) / count
}

/** Every transaction where the block put it, before any step has run. */
export function initialPlacements(bundle: SlotBundle): Placement[] {
  const count = bundle.transactions.length

  return bundle.transactions.map((transaction) => ({
    index: transaction.index,
    signature: transaction.signature,
    status: 'kept' as const,
    timeMs: arrivalMs(transaction.index, count),
    changedBy: null,
    batch: null,
  }))
}

/**
 * Puts a transaction at a new time and decides, on the way, whether it still makes
 * the block. Every primitive that moves something goes through here, so the slot
 * boundary is one rule in one place rather than a condition each of them remembers.
 *
 * `batch` is the settlement group the move leaves the transaction in — a time shared
 * with everything settling together, or `null` for a move that settles nothing.
 */
export function movedTo(
  placement: Placement,
  timeMs: number,
  by: PrimitiveKind,
  batch: number | null = null,
): Placement {
  return {
    ...placement,
    timeMs,
    batch,
    status: timeMs >= SLOT_DURATION_MS ? 'deferred' : 'kept',
    changedBy: by,
  }
}
