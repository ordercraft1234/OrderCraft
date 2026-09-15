import type { NormalizedTransaction, SlotBundle } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { type LegPair, groupByLegs, renderPair } from '../src/review.ts'
import type { Candidate } from '../src/scan.ts'

const POOL = 'CbjY8Wohs2EnLLjSNMPkFrn9iaPvVJJtAdJiWRYeeN2x'
const ATTACKER = '7QmXo9tXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const VICTIM = 'Ka91rW7dWD4BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const WSOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const AMM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

const tx = (
  index: number,
  signer: string,
  tokenDelta: { owner: string; mint: string; amount: bigint }[] = [],
): NormalizedTransaction => ({
  index,
  signature: `sig${index}`.padEnd(44, 'x'),
  signers: [signer],
  programs: [AMM],
  accounts: [signer, POOL, AMM],
  fee: 5000n,
  failed: false,
  computeUnits: 1000n,
  lamportDelta: {},
  tokenDelta,
})

const bundle = (transactions: NormalizedTransaction[]): SlotBundle => ({
  schemaVersion: 1,
  slot: 445608326,
  blockTime: 0,
  transactions,
})

const candidate: Candidate = {
  slot: 445608326,
  positions: [0, 1, 2],
  signer: ATTACKER,
  sharedAccounts: [POOL],
}

/** The pair a shortlist row of the shape above becomes. */
const pair = groupByLegs([candidate])[0] as LegPair

const render = (slot: SlotBundle): string => renderPair(slot, pair)

/** A round trip: the pair buys USDC with wSOL, then sells it back for more wSOL. */
const roundTrip = bundle([
  tx(0, ATTACKER, [
    { owner: ATTACKER, mint: USDC, amount: 500n },
    { owner: ATTACKER, mint: WSOL, amount: -5n },
  ]),
  tx(1, VICTIM, [{ owner: VICTIM, mint: USDC, amount: -200n }]),
  tx(2, ATTACKER, [
    { owner: ATTACKER, mint: USDC, amount: -500n },
    { owner: ATTACKER, mint: WSOL, amount: 7n },
  ]),
])

/**
 * The line for one mint in the `net` block. The same mint also appears on the legs' own
 * movement lines above it, and a search over the whole screen finds those first.
 */
function netLine(text: string, mint: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.startsWith('net'))

  return lines.slice(start).find((line) => line.includes(mint)) ?? ''
}

describe('renderPair', () => {
  it('puts the three transactions and their movements on one screen', () => {
    const text = render(roundTrip)

    expect(text).toContain('slot 445608326')
    expect(text).toContain('positions 0, 1, 2')
    expect(text).toContain('span 2')
    expect(text.match(/leg {2}#/g)).toHaveLength(2)
    expect(text).toContain('mid  #')
  })

  /** The pair's position is the number the reviewer is actually weighing. */
  it('nets the outer pair per mint, so a round trip is visible as one line', () => {
    const text = render(roundTrip)

    expect(text).toContain('net   the shared signer across both legs, by mint')
    // USDC in and straight back out; wSOL is what the pair kept.
    expect(text).toMatch(/\+?0 EPjFWd…Dt1v/)
    expect(text).toMatch(/\+2 So1111…1112/)
  })

  /**
   * `tokenDelta` carries both ends of every transfer, so a transaction summed whole is
   * always zero. Netting the pair that way printed a column of noughts for every real
   * candidate — technically correct and completely uninformative.
   */
  it('nets the shared signer only, not the counterparty side of the same trade', () => {
    const POOL_OWNER = 'DLYGQnGrLLYK5cJcXAqfAqZkbcnZWvbmyLQqHnvVa3tH'
    const bothSides = bundle([
      tx(0, ATTACKER, [
        { owner: ATTACKER, mint: WSOL, amount: -100n },
        { owner: POOL_OWNER, mint: WSOL, amount: 100n },
      ]),
      tx(1, VICTIM, [{ owner: VICTIM, mint: USDC, amount: -200n }]),
      tx(2, ATTACKER, [
        { owner: ATTACKER, mint: WSOL, amount: 130n },
        { owner: POOL_OWNER, mint: WSOL, amount: -130n },
      ]),
    ])

    expect(netLine(render(bothSides), 'So1111…1112')).toContain('+30')
  })

  it('names which transaction in between also moved the mint', () => {
    const usdcLine = netLine(render(roundTrip), 'EPjFWd…Dt1v')

    expect(usdcLine).toContain('also moved by #1')
  })

  it('does not mark a mint nothing in between touched', () => {
    const wsolLine = netLine(render(roundTrip), 'So1111…1112')

    expect(wsolLine).not.toContain('also moved by')
  })

  /**
   * The reviewer's answer has to be independent of the detector's, or SC-003 measures
   * agreement instead of accuracy. Nothing here may resemble a verdict.
   */
  it('offers no opinion on whether the triple is an attack', () => {
    const text = render(roundTrip).toLowerCase()

    for (const word of ['sandwich', 'attack', 'victim', 'detected', 'likely', 'suspicious']) {
      expect(text).not.toContain(word)
    }
  })

  it('says so when a transaction moved nothing at all', () => {
    const quiet = bundle([tx(0, ATTACKER), tx(1, VICTIM), tx(2, ATTACKER)])

    expect(render(quiet)).toContain('(nothing moved)')
  })

  /**
   * The defect this pins, found on 2026-09-10 when seven blind reviewers rejected all
   * nine of the detector's triples: the screen printed `tokenDelta` and nothing else, so
   * on a swap settling in native SOL the reviewer saw the size and never the proceeds.
   * Every rejection argued "this round trip lost money" — about a pair that on
   * 445553238 #394/397 ends **+736,315,196 lamports**, the very figure T026 recorded.
   */
  it('shows native SOL, which carries the price on most swaps', () => {
    const nativeSide = bundle([
      {
        ...tx(0, ATTACKER, [{ owner: ATTACKER, mint: USDC, amount: 500n }]),
        lamportDelta: { [ATTACKER]: -5_000_000n },
      },
      { ...tx(1, VICTIM, [{ owner: VICTIM, mint: USDC, amount: -200n }]) },
      {
        ...tx(2, ATTACKER, [{ owner: ATTACKER, mint: USDC, amount: -500n }]),
        lamportDelta: { [ATTACKER]: 7_000_000n },
      },
    ])
    const text = render(nativeSide)

    expect(text).toContain('-5000000 SOL (native)')
    expect(text).toContain('+7000000 SOL (native)')
    // The round trip nets positive in lamports even though the token column closes flat.
    expect(netLine(text, 'SOL (native)')).toContain('+2000000')
  })

  it('counts only the shared signer’s own lamports, not the pool’s', () => {
    const withCounterparty = bundle([
      {
        ...tx(0, ATTACKER, [{ owner: ATTACKER, mint: USDC, amount: 500n }]),
        lamportDelta: { [ATTACKER]: -5_000_000n, [POOL]: 5_000_000n },
      },
      tx(1, VICTIM, [{ owner: VICTIM, mint: USDC, amount: -200n }]),
      {
        ...tx(2, ATTACKER, [{ owner: ATTACKER, mint: USDC, amount: -500n }]),
        lamportDelta: { [ATTACKER]: 7_000_000n, [POOL]: -7_000_000n },
      },
    ])

    expect(netLine(render(withCounterparty), 'SOL (native)')).toContain('+2000000')
  })

  it('marks a transaction in between that moved native SOL', () => {
    const middleMoves = bundle([
      { ...tx(0, ATTACKER), lamportDelta: { [ATTACKER]: -5_000_000n } },
      { ...tx(1, VICTIM), lamportDelta: { [VICTIM]: -200n } },
      { ...tx(2, ATTACKER), lamportDelta: { [ATTACKER]: 7_000_000n } },
    ])

    expect(netLine(render(middleMoves), 'SOL (native)')).toContain('← also moved by #1')
  })

  it('marks a failed transaction rather than hiding it', () => {
    const withFailure = bundle([
      tx(0, ATTACKER, [{ owner: ATTACKER, mint: USDC, amount: 500n }]),
      { ...tx(1, VICTIM), failed: true },
      tx(2, ATTACKER, [{ owner: ATTACKER, mint: USDC, amount: -500n }]),
    ])

    expect(render(withFailure)).toContain('FAILED')
  })

  /** A shortlist can outlive the slot files it names; that has to read as a problem. */
  it('reports a candidate whose slot no longer holds all three', () => {
    const short = bundle([tx(0, ATTACKER), tx(1, VICTIM)])

    expect(render(short)).toContain('does not hold all three')
  })

  /**
   * The reason the unit is the pair. `scan` emits a row per transaction between the
   * legs, and all of them describe one trade by one signer — reviewing them separately
   * asks the same question twice and records one answer.
   */
  it('puts everything between the same legs on one screen', () => {
    const two = groupByLegs([
      candidate,
      { ...candidate, positions: [0, 1, 3] },
      { ...candidate, positions: [0, 2, 3] },
    ])
    const slot = bundle([
      tx(0, ATTACKER, [{ owner: ATTACKER, mint: USDC, amount: 500n }]),
      tx(1, VICTIM, [{ owner: VICTIM, mint: USDC, amount: -200n }]),
      tx(2, VICTIM, [{ owner: VICTIM, mint: WSOL, amount: -9n }]),
      tx(3, ATTACKER, [{ owner: ATTACKER, mint: USDC, amount: -500n }]),
    ])

    const text = renderPair(slot, two[1] as LegPair)
    expect(two).toHaveLength(2)
    expect(text.match(/mid {2}#/g)).toHaveLength(2)
    expect(text).toContain('positions 0, 1, 2, 3')
  })

  /**
   * With several transactions between the legs, "something in between moved this mint"
   * is not enough — the label records which one was traded against.
   */
  it('tells apart which of several transactions moved the mint', () => {
    const [only] = groupByLegs([
      { ...candidate, positions: [0, 1, 3] },
      { ...candidate, positions: [0, 2, 3] },
    ])
    const slot = bundle([
      tx(0, ATTACKER, [{ owner: ATTACKER, mint: USDC, amount: 500n }]),
      tx(1, VICTIM, [{ owner: VICTIM, mint: WSOL, amount: -9n }]),
      tx(2, VICTIM, [{ owner: VICTIM, mint: USDC, amount: -200n }]),
      tx(3, ATTACKER, [{ owner: ATTACKER, mint: USDC, amount: -500n }]),
    ])

    const usdcLine = netLine(renderPair(slot, only as LegPair), 'EPjFWd…Dt1v')
    expect(usdcLine).toContain('also moved by #2')
    expect(usdcLine).not.toContain('#1')
  })

  it('keeps pairs from different slots apart even at the same positions', () => {
    const pairs = groupByLegs([candidate, { ...candidate, slot: 445553238 }])

    expect(pairs).toHaveLength(2)
  })

  /** Generated input is the kind that repeats itself. */
  it('does not print the same transaction twice when a row is repeated', () => {
    const [only] = groupByLegs([candidate, { ...candidate }])

    expect((only as LegPair).between).toHaveLength(1)
  })
})
