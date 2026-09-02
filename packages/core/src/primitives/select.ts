import type { Selector } from '../policy/schema.ts'
import type { NormalizedTransaction } from '../slot/schema.ts'

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
