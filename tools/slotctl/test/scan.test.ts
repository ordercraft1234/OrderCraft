import type { NormalizedTransaction, SlotBundle } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { findCandidates, sampleSlots } from '../src/scan.ts'

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
      bundle([tx(0, ATTACKER, [POOL]), tx(1, VICTIM, [POOL]), tx(2, ATTACKER, [POOL])]),
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
      bundle([tx(0, ATTACKER, [POOL]), tx(1, STRANGER, [POOL], [VOTE]), tx(2, ATTACKER, [POOL])]),
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
      bundle([tx(0, ATTACKER, [POOL]), tx(1, VICTIM, [POOL]), tx(2, ATTACKER, [POOL])]),
    )

    expect(found).toHaveLength(1)
  })
})

describe('sampleSlots', () => {
  const slots = Array.from({ length: 40 }, (_, at) => 441394000 + at)

  it('draws the same slots for the same seed', () => {
    expect(sampleSlots(slots, 5, 7)).toEqual(sampleSlots(slots, 5, 7))
  })

  it('draws different slots for a different seed', () => {
    expect(sampleSlots(slots, 5, 7)).not.toEqual(sampleSlots(slots, 5, 8))
  })

  it('does not depend on the order the directory was read in', () => {
    expect(sampleSlots([...slots].reverse(), 5, 7)).toEqual(sampleSlots(slots, 5, 7))
  })

  it('draws from the whole pool, not the head of it', () => {
    // The old --random took the first k. A sample that never reaches the tail is
    // a sample of the filesystem, not of the slots.
    const seen = new Set(
      Array.from({ length: 20 }, (_, seed) => sampleSlots(slots, 5, seed)).flat(),
    )
    const tail = slots.slice(-10)

    expect(tail.some((slot) => seen.has(slot))).toBe(true)
  })

  it('returns distinct slots in slot order', () => {
    const drawn = sampleSlots(slots, 8, 3)

    expect(new Set(drawn).size).toBe(8)
    expect(drawn).toEqual([...drawn].sort((left, right) => left - right))
  })

  it('never draws more than the pool holds', () => {
    expect(sampleSlots([1, 2, 3], 10, 1)).toEqual([1, 2, 3])
    expect(sampleSlots([], 5, 1)).toEqual([])
    expect(sampleSlots(slots, 0, 1)).toEqual([])
  })

  it('ignores duplicates in the pool', () => {
    expect(sampleSlots([1, 1, 2, 2, 3], 3, 1)).toEqual([1, 2, 3])
  })
})
