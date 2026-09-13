import type { NormalizedTransaction, SlotBundle } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { renderCandidate } from '../src/review.ts'
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

describe('renderCandidate', () => {
  it('puts the three transactions and their movements on one screen', () => {
    const text = renderCandidate(roundTrip, candidate)

    expect(text).toContain('slot 445608326')
    expect(text).toContain('positions 0, 1, 2')
    expect(text).toContain('span 2')
    expect(text.match(/leg {2}#/g)).toHaveLength(2)
    expect(text).toContain('mid  #')
  })

  /** The pair's position is the number the reviewer is actually weighing. */
  it('nets the outer pair per mint, so a round trip is visible as one line', () => {
    const text = renderCandidate(roundTrip, candidate)

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

    expect(netLine(renderCandidate(bothSides, candidate), 'So1111…1112')).toContain('+30')
  })

  it('marks the mint the middle transaction also moved', () => {
    const usdcLine = netLine(renderCandidate(roundTrip, candidate), 'EPjFWd…Dt1v')

    expect(usdcLine).toContain('the middle moved this mint too')
  })

  it('does not mark a mint the middle transaction left alone', () => {
    const wsolLine = netLine(renderCandidate(roundTrip, candidate), 'So1111…1112')

    expect(wsolLine).not.toContain('the middle moved this mint too')
  })

  /**
   * The reviewer's answer has to be independent of the detector's, or SC-003 measures
   * agreement instead of accuracy. Nothing here may resemble a verdict.
   */
  it('offers no opinion on whether the triple is an attack', () => {
    const text = renderCandidate(roundTrip, candidate).toLowerCase()

    for (const word of ['sandwich', 'attack', 'victim', 'detected', 'likely', 'suspicious']) {
      expect(text).not.toContain(word)
    }
  })

  it('says so when a transaction moved no tokens', () => {
    const quiet = bundle([tx(0, ATTACKER), tx(1, VICTIM), tx(2, ATTACKER)])

    expect(renderCandidate(quiet, candidate)).toContain('(no token movement)')
  })

  it('marks a failed transaction rather than hiding it', () => {
    const withFailure = bundle([
      tx(0, ATTACKER, [{ owner: ATTACKER, mint: USDC, amount: 500n }]),
      { ...tx(1, VICTIM), failed: true },
      tx(2, ATTACKER, [{ owner: ATTACKER, mint: USDC, amount: -500n }]),
    ])

    expect(renderCandidate(withFailure, candidate)).toContain('FAILED')
  })

  /** A shortlist can outlive the slot files it names; that has to read as a problem. */
  it('reports a candidate whose slot no longer holds all three', () => {
    const short = bundle([tx(0, ATTACKER), tx(1, VICTIM)])

    expect(renderCandidate(short, candidate)).toContain('does not hold all three')
  })
})
