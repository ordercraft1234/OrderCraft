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
  /** The counterparty all three transactions trade that asset through — the pool. */
  pool: string
}

export interface SandwichOptions {
  window?: number
}

/**
 * Marks sandwich triples in a recorded block (FR-012, FR-027).
 *
 * The rule: the same party either side of somebody else, trading **the same pool** in
 * opposite directions, with the party in the middle trading that same pool in that same
 * asset, close enough together to have been one bundle.
 *
 * **Why the pool has to be the same one.** An earlier version of this asked only that the
 * two legs share *some* account and that the party in the middle touch one of them. Both
 * are true of cross-pool arbitrage — sell the quote asset at one pool, buy it back at
 * another — and a tip account or a shared token account satisfies "some account" for
 * transactions that never met. Measured over 171 recorded slots, that rule returned 18
 * triples of which **9 traded two different pools** and only **2** had anybody in the
 * middle trading the pool the legs traded. The demo slot the repository shipped contained
 * two triples and both were a market maker filling one client through two pools: the
 * "victim" was the client, and it had paid for the fill. Arbitrage reverses the quote leg
 * exactly the way a sandwich does, so no threshold on direction alone can separate them —
 * only the counterparty can.
 *
 * **Which leg the direction is read on.** Any mint whose balance belongs to the signer
 * itself. An attacker's token leg is often invisible — the token sits in an account owned
 * by the bot's own program, not by the wallet that signed — and then the reversal shows on
 * the quote side, SOL or USDC. When the bot does hold the token itself, as pump.fun-style
 * routes do, the token side reverses too, and the larger of the two is taken.
 *
 * **The pool is found, not assumed.** For the chosen mint, the counterparty must take the
 * *opposite* side in both legs: it received what the signer sent and sent what the signer
 * received. A pool reverses around every trade it settles, which is why it cannot be
 * identified by reversal alone — but paired with a signer that reversed too, and with a
 * third party trading it in between, the shape is no longer arbitrage.
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

    const round = roundTrip(live, front, back, signer)
    if (round === null) continue

    return {
      front: front.index,
      victims: round.victims,
      back: back.index,
      signer,
      mint: round.mint,
      pool: round.pool,
    }
  }

  return null
}

interface RoundTrip {
  mint: string
  pool: string
  victims: number[]
}

/**
 * The asset the signer sent and got back, the counterparty that took the other side of
 * both, and everyone who traded that counterparty in between.
 *
 * When several assets qualify, the one the first leg moved most — a bot paying a tip in
 * SOL and trading in USDC reverses both, and the trade is the larger of the two.
 */
function roundTrip(
  live: NormalizedTransaction[],
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  signer: string,
): RoundTrip | null {
  const opening = ownNet(front, signer)
  const closing = ownNet(back, signer)

  const options: Option[] = []
  for (const [mint, opened] of opening) {
    const closed = closing.get(mint) ?? 0n
    if (opened === 0n || closed === 0n || opened > 0n === closed > 0n) continue

    for (const pool of counterparties(front, back, signer, mint, opened, closed)) {
      const victims = between(live, front, back, mint, pool)
      if (victims.length > 0) options.push({ mint, pool, victims, size: absolute(opened) })
    }
  }

  const best = options.sort(byTrade)[0]

  return best === undefined ? null : { mint: best.mint, pool: best.pool, victims: best.victims }
}

interface Option extends RoundTrip {
  size: bigint
}

/** Largest leg first; mint then pool break ties, so two runs cannot disagree. */
function byTrade(left: Option, right: Option): number {
  if (left.size !== right.size) return left.size > right.size ? -1 : 1
  if (left.mint !== right.mint) return left.mint < right.mint ? -1 : 1

  return left.pool < right.pool ? -1 : 1
}

/**
 * Parties that took the other side of this mint in **both** legs: they received what the
 * signer sent and sent what the signer received. In practice there is one, and it is the
 * pool. Sorted, so the choice does not depend on the order balances were recorded in.
 */
function counterparties(
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  signer: string,
  mint: string,
  opened: bigint,
  closed: bigint,
): string[] {
  const owners = front.tokenDelta
    .filter((delta) => delta.mint === mint && delta.owner !== signer)
    .map((delta) => delta.owner)

  return [...new Set(owners)].sort().filter((owner) => {
    const took = netOf(front, owner, mint)
    const gave = netOf(back, owner, mint)

    return took !== 0n && gave !== 0n && took > 0n !== opened > 0n && gave > 0n !== closed > 0n
  })
}

/** Net movement of one mint through one party's accounts in one transaction. */
function netOf(transaction: NormalizedTransaction, owner: string, mint: string): bigint {
  let net = 0n
  for (const delta of transaction.tokenDelta) {
    if (delta.owner === owner && delta.mint === mint) net += delta.amount
  }

  return net
}

/**
 * Transactions between the legs, signed by somebody else, trading the same mint through
 * the same pool.
 *
 * Sharing an account is not enough and was the whole defect of the earlier rule: tip
 * vaults, fee accounts and shared token accounts are named by transactions that have
 * nothing to do with each other. A victim of a sandwich traded the pool the legs traded,
 * in the asset the legs reversed — anything less is a bystander.
 */
function between(
  live: NormalizedTransaction[],
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  mint: string,
  pool: string,
): number[] {
  return live
    .filter(
      (middle) =>
        middle.index > front.index &&
        middle.index < back.index &&
        sharedSigner(middle, front) === undefined &&
        sharedSigner(middle, back) === undefined &&
        middle.tokenDelta.some((delta) => delta.owner === pool && delta.mint === mint),
    )
    .map((middle) => middle.index)
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

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value
}
