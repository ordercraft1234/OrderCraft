import type { NormalizedTransaction, SlotBundle } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { findCandidates, sampleSlots } from '../src/scan.ts'

const POOL = 'CbjY8Wohs2EnLLjSNMPkFrn9iaPvVJJtAdJiWRYeeN2x'
const ATTACKER = '7QmXo9tXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const VICTIM = 'Ka91rW7dWD4BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const STRANGER = '9wTbXo4RxHqLmYtV2pNz8CkDdFgUj1sAeQ7vMhKcRnBu'
const AMM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const DEX = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const VOTE = 'Vote111111111111111111111111111111111111111'
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/**
 * A transaction that traded. Movement is the default because the filter now requires
 * it: a transaction that moved nothing is a special case a few tests are *about*, not
 * the ordinary shape the rest of them assume.
 */
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
  tokenDelta: [{ owner: signer, mint: MINT, amount: 1n }],
})

/** The same transaction, but the block rejected it: no balance moved, nothing to judge. */
const failed = (transaction: NormalizedTransaction): NormalizedTransaction => ({
  ...transaction,
  failed: true,
})

/** The same transaction, but it handed nothing to anybody. */
const inert = (transaction: NormalizedTransaction): NormalizedTransaction => ({
  ...transaction,
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

  /**
   * A pair that neither bought nor sold cannot have taken anything from the transaction
   * between them. Just under half the shortlist was this: 804 of 1,617.
   */
  it('drops a triple whose outer pair moved no value to anybody', () => {
    const found = findCandidates(
      bundle([
        inert(tx(0, ATTACKER, [POOL])),
        tx(1, VICTIM, [POOL]),
        inert(tx(2, ATTACKER, [POOL])),
      ]),
    )

    expect(found).toEqual([])
  })

  /**
   * Native SOL is absent from tokenDelta, so an SPL-only check would throw away real
   * trades — 546 of the 1,350 cached candidates whose pair moved no token moved
   * lamports instead.
   */
  it('keeps a pair that moved lamports rather than tokens', () => {
    const paid = { ...inert(tx(0, ATTACKER, [POOL])), lamportDelta: { [POOL]: 1_000_000n } }
    const found = findCandidates(
      bundle([paid, tx(1, VICTIM, [POOL]), inert(tx(2, ATTACKER, [POOL]))]),
    )

    expect(found.map((c) => c.positions)).toEqual([[0, 1, 2]])
  })

  it('does not count the signer being charged a fee as having moved value', () => {
    const charged = { ...inert(tx(0, ATTACKER, [POOL])), lamportDelta: { [ATTACKER]: -5000n } }
    const found = findCandidates(
      bundle([charged, tx(1, VICTIM, [POOL]), inert(tx(2, ATTACKER, [POOL]))]),
    )

    expect(found).toEqual([])
  })

  it('keeps a pair when only one leg traded', () => {
    const found = findCandidates(
      bundle([inert(tx(0, ATTACKER, [POOL])), tx(1, VICTIM, [POOL]), tx(2, ATTACKER, [POOL])]),
    )

    expect(found.map((c) => c.positions)).toEqual([[0, 1, 2]])
  })

  it('returns inert pairs under includeInert', () => {
    const still = bundle([
      inert(tx(0, ATTACKER, [POOL])),
      tx(1, VICTIM, [POOL]),
      inert(tx(2, ATTACKER, [POOL])),
    ])

    expect(findCandidates(still, { includeInert: true })).toHaveLength(1)
  })

  /**
   * A sysvar is read, not invoked, so it never appears in `programs` and slipped past
   * the program check. On the cache this was 13.7% of the shortlist: two transactions
   * by one signer that had nothing whatever in common except the time of day.
   */
  it('does not count a sysvar as a shared account', () => {
    const CLOCK = 'SysvarC1ock11111111111111111111111111111111'
    const found = findCandidates(
      bundle([tx(0, ATTACKER, [CLOCK]), tx(1, VICTIM, [CLOCK]), tx(2, ATTACKER, [CLOCK])]),
    )

    expect(found).toEqual([])
  })

  it('does not count the system program as a shared account', () => {
    const SYSTEM = '11111111111111111111111111111111'
    const found = findCandidates(
      bundle([tx(0, ATTACKER, [SYSTEM]), tx(1, VICTIM, [SYSTEM]), tx(2, ATTACKER, [SYSTEM])]),
    )

    expect(found).toEqual([])
  })

  it('still finds a triple that shares a real account alongside a sysvar', () => {
    const CLOCK = 'SysvarC1ock11111111111111111111111111111111'
    const found = findCandidates(
      bundle([
        tx(0, ATTACKER, [POOL, CLOCK]),
        tx(1, VICTIM, [POOL, CLOCK]),
        tx(2, ATTACKER, [POOL, CLOCK]),
      ]),
    )

    expect(found).toHaveLength(1)
    expect(found[0]?.sharedAccounts).toEqual([POOL])
  })

  /**
   * A program reached by CPI is absent from its caller's `programs` and sits in
   * `accounts` looking like any other address. Checking only the transaction's own
   * programs missed this, and the SPL token programs became the commonest thing
   * candidates "had in common" — 83% of the shortlist.
   */
  it('does not count a program as shared merely because this transaction did not invoke it', () => {
    const found = findCandidates(
      bundle([
        // These three meet only on AMM, which they reach through DEX rather than call.
        tx(0, ATTACKER, [AMM], [DEX]),
        tx(1, VICTIM, [AMM], [DEX]),
        tx(2, ATTACKER, [AMM], [DEX]),
        // Somewhere else in the slot, AMM is invoked directly — so it is a program.
        tx(3, STRANGER, [], [AMM]),
      ]),
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

  /**
   * Measured over the 171 cached slots: 80.9% of what the wide filter offers touches a
   * failed transaction, and not one of the 38,733 failed transactions there carries a
   * tokenDelta. There is nothing in such a row to judge, so it is not a hard candidate
   * — it is an unanswerable one, and it costs the reviewer the same two minutes.
   */
  it('drops a triple whose victim failed — a failed trade records nothing to have lost', () => {
    const found = findCandidates(
      bundle([tx(0, ATTACKER, [POOL]), failed(tx(1, VICTIM, [POOL])), tx(2, ATTACKER, [POOL])]),
    )

    expect(found).toEqual([])
  })

  it('drops a triple whose outer leg failed — the position never opened', () => {
    const found = findCandidates(
      bundle([failed(tx(0, ATTACKER, [POOL])), tx(1, VICTIM, [POOL]), tx(2, ATTACKER, [POOL])]),
    )

    expect(found).toEqual([])
  })

  /**
   * The exclusion has to stay checkable. If the wide set were unreachable, "failed
   * candidates are worthless" would be a claim in a comment rather than something a
   * later session can re-measure.
   */
  it('returns them under includeFailed, so the claim stays reproducible', () => {
    const withFailure = bundle([
      tx(0, ATTACKER, [POOL]),
      failed(tx(1, VICTIM, [POOL])),
      tx(2, ATTACKER, [POOL]),
    ])

    expect(findCandidates(withFailure, { includeFailed: true })).toHaveLength(1)
  })

  it('keeps a triple when a failure sits beside it rather than in it', () => {
    const found = findCandidates(
      bundle([
        tx(0, ATTACKER, [POOL]),
        tx(1, VICTIM, [POOL]),
        tx(2, ATTACKER, [POOL]),
        failed(tx(3, STRANGER, [POOL])),
      ]),
    )

    expect(found.map((c) => c.positions)).toEqual([[0, 1, 2]])
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
