import { describe, expect, it } from 'vitest'
import { type BatchAuctionStep, batchAuction } from '../src/primitives/batchAuction.ts'
import { type Placement, initialPlacements } from '../src/primitives/placement.ts'
import { ATTACKER, VICTIM, bundleOf, tx } from './helpers/build.ts'

const auction = (windowMs: number, appliesTo: BatchAuctionStep['appliesTo'] = { match: 'all' }) =>
  ({ kind: 'batchAuction', windowMs, appliesTo }) satisfies BatchAuctionStep

// Eight transactions, so arrivals fall every 50 ms: 0, 50, 100 … 350.
const bundle = bundleOf(
  [...Array(8).keys()].map((index) =>
    tx(index, { signers: [index % 2 === 0 ? ATTACKER : VICTIM] }),
  ),
)

const run = (step: BatchAuctionStep, placements: Placement[] = initialPlacements(bundle)) =>
  batchAuction(bundle, placements, step)

describe('batchAuction', () => {
  it('settles a window at its close, not at its start', () => {
    const after = run(auction(100))

    expect(after.map((placement) => placement.timeMs)).toEqual([
      100, 100, 200, 200, 300, 300, 400, 400,
    ])
  })

  it('always adds latency, because collecting for a window costs a window', () => {
    const before = initialPlacements(bundle)
    const after = run(auction(100))

    for (const [position, placement] of after.entries()) {
      expect(placement.timeMs).toBeGreaterThan(before[position]?.timeMs ?? 0)
    }
  })

  it('erases the arrival advantage inside a window', () => {
    const after = run(auction(100))

    // 0 ms and 50 ms arrived at different times and now settle together: inside the
    // batch the model has no earlier and later to give anyone.
    expect(after[0]?.timeMs).toBe(after[1]?.timeMs)
    expect(after[0]?.batch).toBe(after[1]?.batch)
  })

  it('keeps separate windows in separate batches', () => {
    const after = run(auction(100))

    expect(after.map((placement) => placement.batch)).toEqual([
      100, 100, 200, 200, 300, 300, 400, 400,
    ])
    expect(after[1]?.batch).not.toBe(after[2]?.batch)
  })

  it('opens the next window for a transaction arriving exactly on a boundary', () => {
    // Index 2 arrives at exactly 100 ms. It belongs to [100, 200), not to the window
    // that just closed.
    expect(run(auction(100))[2]?.timeMs).toBe(200)
  })

  it('defers what the auction clears past the end of the slot', () => {
    const after = run(auction(100))

    expect(after.map((placement) => placement.status)).toEqual([
      'kept',
      'kept',
      'kept',
      'kept',
      'kept',
      'kept',
      'deferred',
      'deferred',
    ])
  })

  it('defers everything at a window as long as the slot', () => {
    const after = run(auction(400))

    expect(after.every((placement) => placement.status === 'deferred')).toBe(true)
    expect(after.every((placement) => placement.timeMs === 400)).toBe(true)
  })

  it('leaves transactions outside the class alone', () => {
    const after = run(auction(100, { match: 'signer', signers: [VICTIM] }))

    // Odd indices are the victims: 50 → 100, 150 → 200, 250 → 300, 350 → 400.
    expect(after.map((placement) => placement.timeMs)).toEqual([
      0, 100, 100, 200, 200, 300, 300, 400,
    ])
    expect(after.map((placement) => placement.batch)).toEqual([
      null,
      100,
      null,
      200,
      null,
      300,
      null,
      400,
    ])
  })

  it('does not batch a transaction another step already removed', () => {
    const before = initialPlacements(bundle).map((placement) =>
      placement.index === 3 ? { ...placement, status: 'dropped' as const } : placement,
    )
    const after = run(auction(100), before)

    expect(after[3]).toEqual(before[3])
    expect(after[3]?.batch).toBeNull()
  })

  it('does not mutate the placements it was given', () => {
    const before = initialPlacements(bundle)
    const snapshot = structuredClone(before)

    run(auction(100), before)

    expect(before).toEqual(snapshot)
  })

  it('returns the same result for the same input, fifty times over', () => {
    const step = auction(150)
    const expected = JSON.stringify(run(step))

    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(JSON.stringify(run(step))).toBe(expected)
    }
  })

  it('rejects a placement that does not belong to the slot', () => {
    const stray: Placement = {
      index: 99,
      signature: 'sigjjxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      status: 'kept',
      timeMs: 0,
      changedBy: null,
      batch: null,
    }

    expect(() => run(auction(100), [stray])).toThrow(/no transaction in slot/)
  })
})
