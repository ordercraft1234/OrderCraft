import type { Ordering } from '../order/apply.ts'
import type { PrimitiveKind } from '../policy/schema.ts'
import type { Placement } from '../primitives/placement.ts'
import type { Sandwich } from './sandwich.ts'

/**
 * Why a triple no longer works, in the order the checks run. `orderChanged` is last
 * because a leg that left the block or a batch that swallowed the three explains the
 * break better than the positions do.
 */
export type BrokenReason = 'legLeftBlock' | 'victimsLeftBlock' | 'sameBatch' | 'orderChanged'

export interface TripleOutcome {
  broken: boolean
  reason: BrokenReason | null
  /** The primitive that did it, when the placement records one. */
  by: PrimitiveKind | null
}

/**
 * Whether a marked triple is still possible under the policy, and which primitive broke
 * it (FR-013).
 *
 * The three ways it breaks are different claims, and the screen says which one:
 *
 * - a leg is no longer in the block, refused or pushed past the slot boundary;
 * - everyone it was built around is gone, leaving the pair surrounding nothing;
 * - all three settle in one batch, so the model has no before and after to sell;
 * - nobody is left between the legs in the new order.
 *
 * When none of those holds, the answer is that the attack remains possible — printed in
 * those words, not softened, and never as a green tick.
 */
export function tripleOutcome(sandwich: Sandwich, ordering: Ordering): TripleOutcome {
  const included = new Map(
    ordering.included.map((placement, position) => [placement.index, position]),
  )
  const excluded = new Map(ordering.excluded.map((placement) => [placement.index, placement]))

  const legLeft = [sandwich.front, sandwich.back].map((index) => excluded.get(index))
  const gone = legLeft.find((placement) => placement !== undefined)
  if (gone !== undefined) return broken('legLeftBlock', gone.changedBy)

  const victimsGone = sandwich.victims.map((index) => excluded.get(index))
  if (victimsGone.every((placement) => placement !== undefined)) {
    return broken('victimsLeftBlock', victimsGone[0]?.changedBy ?? null)
  }

  const front = at(ordering, included, sandwich.front)
  const back = at(ordering, included, sandwich.back)
  const victims = sandwich.victims
    .filter((index) => !excluded.has(index))
    .map((index) => at(ordering, included, index))

  // A batch is decided on settlement time, not on position: inside one group the
  // ordering is arbitrary by construction, which is the whole point of the primitive.
  if (front.batch !== null && front.batch === back.batch) {
    const together = victims.filter((victim) => victim.batch === front.batch)
    if (together.length === victims.length) return broken('sameBatch', 'batchAuction')
  }

  // Strictly front, then victim, then back. Not "between the two legs in either
  // direction": a policy that puts the back-run first has not left the attack intact,
  // it has left the attacker buying after it sold.
  const first = included.get(sandwich.front) ?? -1
  const last = included.get(sandwich.back) ?? -1
  const between = victims.filter((victim) => {
    const position = included.get(victim.index) ?? -1
    return position > first && position < last
  })

  if (between.length === 0) return broken('orderChanged', mover([front, back, ...victims]))

  return { broken: false, reason: null, by: null }
}

function broken(reason: BrokenReason, by: PrimitiveKind | null): TripleOutcome {
  return { broken: true, reason, by }
}

/**
 * Which primitive to name when the order changed. The first of the three the policy
 * touched, in the order front, back, victims — a triple usually breaks because one leg
 * was held, and naming the leg that was held reads better than naming whoever happened
 * to move furthest.
 */
function mover(placements: Placement[]): PrimitiveKind | null {
  return placements.find((placement) => placement.changedBy !== null)?.changedBy ?? null
}

/** A placement that is neither included nor excluded means the ordering is not this slot's. */
function at(ordering: Ordering, included: Map<number, number>, index: number): Placement {
  const position = included.get(index)
  const placement = position === undefined ? undefined : ordering.included[position]
  if (placement === undefined) {
    throw new Error(
      `position ${index} is in neither half of the ordering for slot ${ordering.slot}`,
    )
  }

  return placement
}
