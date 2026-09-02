import { describe, expect, it } from 'vitest'
import { SLOT_DURATION_MS, arrivalMs, initialPlacements } from '../src/primitives/placement.ts'
import { bundleOf, tx } from './helpers/build.ts'

describe('arrivalMs', () => {
  it('spreads the recorded order evenly across the slot', () => {
    expect([0, 1, 2, 3].map((index) => arrivalMs(index, 4))).toEqual([0, 100, 200, 300])
  })

  it('never reaches the end of the slot', () => {
    const last = arrivalMs(1499, 1500)

    expect(last).toBeLessThan(SLOT_DURATION_MS)
    expect(last).toBe(399)
  })

  it('floors rather than rounds, and returns whole milliseconds', () => {
    // 1 × 400 / 3 = 133.33…
    expect(arrivalMs(1, 3)).toBe(133)
    expect(Number.isInteger(arrivalMs(1, 3))).toBe(true)
    expect(Number.isInteger(arrivalMs(7, 11))).toBe(true)
  })

  it('makes a small bump a real number of positions', () => {
    // The claim in PLAN.md: 5 ms on a 1500-transaction slot is about 19 positions.
    const positions = [...Array(1500).keys()].filter(
      (index) => arrivalMs(index, 1500) < arrivalMs(0, 1500) + 5,
    ).length

    expect(positions).toBe(19)
  })

  it('answers 0 for an empty slot instead of dividing by zero', () => {
    expect(arrivalMs(0, 0)).toBe(0)
  })
})

describe('initialPlacements', () => {
  const bundle = bundleOf([tx(0), tx(1), tx(2), tx(3)])

  it('keeps every transaction where the block put it', () => {
    const placements = initialPlacements(bundle)

    expect(placements.map((placement) => placement.index)).toEqual([0, 1, 2, 3])
    expect(placements.map((placement) => placement.timeMs)).toEqual([0, 100, 200, 300])
    expect(placements.every((placement) => placement.status === 'kept')).toBe(true)
    expect(placements.every((placement) => placement.changedBy === null)).toBe(true)
  })

  it('carries the signature, so the sort key can end on it', () => {
    expect(initialPlacements(bundle)[2]?.signature).toBe(bundle.transactions[2]?.signature)
  })

  it('handles a slot with no transactions', () => {
    expect(initialPlacements(bundleOf([]))).toEqual([])
  })
})
