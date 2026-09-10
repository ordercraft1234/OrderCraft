import type { Sandwich } from '../detect/sandwich.ts'
import type { NormalizedTransaction, SlotBundle } from '../slot/schema.ts'

export interface TokenAmount {
  mint: string
  amount: bigint
}

export interface ExtractedValue {
  /** Net token movement through the attacker's own accounts, by mint, mint order. */
  tokens: TokenAmount[]
  /** Net lamports across the triple. Fees are already inside this figure. */
  lamports: bigint
  /** Fees the attacker's own two transactions paid — the victim pays its own. */
  fees: bigint
}

/**
 * What the party either side of the victim ended up with (FR-025, FR-026).
 *
 * This is arithmetic on balances the chain recorded, not an estimate: the attacker's own
 * accounts, before and after, across all three transactions. Nothing here says what a
 * transaction would have executed at in another order — that needs a price the slot does
 * not carry, and the product does not claim it.
 *
 * **Fees are not subtracted again.** A fee leaves the payer's balance before the post
 * balance is written, so `lamportDelta` is already net of it. FR-025 asks for the figure
 * after fees and this is it; `fees` is reported separately because it is worth seeing,
 * not because it still has to come off.
 *
 * **This is a floor, not the whole story.** Only accounts the signer owns are counted. A
 * bot usually parks its token inventory in accounts owned by its own program, and those
 * cannot be attributed to it from a slot alone — so a triple that ends with the attacker
 * still holding the token shows only the quote side of the trade here.
 *
 * **A net is not always a profit.** When the attacker ends the triple holding a different
 * asset than it started with, the vector below describes a position, not a gain — on the
 * measured slots this is common, and it is why the figures are handed over as a vector by
 * mint rather than reduced to one number. A triple where everything closed except the
 * quote asset is the readable case; the screen has to print what it is given and say so.
 *
 * Tokens and SOL are kept apart and no exchange rate is applied: converting would need a
 * price at the slot, which the block does not record.
 */
export function extractedValue(bundle: SlotBundle, sandwich: Sandwich): ExtractedValue {
  const transactions = [sandwich.front, ...sandwich.victims, sandwich.back].map((index) =>
    at(bundle, index),
  )

  const tokens = new Map<string, bigint>()
  let lamports = 0n
  let fees = 0n

  for (const transaction of transactions) {
    for (const delta of transaction.tokenDelta) {
      if (delta.owner !== sandwich.signer) continue
      tokens.set(delta.mint, (tokens.get(delta.mint) ?? 0n) + delta.amount)
    }

    lamports += ownLamports(transaction, sandwich.signer)
    // Only the legs it signed. The victim's fee is the victim's, and adding it here
    // would make the attack look more expensive to the attacker than it was.
    if (transaction.signers.includes(sandwich.signer)) fees += transaction.fee
  }

  return {
    tokens: [...tokens.entries()]
      .filter(([, amount]) => amount !== 0n)
      .map(([mint, amount]) => ({ mint, amount }))
      .sort((left, right) => (left.mint < right.mint ? -1 : 1)),
    lamports,
    fees,
  }
}

function ownLamports(transaction: NormalizedTransaction, signer: string): bigint {
  return transaction.lamportDelta[signer] ?? 0n
}

/**
 * A triple is positions in one block. A position with no transaction means the sandwich
 * and the slot came from different blocks — a programming error, not bad input.
 */
function at(bundle: SlotBundle, index: number): NormalizedTransaction {
  const transaction = bundle.transactions[index]
  if (transaction === undefined) {
    throw new Error(`position ${index} has no transaction in slot ${bundle.slot}`)
  }

  return transaction
}
