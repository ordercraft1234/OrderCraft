import type { NormalizedTransaction, SlotBundle } from '../slot/schema.ts'

/** How far apart the outer legs may sit before this stops being one bundle. */
const DEFAULT_WINDOW = 4

export interface Sandwich {
  /** Position in the recorded block of the first leg. */
  front: number
  /** Everything caught between the legs, in recorded order. Never empty. */
  victims: number[]
  back: number
  /** The party on both sides. */
  signer: string
  /** The asset whose direction reverses between the legs. */
  mint: string
  /** Accounts all three transactions touch — the pool, in practice. */
  shared: string[]
}

export interface SandwichOptions {
  window?: number
}

/**
 * Marks sandwich triples in a recorded block (FR-012, FR-027).
 *
 * The rule: the same party either side of somebody else, trading the same pool in
 * opposite directions, close enough together to have been one bundle.
 *
 * **Which leg the direction is read on.** An attacker's *token* leg is usually invisible
 * in a slot — the token sits in an account owned by the bot's own program, not by the
 * wallet that signed — so a detector that looked for the token going out and coming back
 * finds nothing: across 171 recorded slots it found zero. What the wallet does hold is
 * the quote side, SOL or USDC, and the reversal is plain there. So direction is read on
 * any mint whose balance belongs to **the signer itself**, and in practice that is the
 * quote asset.
 *
 * That choice also settles the counterparty problem for free. A pool reverses direction
 * around every trade it settles; if any owner counted, every swap in the block would be
 * an attack. The pool signs nothing, so requiring the reversal on a signer's own balance
 * excludes it without a special case.
 *
 * **This is a heuristic and it is not a verdict.** It says a triple has the shape. Whether
 * value was taken is `metrics/extracted.ts`, and whether the shape is really an attack is
 * settled against hand-checked labels (FR-028), never against this function's own output.
 */
export function findSandwiches(bundle: SlotBundle, options: SandwichOptions = {}): Sandwich[] {
  const window = options.window ?? DEFAULT_WINDOW
  // A failed transaction moved no balance, so there is nothing for it to have taken.
  // Up to 40 % of what a wide filter offers is a pair of failed bot attempts around
  // somebody else's transaction.
  const live = bundle.transactions.filter((transaction) => !transaction.failed)

  const found: Sandwich[] = []
  for (const [position, front] of live.entries()) {
    // One front, one sandwich: the same pair of legs seen at three distances is one
    // attack, and a list that reported all three would give a count nobody could
    // reconcile with the block.
    const sandwich = nearestBack(live, position, front, window)
    if (sandwich !== null) found.push(sandwich)
  }

  return found
}

function nearestBack(
  live: NormalizedTransaction[],
  position: number,
  front: NormalizedTransaction,
  window: number,
): Sandwich | null {
  for (const back of live.slice(position + 1)) {
    if (back.index - front.index > window) return null

    const signer = sharedSigner(front, back)
    if (signer === undefined) continue

    const shared = intersect(outsideAccounts(front), outsideAccounts(back))
    if (shared.length === 0) continue

    const victims = between(live, front, back, shared)
    if (victims.length === 0) continue

    const mint = reversedMint(front, back, signer)
    if (mint === null) continue

    return {
      front: front.index,
      victims: victims.map((victim) => victim.index),
      back: back.index,
      signer,
      mint,
      shared,
    }
  }

  return null
}

/** Transactions between the legs, signed by somebody else, on an account all three touch. */
function between(
  live: NormalizedTransaction[],
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  shared: string[],
): NormalizedTransaction[] {
  return live.filter(
    (middle) =>
      middle.index > front.index &&
      middle.index < back.index &&
      sharedSigner(middle, front) === undefined &&
      sharedSigner(middle, back) === undefined &&
      shared.some((account) => middle.accounts.includes(account)),
  )
}

/**
 * The mint the signer's own balance moves one way in the first leg and the other way in
 * the second. When several qualify, the one the first leg moved most — a bot paying a
 * tip in SOL and trading in USDC reverses both, and the trade is the larger of the two.
 * The mint string breaks a tie, so two runs cannot disagree.
 */
function reversedMint(
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  signer: string,
): string | null {
  const opening = ownNet(front, signer)
  const closing = ownNet(back, signer)

  let chosen: string | null = null
  let size = 0n
  for (const [mint, opened] of opening) {
    const closed = closing.get(mint)
    if (closed === undefined || opened === 0n || closed === 0n) continue
    if (opened > 0n === closed > 0n) continue

    const magnitude = absolute(opened)
    if (chosen === null || magnitude > size || (magnitude === size && mint < chosen)) {
      chosen = mint
      size = magnitude
    }
  }

  return chosen
}

/** What the transaction moved through accounts the given party owns, by mint. */
function ownNet(transaction: NormalizedTransaction, signer: string): Map<string, bigint> {
  const net = new Map<string, bigint>()
  for (const delta of transaction.tokenDelta) {
    if (delta.owner !== signer) continue
    net.set(delta.mint, (net.get(delta.mint) ?? 0n) + delta.amount)
  }

  return net
}

function sharedSigner(
  left: NormalizedTransaction,
  right: NormalizedTransaction,
): string | undefined {
  return left.signers.find((signer) => right.signers.includes(signer))
}

/**
 * Accounts the transaction touches that are neither the programs it invokes nor its own
 * signers. Without this every pair of transactions shares the token program, and "the
 * same pool" degenerates into "both used Solana".
 */
function outsideAccounts(transaction: NormalizedTransaction): string[] {
  return transaction.accounts.filter(
    (account) => !transaction.programs.includes(account) && !transaction.signers.includes(account),
  )
}

function intersect(left: string[], right: string[]): string[] {
  const other = new Set(right)

  return [...new Set(left.filter((value) => other.has(value)))]
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value
}
