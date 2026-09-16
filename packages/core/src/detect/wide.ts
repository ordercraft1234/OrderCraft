import type { NormalizedTransaction, SlotBundle } from '../slot/schema.ts'
import { absolute, improved, largestCounterparty, netOf, ownNet, poolSide } from './price.ts'

/**
 * One pair of legs as the wider filter proposes it — `slotctl scan`'s unit, and the unit
 * a hand-written label describes.
 *
 * The screen takes pairs rather than finding its own, and that is deliberate. Whichever
 * slots it picks are then labelled **exhaustively over `scan`'s pairs**, so a screen that
 * proposed pairs of its own would be measured against a denominator that never contained
 * them.
 */
export interface WidePair {
  front: number
  back: number
  /** The party on both sides. */
  signer: string
  /** Positions between the legs, as the wider filter found them. */
  between: number[]
}

export interface WideHit extends WidePair {
  /** The asset whose direction reverses between the legs. */
  mint: string
  /** The counterparty that took the other side of the opening leg. */
  openPool: string
  /** And of the closing one — **not required to be the same party**. */
  closePool: string
  /** Whether it was the same party anyway. */
  samePool: boolean
  /** Positions between the legs that traded the mint at all. */
  touched: number[]
  /** Of those, the ones that traded it the way the opening leg did. */
  aligned: number[]
  /** How much of the mint the opening leg moved, unsigned. */
  size: bigint
}

/**
 * The wider screen of T057: pairs whose round trip **made money**, whatever pool it ran
 * through.
 *
 * **What it is for, and what it is not.** It is not a detector and nothing shows its
 * output to a user. It exists to choose which slots are worth a person's two minutes per
 * pair, because the set the labels describe cannot be chosen by the rule the labels are
 * meant to measure. `findSandwiches` selected the previous set, the labelling rejected all
 * nine triples it offered, and the set was left with **zero known attacks** — a denominator
 * that can never be anything else, no matter how the rule is later corrected.
 *
 * **Why these two questions and no others.** Measured over the 1,071-slot cache on
 * 2026-09-10, `scan` proposes 3,759 leg pairs; 57 reverse a mint the signer holds itself,
 * 54 of those carry a readable price on both legs, and **26 closed better than they opened,
 * across 19 slots**. The narrow rule reports **none** anywhere in that cache. So the screen
 * is demonstrably not the detector in wider clothing, which is the one property it had to
 * have.
 *
 * **Three things the narrow rule asks that this does not:**
 *
 * - **the same pool on both legs.** Requiring it is what collapses 3,759 pairs to 9 —
 *   the first of two narrowings, and the second was only ever tested on what the first let
 *   through. Here each leg names its own venue, so a round trip that opened at one pool and
 *   closed at another is still asked whether it paid. Of the 26 survivors, **2** met the
 *   same pool twice.
 * - **matching leg sizes.** A threshold read off nine points (`LEG_MATCH_PERCENT`) is not
 *   something to select a *new* sample with.
 * - **which way the party in the middle traded.** That is one of the three checks T055
 *   added, so screening on it would pick the sample partly by agreement with the rule
 *   again. It is recorded instead — `touched` and `aligned` — and left to whoever labels.
 *
 * **The bias that remains, and it must travel with any number read off this set:** a pair
 * with no readable price on both legs is invisible here, and so is a round trip that lost
 * money. An attack that failed to pay is an attack; this screen cannot see it. What the
 * resulting recall figure says is "of the attacks in slots where somebody turned a
 * profitable round trip, how many does the detector find" — not "of the attacks in a block".
 */
export function screenPairs(bundle: SlotBundle, pairs: WidePair[]): WideHit[] {
  const at = new Map(bundle.transactions.map((transaction) => [transaction.index, transaction]))

  return pairs.flatMap((pair) => {
    const front = at.get(pair.front)
    const back = at.get(pair.back)
    if (front === undefined || back === undefined) return []

    const hits = profitableMints(front, back, pair.signer).map((round) => describe(at, pair, round))

    // Largest round trip first, mint then pool breaking ties: one pair yields one row,
    // and two runs over the same slot must not disagree about which.
    const best = hits.sort(byTrade)[0]

    return best === undefined ? [] : [best]
  })
}

interface Round {
  mint: string
  openPool: string
  closePool: string
  opened: bigint
}

/** Every mint the pair reversed **and** closed at a better price than it opened. */
function profitableMints(
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  signer: string,
): Round[] {
  const closing = ownNet(back, signer)
  const rounds: Round[] = []

  for (const [mint, opened] of ownNet(front, signer)) {
    const closed = closing.get(mint) ?? 0n
    // Reversed, and that is all: no size threshold, unlike the narrow rule.
    if (opened === 0n || closed === 0n || opened > 0n === closed > 0n) continue

    const openPool = largestCounterparty(front, signer, mint, opened)
    const closePool = largestCounterparty(back, signer, mint, closed)
    if (openPool === null || closePool === null) continue

    const opening = poolSide(front, openPool, mint)
    const settled = poolSide(back, closePool, mint)
    // An unreadable price is a refusal, not a zero — the same answer the narrow rule
    // gives, and for the same reason: it is not evidence of a profit either way.
    if (opening === null || settled === null || !improved(opening, settled)) continue

    rounds.push({ mint, openPool, closePool, opened })
  }

  return rounds
}

/**
 * The surviving round trip with what the transactions in between did to the same asset.
 *
 * Direction of the middle is read on **its own** balances rather than on a pool's side,
 * because with the two legs settling at different venues there is no one pool for it to
 * have traded. A middle that moved the mint through accounts nobody can attribute to its
 * signers counts as `touched` and not as `aligned`: it traded, and which way is unread.
 */
function describe(at: Map<number, NormalizedTransaction>, pair: WidePair, round: Round): WideHit {
  const touched: number[] = []
  const aligned: number[] = []

  for (const index of pair.between) {
    const middle = at.get(index)
    if (middle === undefined) continue
    if (!middle.tokenDelta.some((delta) => delta.mint === round.mint)) continue

    touched.push(index)

    let moved = 0n
    for (const signer of middle.signers) moved += netOf(middle, signer, round.mint)
    if (moved !== 0n && moved < 0n === round.opened < 0n) aligned.push(index)
  }

  return {
    ...pair,
    mint: round.mint,
    openPool: round.openPool,
    closePool: round.closePool,
    samePool: round.openPool === round.closePool,
    touched,
    aligned,
    size: absolute(round.opened),
  }
}

/** Largest leg first; mint then pool break ties, so two runs cannot disagree. */
function byTrade(left: WideHit, right: WideHit): number {
  if (left.size !== right.size) return left.size > right.size ? -1 : 1
  if (left.mint !== right.mint) return left.mint < right.mint ? -1 : 1

  return left.openPool < right.openPool ? -1 : 1
}
