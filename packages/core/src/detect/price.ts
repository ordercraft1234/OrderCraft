import type { NormalizedTransaction } from '../slot/schema.ts'

/**
 * Reading balances and prices out of one recorded transaction.
 *
 * Extracted from `sandwich.ts` when the wider screen of T057 came to need the same
 * arithmetic. **Shared on purpose rather than copied**: "the price at the pool" is one
 * quantity, and two implementations of it would drift on the first correction — the
 * narrow rule would then reject a pair for a reason the screen had already stopped
 * applying, and nobody would see it happen.
 *
 * What is *not* shared is any rule. This module answers "what moved" and "which way was
 * the price"; which conjunction of answers means an attack belongs to the caller, and
 * the narrow rule and the wide screen deliberately disagree about it.
 */

/** What the transaction moved through accounts the given party owns, by mint. */
export function ownNet(transaction: NormalizedTransaction, owner: string): Map<string, bigint> {
  const net = new Map<string, bigint>()
  for (const delta of transaction.tokenDelta) {
    if (delta.owner !== owner) continue
    net.set(delta.mint, (net.get(delta.mint) ?? 0n) + delta.amount)
  }

  return net
}

/** Net movement of one mint through one party's accounts in one transaction. */
export function netOf(transaction: NormalizedTransaction, owner: string, mint: string): bigint {
  let net = 0n
  for (const delta of transaction.tokenDelta) {
    if (delta.owner === owner && delta.mint === mint) net += delta.amount
  }

  return net
}

export function absolute(value: bigint): bigint {
  return value < 0n ? -value : value
}

export interface PoolSide {
  /** How much of the reversed mint the pool moved, unsigned. */
  base: bigint
  /** How much of the counter-asset it moved the other way, unsigned. */
  quote: bigint
  /** Whether the pool took the mint in — that is, whether the signer sold it. */
  sold: boolean
}

/**
 * What the pool exchanged in one leg: the reversed mint against whatever paid for it.
 *
 * Price is `quote / base` at the pool, where base is the reversed mint and quote is the
 * largest thing the pool moved the other way in the same transaction — its own lamports
 * included, because a pool settling against native SOL rather than wrapped SOL puts the
 * whole other half of the trade there and an SPL-only reading would see no price at all.
 *
 * `null` when there is no counter-side to read. A price nobody can read is not evidence
 * of anything, and every caller here treats it as a refusal rather than a zero.
 */
export function poolSide(
  transaction: NormalizedTransaction,
  pool: string,
  mint: string,
): PoolSide | null {
  const base = netOf(transaction, pool, mint)
  if (base === 0n) return null

  let quote = 0n
  for (const [other, amount] of ownNet(transaction, pool)) {
    if (other === mint || amount === 0n || amount > 0n === base > 0n) continue
    if (absolute(amount) > quote) quote = absolute(amount)
  }

  const lamports = transaction.lamportDelta[pool] ?? 0n
  if (lamports !== 0n && lamports > 0n !== base > 0n && absolute(lamports) > quote) {
    quote = absolute(lamports)
  }

  return quote === 0n ? null : { base: absolute(base), quote, sold: base > 0n }
}

/**
 * Whether the closing leg got a better price than the opening one.
 *
 * Compared by cross-multiplication rather than division: balances are integers, a ratio
 * of two of them is not, and `packages/core` is not allowed floating point.
 *
 * Direction comes from the opening side. The pool received the mint, so the signer sold
 * it first and profits by buying it back cheaper; the other way round, it bought first
 * and profits by selling dearer.
 */
export function improved(opening: PoolSide, closing: PoolSide): boolean {
  const openPrice = opening.quote * closing.base
  const closePrice = closing.quote * opening.base

  return opening.sold ? closePrice < openPrice : closePrice > openPrice
}

/**
 * The largest counterparty that took the opposite side of this mint in this leg.
 *
 * Used where the two legs are **not** required to have met the same pool (T057): each
 * leg then has to name its own venue, and "the party that moved most of the mint the
 * other way" is the only reading available without asking the chain what a pool is.
 * Sorted before the walk, so a tie does not depend on the order balances were recorded.
 */
export function largestCounterparty(
  transaction: NormalizedTransaction,
  signer: string,
  mint: string,
  side: bigint,
): string | null {
  const owners = [
    ...new Set(
      transaction.tokenDelta
        .filter((delta) => delta.mint === mint && delta.owner !== signer)
        .map((delta) => delta.owner),
    ),
  ].sort()

  let best: string | null = null
  let size = 0n
  for (const owner of owners) {
    const net = netOf(transaction, owner, mint)
    if (net === 0n || net > 0n === side > 0n) continue
    if (absolute(net) > size) {
      size = absolute(net)
      best = owner
    }
  }

  return best
}
