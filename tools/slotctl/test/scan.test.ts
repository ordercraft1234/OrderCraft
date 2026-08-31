import type { NormalizedTransaction, SlotBundle } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { findCandidates } from '../src/scan.ts'

const POOL = 'CbjY8Wohs2EnLLjSNMPkFrn9iaPvVJJtAdJiWRYeeN2x'
const ATTACKER = '7QmXo9tXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const VICTIM = 'Ka91rW7dWD4BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const STRANGER = '9wTbXo4RxHqLmYtV2pNz8CkDdFgUj1sAeQ7vMhKcRnBu'
const AMM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const VOTE = 'Vote111111111111111111111111111111111111111'

const tx = (
  index: number,
  signer: string,
  accounts: string[],
  programs: string[] = [AMM],
): NormalizedTransaction => ({
  index,
  signature: `sig${index}`.padEnd(44, 'x'),
  signers: [signer],
  programs,
  accounts: [signer, ...accounts, ...programs],
  fee: 5000n,
  failed: false,
  computeUnits: 1000n,
  lamportDelta: {},
  tokenDelta: [],
})

const bundle = (transactions: NormalizedTransaction[]): SlotBundle => ({
  schemaVersion: 1,
  slot: 100,
  blockTime: 0,
  transactions,
})

describe('findCandidates', () => {
  it('finds a pair by one signer around a third transaction on a shared account', () => {
    const found = findCandidates(
      bundle([
        tx(0, ATTACKER, [POOL]),
        tx(1, VICTIM, [POOL]),
        tx(2, ATTACKER, [POOL]),
      ]),
    )

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      slot: 100,
      positions: [0, 1, 2],
      signer: ATTACKER,
      sharedAccounts: [POOL],
    })
  })

  it('does not require adjacency, only closeness', () => {
    const found = findCandidates(
      bundle([
        tx(0, ATTACKER, [POOL]),
        tx(1, STRANGER, [POOL]),
        tx(2, VICTIM, [POOL]),
        tx(3, ATTACKER, [POOL]),
      ]),
    )

    expect(found.map((c) => c.positions)).toEqual([
      [0, 1, 3],
      [0, 2, 3],
    ])
  })

  it('ignores a pair whose middle transaction touches nothing of theirs', () => {
    const other = 'D1ffPoo1LmYtV2pNz8CkDdFgUj1sAeQ7vMhKcRnBu123'
    const found = findCandidates(
      bundle([tx(0, ATTACKER, [POOL]), tx(1, VICTIM, [other]), tx(2, ATTACKER, [POOL])]),
    )

    expect(found).toEqual([])
  })

  it('does not count a program as a shared account', () => {
    const found = findCandidates(
      bundle([tx(0, ATTACKER, []), tx(1, VICTIM, []), tx(2, ATTACKER, [])]),
    )

    expect(found).toEqual([])
  })

  it('ignores a middle transaction signed by the same party — that is one actor, not a victim', () => {
    const found = findCandidates(
      bundle([tx(0, ATTACKER, [POOL]), tx(1, ATTACKER, [POOL]), tx(2, ATTACKER, [POOL])]),
    )

    expect(found).toEqual([])
  })

  it('skips vote transactions, which fill the block and can extract nothing', () => {
    const found = findCandidates(
      bundle([
        tx(0, ATTACKER, [POOL]),
        tx(1, STRANGER, [POOL], [VOTE]),
        tx(2, ATTACKER, [POOL]),
      ]),
    )

    expect(found).toEqual([])
  })

  it('respects the window', () => {
    const far = bundle([
      tx(0, ATTACKER, [POOL]),
      tx(1, VICTIM, [POOL]),
      tx(2, STRANGER, [POOL]),
      tx(3, STRANGER, [POOL]),
      tx(4, STRANGER, [POOL]),
      tx(5, ATTACKER, [POOL]),
    ])

    expect(findCandidates(far, { window: 3 })).toEqual([])
    expect(findCandidates(far, { window: 5 }).length).toBeGreaterThan(0)
  })

  it('is deliberately wider than a sandwich detector: direction and profit are not checked', () => {
    // Both outer transactions buy; nothing here is profitable. A detector would
    // reject it, the shortlist keeps it, and a person decides.
    const found = findCandidates(
      bundle([
        tx(0, ATTACKER, [POOL]),
        tx(1, VICTIM, [POOL]),
        tx(2, ATTACKER, [POOL]),
      ]),
    )

    expect(found).toHaveLength(1)
  })
})
