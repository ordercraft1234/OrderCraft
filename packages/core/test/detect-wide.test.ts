import { describe, expect, it } from 'vitest'
import { findSandwiches } from '../src/detect/sandwich.ts'
import { type WidePair, screenPairs } from '../src/detect/wide.ts'
import {
  ATTACKER,
  MINT,
  OTHER_POOL,
  OTHER_SIGNER,
  POOL,
  QUOTE,
  VICTIM,
  bundleOf,
  tx,
} from './helpers/build.ts'

/** A leg of the round trip, priced at the pool exactly as `detect-sandwich` prices one. */
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

/** Pays 1,000 quote for 5,000 token; takes 1,100 back for the same 5,000 — a profit. */
const OPENS = [-1000n, -5000n] as const
const CLOSES = [1100n, 5000n] as const
/** The same round trip the other way: closes worse than it opened. */
const LOSES = [900n, 5000n] as const

function middle(index: number, pool: string = POOL, quote = -300n) {
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

function pairOf(front: number, back: number, between: number[]): WidePair {
  return { front, back, signer: ATTACKER, between }
}

const PAIR = [pairOf(1, 3, [2])]

describe('screenPairs — the wider draw for a labelling set', () => {
  it('keeps a round trip that closed better than it opened', () => {
    const bundle = bundleOf([tx(0), leg(1, ...OPENS), middle(2), leg(3, ...CLOSES)])

    const [hit] = screenPairs(bundle, PAIR)

    expect(hit?.mint).toBe(QUOTE)
    expect(hit?.openPool).toBe(POOL)
    expect(hit?.samePool).toBe(true)
  })

  it('drops one that closed worse — the question is whether it paid, not whether it reversed', () => {
    const bundle = bundleOf([tx(0), leg(1, ...OPENS), middle(2), leg(3, ...LOSES)])

    expect(screenPairs(bundle, PAIR)).toEqual([])
  })

  /**
   * The property the whole task turns on. Requiring one pool is the narrowing that took
   * 3,759 cached pairs to 9; a set drawn with it could only ever contain what the rule
   * already agrees with.
   */
  it('keeps a profitable round trip that opened at one pool and closed at another', () => {
    const bundle = bundleOf([
      tx(0),
      leg(1, ...OPENS),
      middle(2),
      leg(3, CLOSES[0], CLOSES[1], OTHER_POOL),
    ])

    const [hit] = screenPairs(bundle, PAIR)

    expect(hit?.openPool).toBe(POOL)
    expect(hit?.closePool).toBe(OTHER_POOL)
    expect(hit?.samePool).toBe(false)
    // And the narrow rule, on the same block, says nothing at all.
    expect(findSandwiches(bundle)).toEqual([])
  })

  it('keeps legs of wildly different sizes — the size threshold was read off nine points', () => {
    const bundle = bundleOf([
      tx(0),
      leg(1, -4000n, -20000n),
      middle(2),
      // Half a per cent of the position, closed a tenth cheaper: 5 token per quote out,
      // 4.55 back. It paid, and the legs never matched — which the narrow rule refuses on.
      leg(3, 22n, 100n),
      tx(4),
    ])

    expect(screenPairs(bundle, PAIR)).toHaveLength(1)
    expect(findSandwiches(bundle)).toEqual([])
  })

  it('refuses when either leg has no readable price', () => {
    const blind = tx(3, {
      signers: [ATTACKER],
      tokenDelta: [
        { owner: ATTACKER, mint: QUOTE, amount: CLOSES[0] },
        { owner: POOL, mint: QUOTE, amount: -CLOSES[0] },
      ],
    })
    const bundle = bundleOf([tx(0), leg(1, ...OPENS), middle(2), blind])

    expect(screenPairs(bundle, PAIR)).toEqual([])
  })

  describe('the party in the middle is recorded, never filtered on', () => {
    it('marks one that traded the mint the same way the opening leg did', () => {
      const bundle = bundleOf([tx(0), leg(1, ...OPENS), middle(2), leg(3, ...CLOSES)])

      const [hit] = screenPairs(bundle, PAIR)

      expect(hit?.touched).toEqual([2])
      expect(hit?.aligned).toEqual([2])
    })

    it('keeps one that traded the other way, and says so', () => {
      const bundle = bundleOf([tx(0), leg(1, ...OPENS), middle(2, POOL, 300n), leg(3, ...CLOSES)])

      const [hit] = screenPairs(bundle, PAIR)

      expect(hit?.touched).toEqual([2])
      expect(hit?.aligned).toEqual([])
    })

    it('keeps one where nobody in between touched the mint at all', () => {
      const bundle = bundleOf([
        tx(0),
        leg(1, ...OPENS),
        tx(2, { signers: [OTHER_SIGNER] }),
        leg(3, ...CLOSES),
      ])

      const [hit] = screenPairs(bundle, PAIR)

      expect(hit?.touched).toEqual([])
      expect(hit?.aligned).toEqual([])
    })
  })

  it('reports one row per pair, the largest round trip of them', () => {
    const both = (index: number, quote: bigint, token: bigint, mint: bigint) =>
      tx(index, {
        signers: [ATTACKER],
        tokenDelta: [
          { owner: ATTACKER, mint: QUOTE, amount: quote },
          { owner: POOL, mint: QUOTE, amount: -quote },
          { owner: ATTACKER, mint: MINT, amount: mint },
          { owner: POOL, mint: MINT, amount: token },
        ],
      })
    const bundle = bundleOf([
      tx(0),
      both(1, -1000n, -5000n, 5000n),
      middle(2),
      both(3, 1100n, 5000n, -5000n),
    ])

    const hits = screenPairs(bundle, PAIR)

    expect(hits).toHaveLength(1)
    expect(hits[0]?.mint).toBe(MINT)
    expect(hits[0]?.size).toBe(5000n)
  })

  /**
   * With no shared pool to appeal to, each leg names its own venue, and "the party that
   * moved most of the mint the other way" is the whole of that reading. A router that
   * touched two pools would otherwise settle the price wherever the balances happened to
   * be recorded first.
   */
  it('reads each leg at the venue that moved most of the mint', () => {
    const split = tx(1, {
      signers: [ATTACKER],
      tokenDelta: [
        { owner: ATTACKER, mint: QUOTE, amount: -1000n },
        { owner: OTHER_POOL, mint: QUOTE, amount: 100n },
        { owner: OTHER_POOL, mint: MINT, amount: -200n },
        { owner: POOL, mint: QUOTE, amount: 900n },
        { owner: POOL, mint: MINT, amount: -5000n },
      ],
    })
    const bundle = bundleOf([tx(0), split, middle(2), leg(3, ...CLOSES)])

    const [hit] = screenPairs(bundle, PAIR)

    expect(hit?.openPool).toBe(POOL)
  })

  it('says nothing about a pair whose legs are not in the block', () => {
    const bundle = bundleOf([tx(0), leg(1, ...OPENS), middle(2), leg(3, ...CLOSES)])

    expect(screenPairs(bundle, [pairOf(1, 9, [2])])).toEqual([])
  })
})
