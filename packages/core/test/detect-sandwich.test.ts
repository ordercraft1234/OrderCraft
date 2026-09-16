import { describe, expect, it } from 'vitest'
import { findSandwiches } from '../src/detect/sandwich.ts'
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

/**
 * A leg of the attacker's own trade.
 *
 * `quote` is what its wallet gained or lost in the quote asset; `token` is what the pool
 * moved the other way, and the two together are the price this leg executed at. The
 * attacker's own token balance is deliberately absent: a bot parks its inventory in an
 * account owned by its own program, so the reversal is visible on the quote side alone.
 */
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

/** Pays 1,000 quote, takes 5,000 token out of the pool: 5 token per quote. */
const OPENS = [-1000n, -5000n] as const
/** Takes 1,100 quote back for the same 5,000 token: 4.55 token per quote, a profit. */
const CLOSES = [1100n, 5000n] as const

/**
 * Somebody buying the token off the pool with the quote asset — both sides of the trade,
 * because that is what makes them a victim rather than a bystander who happened to be
 * recorded in between.
 */
function victim(index: number, pool: string = POOL, quote = -300n) {
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

/** The same trade the other way round: selling the token back to the pool for quote. */
function seller(index: number, pool: string = POOL) {
  return victim(index, pool, 300n)
}

describe('findSandwiches', () => {
  it('finds the party on both sides of somebody else', () => {
    const found = findSandwiches(bundleOf([leg(0, ...OPENS), victim(1), leg(2, ...CLOSES)]))

    expect(found).toStrictEqual([
      { front: 0, victims: [1], back: 2, signer: ATTACKER, mint: QUOTE, pool: POOL },
    ])
  })

  it('keeps every transaction caught between the pair', () => {
    const found = findSandwiches(
      bundleOf([leg(0, ...OPENS), victim(1), victim(2), victim(3), leg(4, ...CLOSES)]),
    )

    expect(found.map((sandwich) => sandwich.victims)).toStrictEqual([[1, 2, 3]])
  })

  /**
   * Up to 40 % of what the wide filter offers is a pair of failed bot attempts around
   * somebody else's transaction. A transaction that failed moved no balance, so there
   * is nothing for it to have extracted.
   */
  it('ignores a triple where any leg failed', () => {
    const failedFront = { ...leg(0, ...OPENS), failed: true }

    expect(findSandwiches(bundleOf([failedFront, victim(1), leg(2, ...CLOSES)]))).toStrictEqual([])
  })

  it('needs the outer legs to trade in opposite directions', () => {
    expect(
      findSandwiches(bundleOf([leg(0, ...OPENS), victim(1), leg(2, -1100n, -5000n)])),
    ).toStrictEqual([])
  })

  /**
   * The reversal is read on the mint the attacker holds itself. A pool vault reverses
   * around every trade it settles, so a detector that looked at any owner would call
   * every swap in the block an attack.
   */
  it('reads the reversal on the signer own balances, not the pool', () => {
    const front = tx(0, {
      signers: [ATTACKER],
      tokenDelta: [{ owner: POOL, mint: QUOTE, amount: 1000n }],
    })
    const back = tx(2, {
      signers: [ATTACKER],
      tokenDelta: [{ owner: POOL, mint: QUOTE, amount: -1100n }],
    })

    expect(findSandwiches(bundleOf([front, victim(1), back]))).toStrictEqual([])
  })

  it('needs somebody else in the middle', () => {
    const own = tx(1, { signers: [ATTACKER], accounts: [ATTACKER, POOL] })

    expect(findSandwiches(bundleOf([leg(0, ...OPENS), own, leg(2, ...CLOSES)]))).toStrictEqual([])
  })

  /**
   * Selling the quote asset at one venue and buying it back at another reverses the
   * signer's own balance exactly the way a sandwich does, so direction alone cannot tell
   * them apart. Measured over 171 recorded slots, this shape was **9 of 18** triples the
   * earlier rule returned, including both triples in the slot the repository ships.
   */
  it('rejects a round trip closed at a different pool', () => {
    const arbitrage = [leg(0, ...OPENS), victim(1), leg(2, ...CLOSES, OTHER_POOL)]

    expect(findSandwiches(bundleOf(arbitrage))).toStrictEqual([])
  })

  it('needs the middle transaction on the same pool', () => {
    const elsewhere = victim(1, OTHER_POOL)

    expect(
      findSandwiches(bundleOf([leg(0, ...OPENS), elsewhere, leg(2, ...CLOSES)])),
    ).toStrictEqual([])
  })

  /**
   * Sharing an account is not evidence of anything: tip vaults, fee accounts and shared
   * token accounts are named by transactions that have nothing to do with each other.
   * This bystander lists the pool among its accounts and moves no balance through it.
   */
  it('ignores a bystander that only names the pool', () => {
    const bystander = tx(1, {
      signers: [OTHER_SIGNER],
      accounts: [OTHER_SIGNER, POOL],
      tokenDelta: [
        { owner: OTHER_SIGNER, mint: MINT, amount: -700n },
        { owner: OTHER_POOL, mint: MINT, amount: 700n },
      ],
    })

    expect(
      findSandwiches(bundleOf([leg(0, ...OPENS), bystander, leg(2, ...CLOSES)])),
    ).toStrictEqual([])
  })

  /**
   * T055, the first of three things the shape does not say. Front-running a seller with a
   * buy is the same shape and the opposite trade: their sale moves the price down and the
   * closing leg sells into it. Every triple of this form that was labelled had lost money,
   * `445660284 #487/490` among them.
   */
  it('rejects a middle that traded the other way from the opening leg', () => {
    const backwards = [leg(0, ...OPENS), seller(1), leg(2, ...CLOSES)]

    expect(findSandwiches(bundleOf(backwards))).toStrictEqual([])
  })

  it('keeps only the transactions that traded the way the opening leg did', () => {
    const mixed = [leg(0, ...OPENS), seller(1), victim(2), seller(3), leg(4, ...CLOSES)]

    expect(findSandwiches(bundleOf(mixed)).map((sandwich) => sandwich.victims)).toStrictEqual([[2]])
  })

  /**
   * T055, the second. Closing worse than it opened satisfied every structural test the
   * rule had, and seven of the nine labelled triples were exactly that — including
   * `445829304 #149/153`, which sold at 0.0039505 and bought back at 0.0039663.
   */
  it('rejects a round trip that closed at a worse price than it opened', () => {
    const losing = [leg(0, ...OPENS), victim(1), leg(2, 1100n, 6000n)]

    expect(findSandwiches(bundleOf(losing))).toStrictEqual([])
  })

  /**
   * The case T055 warns about, and the reason price is read at the pool. This pair ends
   * 400 quote up — it sold 1,000 more token than it bought back — while both legs
   * executed at a worse price than the one before. `445553238 #394/397` is the measured
   * instance: +736,315,196 lamports, and a market maker underneath it.
   */
  it('rejects a losing round trip that still ended up holding more quote', () => {
    const marketMaker = [leg(0, -1000n, -5000n), victim(1), leg(2, 1400n, 8000n)]
    const wallet = marketMaker
      .flatMap((transaction) => transaction.tokenDelta)
      .filter((delta) => delta.owner === ATTACKER && delta.mint === QUOTE)
      .reduce((total, delta) => total + delta.amount, 0n)

    expect(wallet).toBeGreaterThan(0n)
    expect(findSandwiches(bundleOf(marketMaker))).toStrictEqual([])
  })

  /**
   * A pool that settles against native SOL moves it in `lamportDelta`, not as a mint, and
   * the price has to be read there or every such triple becomes unreadable. This pair
   * bought 5,000 token for 1,000,000 lamports and sold them back for 1,200,000.
   */
  it('reads the price at a pool that settles in native SOL', () => {
    const native = (index: number, token: bigint, lamports: bigint) =>
      tx(index, {
        signers: [ATTACKER],
        lamportDelta: { [ATTACKER]: -lamports, [POOL]: lamports },
        tokenDelta: [
          { owner: ATTACKER, mint: MINT, amount: token },
          { owner: POOL, mint: MINT, amount: -token },
        ],
      })
    const buyer = tx(1, {
      signers: [VICTIM],
      accounts: [VICTIM, POOL],
      lamportDelta: { [VICTIM]: -300000n, [POOL]: 300000n },
      tokenDelta: [
        { owner: VICTIM, mint: MINT, amount: 1000n },
        { owner: POOL, mint: MINT, amount: -1000n },
      ],
    })

    const found = findSandwiches(
      bundleOf([native(0, 5000n, 1000000n), buyer, native(2, -5000n, -1200000n)]),
    )

    expect(found.map((sandwich) => [sandwich.front, sandwich.back])).toStrictEqual([[0, 2]])
  })

  it('rejects a leg whose price cannot be read at the pool', () => {
    const priceless = tx(2, {
      signers: [ATTACKER],
      tokenDelta: [
        { owner: ATTACKER, mint: QUOTE, amount: 1100n },
        { owner: POOL, mint: QUOTE, amount: -1100n },
      ],
    })

    expect(findSandwiches(bundleOf([leg(0, ...OPENS), victim(1), priceless]))).toStrictEqual([])
  })

  /**
   * T055, the third. `445553238 #339/342` opened with 4.006 billion tokens and bought back
   * 30.6 million of them — 0.76 % — which is a sale with a small purchase after it, not a
   * position that was closed.
   */
  it('rejects legs that do not match in size', () => {
    const unmatched = [leg(0, ...OPENS), victim(1), leg(2, 8n, 36n)]

    expect(findSandwiches(bundleOf(unmatched))).toStrictEqual([])
  })

  it('takes legs that match to within a fifth', () => {
    const matched = [leg(0, ...OPENS), victim(1), leg(2, 800n, 3500n)]

    expect(findSandwiches(bundleOf(matched))).toHaveLength(1)
    expect(
      findSandwiches(bundleOf([leg(0, ...OPENS), victim(1), leg(2, 799n, 3500n)])),
    ).toStrictEqual([])
  })

  it('does not reach past the window', () => {
    const spread = [leg(0, ...OPENS), victim(1), victim(2), victim(3), victim(4), leg(5, ...CLOSES)]

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
      bundleOf([leg(0, ...OPENS), victim(1), leg(2, ...CLOSES), victim(3), leg(4, 900n, 4000n)]),
    )

    expect(found.map((sandwich) => [sandwich.front, sandwich.back])).toStrictEqual([[0, 2]])
  })

  it('returns the same list whatever order the block is scanned in', () => {
    const bundle = bundleOf([
      leg(0, ...OPENS),
      victim(1),
      leg(2, ...CLOSES),
      victim(3),
      leg(4, -900n, -4000n),
    ])
    const first = findSandwiches(bundle)

    for (let repeat = 0; repeat < 20; repeat++) {
      expect(findSandwiches(bundle)).toStrictEqual(first)
    }
  })
})
