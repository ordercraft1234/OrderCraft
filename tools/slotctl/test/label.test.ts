import { type SlotLabels, accuracyAgainst, slotLabelsSchema } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { progressOf, recordVerdict } from '../src/label.ts'
import { type LegPair, groupByLegs } from '../src/review.ts'
import type { Candidate } from '../src/scan.ts'

const POOL = 'CbjY8Wohs2EnLLjSNMPkFrn9iaPvVJJtAdJiWRYeeN2x'
const ATTACKER = '7QmXo9tXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const SLOT = 445553238

const row = (front: number, middle: number, back: number): Candidate => ({
  slot: SLOT,
  positions: [front, middle, back],
  signer: ATTACKER,
  sharedAccounts: [POOL],
})

/** One pair with two transactions between the legs, as the shortlist would deliver it. */
const pair = groupByLegs([row(10, 11, 13), row(10, 12, 13)])[0] as LegPair
const other = groupByLegs([row(20, 21, 22)])[0] as LegPair

const context = { seed: 0, pairsInSlot: 2, checkedOn: '2026-09-10' }
const because = (note: string) => ({ verdict: 'reject' as const, note })

describe('recordVerdict', () => {
  it('writes a file the labels schema accepts', () => {
    const { labels } = recordVerdict(undefined, pair, because('cross-pool arbitrage'), context)

    expect(() => slotLabelsSchema.parse(labels)).not.toThrow()
    expect(labels.slot).toBe(SLOT)
    expect(labels.rejected).toEqual([
      { front: 10, victims: [11, 12], back: 13, note: 'cross-pool arbitrage' },
    ])
    expect(labels.attacks).toEqual([])
  })

  it('takes everything between the legs as victims, or the ones named', () => {
    const all = recordVerdict(undefined, pair, because('both sides'), context).labels
    const one = recordVerdict(
      undefined,
      pair,
      { verdict: 'attack', note: 'traded against #12', victims: [12] },
      context,
    ).labels

    expect(all.rejected[0]?.victims).toEqual([11, 12])
    expect(one.attacks[0]?.victims).toEqual([12])
  })

  it('refuses a victim that is not between the legs', () => {
    expect(() =>
      recordVerdict(undefined, pair, { verdict: 'attack', note: 'typo', victims: [42] }, context),
    ).toThrow(/not between #10 and #13/)
  })

  /**
   * The failure this command exists to prevent. `accuracyAgainst` matches triples on
   * their legs, so the same pair in both lists is one attack that is also its own false
   * positive — and `checkedTriples` climbs past the number of pairs in the slot.
   */
  it('replaces a verdict on second thoughts rather than holding two', () => {
    const first = recordVerdict(undefined, pair, because('looks like execution'), context).labels
    const second = recordVerdict(
      first,
      pair,
      { verdict: 'attack', note: 'no, it took both sides of the same mint' },
      context,
    )

    expect(second.replaced).toBe(true)
    expect(second.labels.rejected).toEqual([])
    expect(second.labels.attacks).toHaveLength(1)
    expect(second.labels.attacks[0]?.note).toMatch(/both sides/)

    const found = new Map([[SLOT, [{ front: 10, back: 13 }]]])
    const accuracy = accuracyAgainst([second.labels], found as never)
    expect(accuracy.checkedTriples).toBe(1)
    expect(accuracy.falsePositives).toBe(0)
    expect(accuracy.confirmedHits).toBe(1)
  })

  /**
   * `coverage` is derived, never typed. A hand-written `exhaustive` over a half-checked
   * slot inflates recall by exactly the pairs nobody looked at, and `unjudgedHits`
   * catches only those the detector also fired on — the ones it missed, which is what
   * recall is about, leave no trace at all.
   */
  it('claims exhaustive only once every pair in the slot is judged', () => {
    const half = recordVerdict(undefined, pair, because('one of two'), context).labels
    expect(half.coverage).toBe('sampled')

    const full = recordVerdict(half, other, because('the second one'), context).labels
    expect(full.coverage).toBe('exhaustive')
  })

  it('drops back to sampled when the slot turns out to hold more pairs', () => {
    const done = recordVerdict(undefined, pair, because('only pair'), {
      ...context,
      pairsInSlot: 1,
    }).labels
    expect(done.coverage).toBe('exhaustive')

    const regrouped = recordVerdict(done, pair, because('same pair, wider shortlist'), {
      ...context,
      pairsInSlot: 5,
    }).labels
    expect(regrouped.coverage).toBe('sampled')
  })

  it('refuses a pair from another slot', () => {
    const labels: SlotLabels = {
      schemaVersion: 1,
      slot: 445507853,
      coverage: 'sampled',
      seed: 0,
      checkedOn: '2026-09-10',
      attacks: [],
      rejected: [],
    }

    expect(() => recordVerdict(labels, pair, because('wrong file'), context)).toThrow(
      /cannot hold a pair from slot 445553238/,
    )
  })
})

describe('progressOf', () => {
  it('names the indices nobody has judged yet', () => {
    const pairs = [pair, other]
    expect(progressOf(undefined, pairs)).toEqual({
      done: 0,
      total: 2,
      coverage: 'sampled',
      remaining: [0, 1],
    })

    const labels = recordVerdict(undefined, pair, because('first'), context).labels
    expect(progressOf(labels, pairs)).toEqual({
      done: 1,
      total: 2,
      coverage: 'sampled',
      remaining: [1],
    })
  })
})
