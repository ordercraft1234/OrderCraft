import { describe, expect, it } from 'vitest'
import { findSandwiches } from '../src/detect/sandwich.ts'
import { ATTACKER, MINT, OTHER_SIGNER, POOL, QUOTE, VICTIM, bundleOf, tx } from './helpers/build.ts'

/** A leg of the attacker's own trade: what its wallet gained or lost in the quote asset. */
function leg(index: number, quote: bigint) {
  return tx(index, {
    signers: [ATTACKER],
    tokenDelta: [
      { owner: ATTACKER, mint: QUOTE, amount: quote },
      { owner: POOL, mint: QUOTE, amount: -quote },
    ],
  })
}

function victim(index: number, accounts: string[] = [VICTIM, POOL]) {
  return tx(index, {
    signers: [VICTIM],
    accounts,
    tokenDelta: [
      { owner: VICTIM, mint: MINT, amount: 500n },
      { owner: POOL, mint: MINT, amount: -500n },
    ],
  })
}

describe('findSandwiches', () => {
  it('finds the party on both sides of somebody else', () => {
    const found = findSandwiches(bundleOf([leg(0, -1000n), victim(1), leg(2, 1200n)]))

    expect(found).toStrictEqual([
      { front: 0, victims: [1], back: 2, signer: ATTACKER, mint: QUOTE, shared: [POOL] },
    ])
  })

  it('keeps every transaction caught between the pair', () => {
    const found = findSandwiches(
      bundleOf([leg(0, -1000n), victim(1), victim(2), victim(3), leg(4, 1200n)]),
    )

    expect(found.map((sandwich) => sandwich.victims)).toStrictEqual([[1, 2, 3]])
  })

  /**
   * Up to 40 % of what the wide filter offers is a pair of failed bot attempts around
   * somebody else's transaction. A transaction that failed moved no balance, so there
   * is nothing for it to have extracted.
   */
  it('ignores a triple where any leg failed', () => {
    const failedFront = { ...leg(0, -1000n), failed: true }

    expect(findSandwiches(bundleOf([failedFront, victim(1), leg(2, 1200n)]))).toStrictEqual([])
  })

  it('needs the outer legs to trade in opposite directions', () => {
    expect(findSandwiches(bundleOf([leg(0, -1000n), victim(1), leg(2, -1200n)]))).toStrictEqual([])
  })

  /**
   * The reversal is read on the mint the attacker holds itself. A pool vault reverses
   * around every trade it settles, so a detector that looked at any owner would call
   * every swap in the block an attack.
   */
  it('reads the reversal on the signer own balances, not the pool', () => {
    const front = tx(0, {
      signers: [ATTACKER],
      tokenDelta: [{ owner: POOL, mint: QUOTE, amount: -1000n }],
    })
    const back = tx(2, {
      signers: [ATTACKER],
      tokenDelta: [{ owner: POOL, mint: QUOTE, amount: 1200n }],
    })

    expect(findSandwiches(bundleOf([front, victim(1), back]))).toStrictEqual([])
  })

  it('needs somebody else in the middle', () => {
    const own = tx(1, { signers: [ATTACKER], accounts: [ATTACKER, POOL] })

    expect(findSandwiches(bundleOf([leg(0, -1000n), own, leg(2, 1200n)]))).toStrictEqual([])
  })

  it('needs the middle transaction on the same pool', () => {
    const elsewhere = victim(1, [VICTIM, OTHER_SIGNER])

    expect(findSandwiches(bundleOf([leg(0, -1000n), elsewhere, leg(2, 1200n)]))).toStrictEqual([])
  })

  it('does not reach past the window', () => {
    const spread = [leg(0, -1000n), victim(1), victim(2), victim(3), victim(4), leg(5, 1200n)]

    expect(findSandwiches(bundleOf(spread))).toStrictEqual([])
    expect(findSandwiches(bundleOf(spread), { window: 5 })).toHaveLength(1)
  })

  /**
   * One attack, not four. The same front with three possible backs is the same pair of
   * legs seen at different distances, and a list that showed all of them would report
   * an attack count nobody could reconcile with the block.
   */
  it('reports the nearest back for a front, not every back', () => {
    const found = findSandwiches(
      bundleOf([leg(0, -1000n), victim(1), leg(2, 1200n), victim(3), leg(4, 900n)]),
    )

    expect(found.map((sandwich) => [sandwich.front, sandwich.back])).toStrictEqual([[0, 2]])
  })

  it('returns the same list whatever order the block is scanned in', () => {
    const bundle = bundleOf([leg(0, -1000n), victim(1), leg(2, 1200n), victim(3), leg(4, -900n)])
    const first = findSandwiches(bundle)

    for (let repeat = 0; repeat < 20; repeat++) {
      expect(findSandwiches(bundle)).toStrictEqual(first)
    }
  })
})
