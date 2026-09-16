import type { NormalizedTransaction, SlotBundle } from '../slot/schema.ts'
import { absolute, improved, netOf, ownNet, poolSide } from './price.ts'

/** How far apart the outer legs may sit before this stops being one bundle. */
const DEFAULT_WINDOW = 4

/**
 * How closely the two legs must match in size before the position counts as closed,
 * as a percentage of the larger one.
 *
 * A party that opened with four billion tokens and bought back thirty million did not
 * close anything — it sold, and the small second leg is noise beside the first. The
 * figure is read off the nine triples the blind labelling judged (T047): their leg
 * ratios are 0.008, 0.718, 0.739, 0.870, 0.892, 0.915, 0.924, 0.936, 0.985, and the
 * widest gap in that list is 0.739 to 0.870. Eighty per cent sits in that gap with room
 * either side, and rejects exactly the three the labels called an unmatched round trip.
 */
const LEG_MATCH_PERCENT = 80n

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
 * **Three questions the shape alone does not answer** (T055). Blind labelling of 56 leg
 * pairs judged all nine triples the pool rule reported to be something else, and the nine
 * rejections came down to three things the rule never asked:
 *
 * - **which way the party in the middle traded.** Buying in front of a seller is backwards:
 *   the seller's price move runs against the exit, and the round trip loses by construction.
 *   A sandwich front-runs a trade in the *same* direction as its own opening leg.
 * - **whether the round trip made money at all.** Closing worse than it opened satisfied
 *   every structural test the rule had. Price is read at the pool, per leg, and compared —
 *   see `closedBetter` for why the signer's own wallet is the wrong place to read it.
 * - **whether the position was closed.** Opening with four billion tokens and buying back
 *   0.76 % of them is a sale, not a round trip.
 *
 * **This is a heuristic and it is not a verdict.** It says a triple has the shape and that
 * the shape could have paid. Whether value was taken is `metrics/extracted.ts`, and whether
 * it is really an attack is settled against hand-checked labels (FR-028), never against
 * this function's own output.
 */
export function findSandwiches(bundle: SlotBundle, options: SandwichOptions = {}): Sandwich[] {
  const window = options.window ?? DEFAULT_WINDOW
  // A failed transaction moved no balance, so there is nothing for it to have taken.
  // Measured on the 171 cached slots, this is most of what a wide filter offers:
  // 80.9 % of `slotctl scan` candidates touch a failure, and not one of the 38,733
  // failed transactions there carries a tokenDelta at all. `scan` now drops them for
  // the same reason — such a triple is unanswerable rather than merely negative.
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
 *
 * Three of the checks below reject rather than rank, and each one names a different way a
 * reversal is not an attack: legs that do not match in size never closed a position, a
 * close at a worse price than the open never paid for one, and a party in the middle
 * trading the other way was not being front-run.
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
    if (!closesTheOpening(opened, closed)) continue

    options.push(...through(live, front, back, signer, mint, opened, closed))
  }

  const best = options.sort(byTrade)[0]

  return best === undefined ? null : { mint: best.mint, pool: best.pool, victims: best.victims }
}

/** Reversed, and the second leg is the size of the first: one trade in two halves. */
function closesTheOpening(opened: bigint, closed: bigint): boolean {
  if (opened === 0n || closed === 0n || opened > 0n === closed > 0n) return false

  return legsMatch(opened, closed)
}

/** Every pool the round trip could have run through and paid at, with who was inside. */
function through(
  live: NormalizedTransaction[],
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  signer: string,
  mint: string,
  opened: bigint,
  closed: bigint,
): Option[] {
  const options: Option[] = []
  for (const pool of counterparties(front, back, signer, mint, opened, closed)) {
    if (!closedBetter(front, back, pool, mint)) continue

    const victims = between(live, front, back, mint, pool)
    if (victims.length > 0) options.push({ mint, pool, victims, size: absolute(opened) })
  }

  return options
}

interface Option extends RoundTrip {
  size: bigint
}

/**
 * Whether the second leg closed the position the first one opened, rather than nibbling
 * at it.
 *
 * A round trip is one trade in two halves, and halves that differ by more than a fifth are
 * two different trades. `445553238 #339/342` sold 4.006 billion tokens and bought back
 * 30.6 million — 0.76 % — which the blind labelling read, correctly, as "plain large sale".
 * Nothing else in this file notices, because the direction did reverse and a pool did take
 * both sides.
 */
function legsMatch(opened: bigint, closed: bigint): boolean {
  const first = absolute(opened)
  const second = absolute(closed)
  const smaller = first < second ? first : second
  const larger = first < second ? second : first

  return smaller * 100n >= LEG_MATCH_PERCENT * larger
}

/**
 * Whether the round trip closed at a better price than it opened — the only reason to do
 * one at all.
 *
 * **Read at the pool, not at the wallet.** The signer's own balances carry every other leg
 * of its transaction: a bot that fills two client orders and hedges the remainder ends the
 * pair up on SOL because it sold tokens, not because the round trip paid. On
 * `445553238 #394/397` the wallet shows +736,315,196 lamports and the pool shows the
 * quote-per-token going from 1.2239e-4 out to 1.2726e-4 back — a loss of half a per cent,
 * which is what the labelling saw. The wallet figure is the market value of 5.74 trillion
 * tokens the pair sold and never bought back; a test for "ended up with more SOL" would
 * call that market maker an attacker.
 *
 * Price is `quote / base` at the pool, where base is the reversed mint and quote is the
 * largest thing the pool moved the other way in the same transaction — its own lamports
 * included. The two prices are compared by cross-multiplication: balances are integers and
 * a ratio of two of them is not.
 *
 * When either leg has no readable counter-side, the answer is no. A price nobody can read
 * is not evidence of a profit, and this rule exists to stop the detector reporting triples
 * it cannot account for.
 */
function closedBetter(
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  pool: string,
  mint: string,
): boolean {
  const opening = poolSide(front, pool, mint)
  const closing = poolSide(back, pool, mint)
  if (opening === null || closing === null) return false

  return improved(opening, closing)
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

/**
 * Transactions between the legs, signed by somebody else, trading the same mint through
 * the same pool.
 *
 * Sharing an account is not enough and was the whole defect of the earlier rule: tip
 * vaults, fee accounts and shared token accounts are named by transactions that have
 * nothing to do with each other. A victim of a sandwich traded the pool the legs traded,
 * in the asset the legs reversed — anything less is a bystander.
 *
 * **And traded it the same way the opening leg did.** Buying in front of somebody else's
 * buy is the attack: the front-run moves the price against them and the closing leg sells
 * into it. Buying in front of a *seller* is the same shape and the opposite trade — their
 * sale pushes the price down and the exit is worse for it, which is why every such triple
 * the labelling looked at had lost money. `445660284 #487/490` is the case in the notes:
 * the signer bought, the party in the middle sold, the signer sold out lower.
 *
 * Direction is read on the pool's side because the pool has exactly one, whoever else the
 * transaction paid or routed through: the pool taking the mint in means somebody sold it.
 */
function between(
  live: NormalizedTransaction[],
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  mint: string,
  pool: string,
): number[] {
  const opening = netOf(front, pool, mint)

  return live
    .filter(
      (middle) =>
        middle.index > front.index &&
        middle.index < back.index &&
        sharedSigner(middle, front) === undefined &&
        sharedSigner(middle, back) === undefined &&
        tradedWith(middle, pool, mint, opening),
    )
    .map((middle) => middle.index)
}

/** Moved this mint through this pool, in the same direction the opening leg moved it. */
function tradedWith(
  middle: NormalizedTransaction,
  pool: string,
  mint: string,
  opening: bigint,
): boolean {
  const moved = netOf(middle, pool, mint)

  return moved !== 0n && moved > 0n === opening > 0n
}

function sharedSigner(
  left: NormalizedTransaction,
  right: NormalizedTransaction,
): string | undefined {
  return left.signers.find((signer) => right.signers.includes(signer))
}
