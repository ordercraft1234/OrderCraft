import type { NormalizedTransaction, SlotBundle } from '../slot/schema.ts'
import { absolute, improved, largestCounterparty, netOf, ownNet, poolSide } from './price.ts'

/**
 * A pair of legs proposed by `slotctl scan` — the unit a hand-written label describes.
 *
 * Taken rather than found, for the reason the wider screen of T057 takes them: whichever
 * slots this picks are labelled **exhaustively over `scan`'s pairs**, so a screen that
 * proposed pairs of its own would be measured against a denominator without them.
 */
export interface ShapePair {
  front: number
  back: number
  /** The party on both legs. */
  signer: string
  between: number[]
}

export interface ShapeHit extends ShapePair {
  /** The asset whose direction reverses between the legs. */
  mint: string
  /** The counterparty that took the other side of it in **both** legs. */
  pool: string
  /** Positions between the legs that traded that asset through that pool. */
  victims: number[]
  /** Of those, the ones that traded it the way the opening leg did. */
  aligned: number[]
  /** How much of the mint the opening leg moved, unsigned. */
  size: bigint
  /** How much of it came back, unsigned — the closing leg's side. */
  closed: bigint
  /**
   * Whether the round trip closed at a better price than it opened, read at the pool.
   *
   * **Recorded, never required.** A sandwich that lost money is still a sandwich: the
   * front-run fires, the victim's trade does not move the price as far as the bot bet,
   * and the exit pays less than the entry. Every screen in this repository before this
   * one asked for a profit, and `wide.ts` names that as its own blind spot in as many
   * words. This is the population that blind spot hides.
   */
  paid: boolean
}

export interface ShapeOptions {
  window?: number
}

/**
 * The sandwich **shape**, with no question about whether it paid (T059).
 *
 * One party either side of somebody else, both legs meeting the same pool in opposite
 * directions on one asset, and somebody in between trading that asset through that pool.
 * That is the pre-T055 rule, minus the three things T055 added — profit, polarity, and
 * matching leg sizes — each of which is computed here and **written down instead**.
 *
 * **Why the three are recorded rather than applied.** They were read off nine examples
 * that blind labelling had already rejected, so they describe what those nine were not.
 * Applied to selection, they would draw the next sample by agreement with themselves; the
 * screen would find what the rule already believes and the labels would confirm it. The
 * detector keeps them — that is `findSandwiches`, and it is what SC-003 measures. This
 * chooses whom to ask.
 *
 * **The size of the population, measured over the 1,071-slot cache on 2026-09-10:**
 * 3,759 leg pairs from `scan` → 57 reverse a mint → 23 meet the same pool on both legs →
 * **7 have somebody in between trading that mint at that pool** → 2 of those traded the
 * way the opening leg did → **0 closed better than they opened**. The seven are exactly
 * the slots T047 labelled and rejected, which is why a bigger cache is the only source of
 * new ones: roughly **6 pairs per 1,000 slots**.
 */
export function shapedPairs(
  bundle: SlotBundle,
  pairs: ShapePair[],
  options: ShapeOptions = {},
): ShapeHit[] {
  const at = new Map(bundle.transactions.map((transaction) => [transaction.index, transaction]))
  const window = options.window

  return pairs.flatMap((pair) => {
    if (window !== undefined && pair.back - pair.front > window) return []

    const front = at.get(pair.front)
    const back = at.get(pair.back)
    if (front === undefined || back === undefined) return []

    const rounds = roundsFor(front, back, pair.signer).map((round) =>
      describe(at, pair, front, back, round),
    )

    // One pair yields one row, largest trade first — two runs over the same slot must
    // not disagree about which.
    const best = rounds.filter((hit) => hit.victims.length > 0).sort(byTrade)[0]

    return best === undefined ? [] : [best]
  })
}

interface Round {
  mint: string
  pool: string
  opened: bigint
  closed: bigint
}

/** Every mint the pair reversed through one and the same counterparty. */
function roundsFor(
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  signer: string,
): Round[] {
  const closing = ownNet(back, signer)
  const rounds: Round[] = []

  for (const [mint, opened] of ownNet(front, signer)) {
    const closed = closing.get(mint) ?? 0n
    // Reversed, and that is all: no size threshold and no direction of profit.
    if (opened === 0n || closed === 0n || opened > 0n === closed > 0n) continue

    const openPool = largestCounterparty(front, signer, mint, opened)
    const closePool = largestCounterparty(back, signer, mint, closed)
    // The same pool on both legs is what separates a sandwich from cross-pool
    // arbitrage, and no threshold on direction can do it — see `sandwich.ts`.
    if (openPool === null || closePool === null || openPool !== closePool) continue

    rounds.push({ mint, pool: openPool, opened, closed })
  }

  return rounds
}

function describe(
  at: Map<number, NormalizedTransaction>,
  pair: ShapePair,
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  round: Round,
): ShapeHit {
  const victims: number[] = []
  const aligned: number[] = []

  for (const index of pair.between) {
    const middle = at.get(index)
    if (middle === undefined) continue
    // Trading the same asset elsewhere is a different trade, not this one's victim.
    if (netOf(middle, round.pool, round.mint) === 0n) continue

    victims.push(index)

    let moved = 0n
    for (const signer of middle.signers) moved += netOf(middle, signer, round.mint)
    if (moved !== 0n && moved < 0n === round.opened < 0n) aligned.push(index)
  }

  const opening = poolSide(front, round.pool, round.mint)
  const settled = poolSide(back, round.pool, round.mint)

  return {
    ...pair,
    mint: round.mint,
    pool: round.pool,
    victims,
    aligned,
    size: absolute(round.opened),
    closed: absolute(round.closed),
    // An unreadable price is not a profit: the same refusal the other screens make.
    paid: opening !== null && settled !== null && improved(opening, settled),
  }
}

/** Largest leg first; mint then pool break ties, so two runs cannot disagree. */
function byTrade(left: ShapeHit, right: ShapeHit): number {
  if (left.size !== right.size) return left.size > right.size ? -1 : 1
  if (left.mint !== right.mint) return left.mint < right.mint ? -1 : 1

  return left.pool < right.pool ? -1 : 1
}
