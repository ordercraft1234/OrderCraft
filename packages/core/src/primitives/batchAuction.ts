import type { PolicyStep } from '../policy/schema.ts'
import type { SlotBundle } from '../slot/schema.ts'
import { type Placement, movedTo } from './placement.ts'
import { mapMatching } from './select.ts'

export type BatchAuctionStep = Extract<PolicyStep, { kind: 'batchAuction' }>

/**
 * Groups a class of transactions into fixed windows measured from the start of the
 * slot, and settles each window at its close (FR-003).
 *
 * **What this models and what it does not.** A real batch auction clears every order
 * in the window at one price, which is what makes sandwiching unprofitable. We have no
 * price model — the slot records what happened, not what would have been quoted — so
 * the primitive delivers the half we can stand behind: everything in a window settles
 * at one time, and inside that group the model has no "before" and "after" to sell to
 * an attacker. The `batch` marker is what a detector reads to say a triple was broken.
 * No claim about execution price is made anywhere in the metrics.
 *
 * Settlement is at the window's close, not its start: an auction that collects for
 * `windowMs` and then clears has really added up to `windowMs` of latency, and the
 * added-delay metric has to see it. A consequence worth saying out loud in a demo —
 * a 400 ms window on a 400 ms slot defers everything it touches, because under this
 * model the auction would clear into the next block.
 */
export function batchAuction(
  bundle: SlotBundle,
  placements: readonly Placement[],
  step: BatchAuctionStep,
): Placement[] {
  return mapMatching(bundle, placements, step.appliesTo, (placement) => {
    const settlesAt = windowCloseAfter(placement.timeMs, step.windowMs)
    return movedTo(placement, settlesAt, 'batchAuction', settlesAt)
  })
}

/**
 * The close of the window `timeMs` falls in — always strictly later than `timeMs`,
 * since a transaction arriving exactly on a boundary opens the next window rather than
 * settling instantly.
 */
function windowCloseAfter(timeMs: number, windowMs: number): number {
  const bucket = (timeMs - (timeMs % windowMs)) / windowMs
  return (bucket + 1) * windowMs
}
