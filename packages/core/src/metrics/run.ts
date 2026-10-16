import type { Ordering } from '../order/apply.ts'
import { arrivalMs } from '../primitives/placement.ts'
import type { SlotBundle } from '../slot/schema.ts'
import { type Percentiles, integerDivide, percentilesOf } from './percentile.ts'

export type { Percentiles } from './percentile.ts'

export interface RunMetrics {
  /** Transactions the block actually held. */
  recorded: number
  included: number
  /** Pushed past the end of the slot by the clock. */
  deferred: number
  /** Refused by a rule. */
  dropped: number
  /** Included transactions whose position among the included ones changed. */
  moved: number
  /** Included transactions the policy delayed at all. */
  delayed: number
  /**
   * Share of included transactions that moved, in parts per thousand — an integer, so
   * the screen can print one decimal place without core ever holding a float.
   */
  reorderedPerMille: number
  /**
   * Added delay over **included** transactions only. A deferred transaction has no
   * delay inside this block, and inventing one would be a number about a block we did
   * not simulate. The consequence is that these percentiles flatter a policy that
   * defers its worst cases, so `deferred` is reported beside them and the screen has
   * to show both.
   */
  addedDelayMs: Percentiles
}

/**
 * Descriptive metrics for one run (FR-010).
 *
 * Everything here is a statement about what the policy did to this block. Nothing here
 * estimates what a transaction would have executed at in another order — that number
 * needs a price model the slot does not carry, and the product does not claim it.
 */
export function runMetrics(bundle: SlotBundle, ordering: Ordering): RunMetrics {
  const recorded = bundle.transactions.length
  const included = ordering.included

  const delays = addedDelays(bundle, ordering)

  // "Moved" is measured against the included set, not the recorded block. Otherwise
  // dropping one transaction shifts every later one by a place and the metric reports
  // a reordering that never happened.
  const byRecordedOrder = [...included]
    .sort((left, right) => left.index - right.index)
    .map((placement) => placement.index)
  const moved = included.filter(
    (placement, position) => byRecordedOrder[position] !== placement.index,
  ).length

  return {
    recorded,
    included: included.length,
    deferred: ordering.excluded.filter((placement) => placement.status === 'deferred').length,
    dropped: ordering.excluded.filter((placement) => placement.status === 'dropped').length,
    moved,
    delayed: delays.filter((delay) => delay > 0).length,
    reorderedPerMille: included.length === 0 ? 0 : integerDivide(moved * 1000, included.length),
    addedDelayMs: percentilesOf(delays),
  }
}

/**
 * The delay the policy added to each **included** transaction, ascending. A batch pools
 * these across blocks, so this is the one place the subtraction is written.
 */
export function addedDelays(bundle: SlotBundle, ordering: Ordering): number[] {
  const recorded = bundle.transactions.length

  return ordering.included
    .map((placement) => placement.timeMs - arrivalMs(placement.index, recorded))
    .sort((left, right) => left - right)
}
