import type { PolicyStep } from '../policy/schema.ts'
import type { SlotBundle } from '../slot/schema.ts'
import { type Placement, SLOT_DURATION_MS } from './placement.ts'
import { matchesSelector } from './select.ts'

export type SpeedBumpStep = Extract<PolicyStep, { kind: 'speedBump' }>

/**
 * Holds a class of transactions for a fixed interval (FR-003).
 *
 * The step is a pure transform on placements: it shifts time, it never sorts. Ordering
 * happens once, in `apply`, so that a policy's steps compose without each of them
 * having an opinion about tie-breaking.
 *
 * A transaction pushed to or past the end of the slot becomes `deferred` rather than
 * `dropped`. At this arrival scale it would not have made the block — but the policy
 * did not refuse it, and the two have to stay distinguishable downstream.
 */
export function speedBump(
  bundle: SlotBundle,
  placements: readonly Placement[],
  step: SpeedBumpStep,
): Placement[] {
  // A zero bump is a legal parameter and a no-op. Returning early keeps it out of
  // `changedBy`, so the comparison screen does not credit it with moving anything.
  if (step.delayMs === 0) return [...placements]

  return placements.map((placement) => {
    const transaction = bundle.transactions[placement.index]
    if (transaction === undefined) {
      throw new Error(`placement ${placement.index} has no transaction in slot ${bundle.slot}`)
    }

    // Already out of the block: a refused transaction cannot be delayed, and a deferred
    // one has nowhere further to go inside this slot.
    if (placement.status !== 'kept') return placement
    if (!matchesSelector(step.appliesTo, transaction)) return placement

    const timeMs = placement.timeMs + step.delayMs

    return {
      ...placement,
      timeMs,
      status: timeMs >= SLOT_DURATION_MS ? 'deferred' : 'kept',
      changedBy: 'speedBump',
    }
  })
}
