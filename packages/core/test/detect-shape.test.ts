import { describe, expect, it } from 'vitest'
import { findSandwiches } from '../src/detect/sandwich.ts'
import { type ShapePair, shapedPairs } from '../src/detect/shape.ts'
import { ATTACKER, MINT, OTHER_POOL, POOL, QUOTE, VICTIM, bundleOf, tx } from './helpers/build.ts'

/** A leg priced at its pool, exactly as the detector and the wider screen price one. */
function leg(index: number, quote: bigint, token: bigint, pool: string = POOL) {
  return tx(index, {
    signers: [ATTACKER],
    tokenDelta: [
      { owner: ATTACKER, mint: QUOTE, amount: quote },
      { owner: pool, mint: QUOTE, amount: -quote },
      { owner: pool, mint: MINT, amount: token },
    ],
  })
}

/** Sells 1,000 quote; buys the same 5,000 token back — for 1,100 or for 900. */
const OPENS = [-1000n, -5000n] as const
const GAINS = [1100n, 5000n] as const
const LOSES = [900n, 5000n] as const

function middle(index: number, quote = -300n, pool: string = POOL) {
  return tx(index, {
    signers: [VICTIM],
    accounts: [VICTIM, pool],
    tokenDelta: [
      { owner: VICTIM, mint: QUOTE, amount: quote },
      { owner: pool, mint: QUOTE, amount: -quote },
      { owner: VICTIM, mint: MINT, amount: -quote * 2n },
      { owner: pool, mint: MINT, amount: quote * 2n },
    ],
  })
}

const PAIR: ShapePair[] = [{ front: 1, back: 3, signer: ATTACKER, between: [2] }]

describe('shapedPairs — the shape, with no question about whether it paid', () => {
  /**
   * The property the whole task turns on. A front-run that misjudged the victim's size
   * exits worse than it entered, and it is still an attack; every screen before this one
   * required a profit, and `wide.ts` names that as its own blind spot.
   */
  it('keeps a round trip that lost money', () => {
    const bundle = bundleOf([tx(0), leg(1, ...OPENS), middle(2), leg(3, ...LOSES)])
    const [hit] = shapedPairs(bundle, PAIR)

    expect(hit?.paid).toBe(false)
    expect(hit?.victims).toEqual([2])
    // And the detector, which does require a profit, says nothing about the same block.
    expect(findSandwiches(bundle)).toEqual([])
  })

  it('records that a profitable one paid, rather than selecting on it', () => {
    const bundle = bundleOf([tx(0), leg(1, ...OPENS), middle(2), leg(3, ...GAINS)])
    const [hit] = shapedPairs(bundle, PAIR)

    expect(hit?.paid).toBe(true)
    expect(hit?.mint).toBe(QUOTE)
    expect(hit?.pool).toBe(POOL)
  })

  it('keeps a leg the size of a rounding error, and says how big both were', () => {
    const bundle = bundleOf([tx(0), leg(1, ...OPENS), middle(2), leg(3, 10n, 40n)])
    const [hit] = shapedPairs(bundle, PAIR)

    expect(hit?.size).toBe(1000n)
    expect(hit?.closed).toBe(10n)
  })

  it('writes down which way the middle traded instead of filtering on it', () => {
    const bought = shapedPairs(
      bundleOf([tx(0), leg(1, ...OPENS), middle(2), leg(3, ...GAINS)]),
      PAIR,
    )
    const sold = shapedPairs(
      bundleOf([tx(0), leg(1, ...OPENS), middle(2, 300n), leg(3, ...GAINS)]),
      PAIR,
    )

    expect(bought[0]?.aligned).toEqual([2])
    expect(sold[0]?.victims).toEqual([2])
    expect(sold[0]?.aligned).toEqual([])
  })

  /**
   * The one narrowing kept from T055's predecessor, because no threshold on direction can
   * replace it: selling an asset at one pool and buying it back at another reverses the
   * leg exactly as a sandwich does, and the party in between never met either trade.
   */
  it('drops a round trip that opened at one pool and closed at another', () => {
    const bundle = bundleOf([
      tx(0),
      leg(1, ...OPENS),
      middle(2),
      leg(3, GAINS[0], GAINS[1], OTHER_POOL),
    ])

    expect(shapedPairs(bundle, PAIR)).toEqual([])
  })

  it('drops a pair nobody in the middle traded that pool against', () => {
    const elsewhere = bundleOf([
      tx(0),
      leg(1, ...OPENS),
      middle(2, -300n, OTHER_POOL),
      leg(3, ...GAINS),
    ])

    expect(shapedPairs(elsewhere, PAIR)).toEqual([])
  })

  it('will not reach across a window it was given', () => {
    const bundle = bundleOf([tx(0), leg(1, ...OPENS), middle(2), leg(3, ...GAINS)])

    // The legs sit two apart, and the window counts the same distance `scan` counts.
    expect(shapedPairs(bundle, PAIR, { window: 1 })).toEqual([])
    expect(shapedPairs(bundle, PAIR, { window: 2 })).toHaveLength(1)
  })

  it('yields one row per pair, whichever mint it reversed most of', () => {
    const bundle = bundleOf([tx(0), leg(1, ...OPENS), middle(2), leg(3, ...GAINS)])

    expect(shapedPairs(bundle, [...PAIR, ...PAIR])).toHaveLength(2)
    expect(shapedPairs(bundle, PAIR)).toHaveLength(1)
  })
})
