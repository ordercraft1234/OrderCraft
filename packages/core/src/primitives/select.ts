import type { Selector } from '../policy/schema.ts'
import type { NormalizedTransaction, SlotBundle } from '../slot/schema.ts'
import type { Placement } from './placement.ts'

/**
 * Does this transaction belong to the class a step applies to?
 *
 * Every branch is answerable from the transaction alone. Nothing here consults history,
 * pool age or prices — the slot is all the evidence the simulator has, and a selector
 * that needed more would be a promise the simulator cannot keep.
 */
export function matchesSelector(selector: Selector, transaction: NormalizedTransaction): boolean {
  switch (selector.match) {
    case 'all':
      return true
    case 'program':
      return selector.programs.some((program) => transaction.programs.includes(program))
    case 'signer':
      return selector.signers.some((signer) => transaction.signers.includes(signer))
    case 'account':
      return selector.accounts.some((account) => transaction.accounts.includes(account))
    case 'tokenDeltaAbove': {
      // Magnitude, not sign: one side of a swap is always negative, and a threshold
      // that only caught buys would silently select half of what the user meant.
      const threshold = BigInt(selector.amount)
      return transaction.tokenDelta.some(
        (delta) => delta.mint === selector.mint && absolute(delta.amount) > threshold,
      )
    }
  }
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value
}

/**
 * Applies `change` to every transaction still in the block that the selector picks out.
 *
 * Primitives share this so each of them is only its own arithmetic. The lookup, the
 * "already out of the block" rule and the selector test are decided once, in one place
 * that can be tested once, instead of being remembered three times.
 */
export function mapMatching(
  bundle: SlotBundle,
  placements: readonly Placement[],
  selector: Selector,
  change: (placement: Placement, transaction: NormalizedTransaction) => Placement,
): Placement[] {
  return placements.map((placement) => {
    const transaction = bundle.transactions[placement.index]
    if (transaction === undefined) {
      throw new Error(`placement ${placement.index} has no transaction in slot ${bundle.slot}`)
    }

    // A refused transaction cannot be moved, and a deferred one has nowhere further
    // to go inside this slot.
    if (placement.status !== 'kept') return placement
    if (!matchesSelector(selector, transaction)) return placement

    return change(placement, transaction)
  })
}
