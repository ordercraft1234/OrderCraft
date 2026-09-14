import { describe, expect, it } from 'vitest'
import {
  LABELS_SCHEMA_VERSION,
  type SlotLabels,
  accuracyAgainst,
  slotLabelsSchema,
} from '../src/detect/labels.ts'
import type { Sandwich } from '../src/detect/sandwich.ts'

function sandwich(front: number, back: number): Sandwich {
  return { front, victims: [front + 1], back, signer: 'attacker', mint: 'mint', pool: 'pool' }
}

function labels(overrides: Partial<SlotLabels> = {}): SlotLabels {
  return {
    schemaVersion: LABELS_SCHEMA_VERSION,
    slot: 100,
    coverage: 'exhaustive',
    seed: 7,
    checkedOn: '2026-09-10',
    attacks: [],
    rejected: [],
    ...overrides,
  }
}

const attack = { front: 10, victims: [11], back: 12, note: 'buys, victim buys, sells back' }
const notAnAttack = { front: 20, victims: [21], back: 22, note: 'both legs failed' }

describe('slotLabelsSchema', () => {
  it('insists on a reason for every triple', () => {
    const file = { ...labels(), attacks: [{ ...attack, note: '' }] }

    expect(slotLabelsSchema.safeParse(file).success).toBe(false)
  })

  it('insists on a date it can read', () => {
    expect(slotLabelsSchema.safeParse({ ...labels(), checkedOn: '10 Sep 2026' }).success).toBe(
      false,
    )
  })

  it('keeps the seed the sample was drawn with', () => {
    const parsed = slotLabelsSchema.parse(labels({ seed: 42 }))

    expect(parsed.seed).toBe(42)
  })
})

describe('accuracyAgainst', () => {
  it('reads recall only from slots where everything was checked', () => {
    const files = [
      labels({ slot: 100, coverage: 'exhaustive', attacks: [attack] }),
      labels({ slot: 200, coverage: 'sampled', attacks: [attack] }),
    ]
    const found = new Map([
      [100, [sandwich(10, 12)]],
      [200, []],
    ])

    const accuracy = accuracyAgainst(files, found)
    expect(accuracy.exhaustiveSlots).toBe(1)
    expect(accuracy.markedAttacks).toBe(1)
    expect(accuracy.foundAttacks).toBe(1)
  })

  it('counts a marked attack the detector missed', () => {
    const accuracy = accuracyAgainst([labels({ attacks: [attack] })], new Map([[100, []]]))

    expect(accuracy).toMatchObject({ markedAttacks: 1, foundAttacks: 0 })
  })

  it('counts a rejected triple the detector still reported', () => {
    const files = [labels({ attacks: [attack], rejected: [notAnAttack] })]
    const found = new Map([[100, [sandwich(10, 12), sandwich(20, 22)]]])

    expect(accuracyAgainst(files, found)).toMatchObject({
      checkedTriples: 2,
      falsePositives: 1,
    })
  })

  /**
   * The detector sweeps every transaction between the legs into one triple; a person
   * writes down the one that was traded against. Both describe the same attack, and
   * matching on the legs is what lets them agree.
   */
  it('matches a triple by its legs, not by who was caught between them', () => {
    const files = [labels({ attacks: [{ ...attack, victims: [11] }] })]
    const wider: Sandwich = { ...sandwich(10, 12), victims: [11, 11] }

    expect(accuracyAgainst(files, new Map([[100, [wider]]])).foundAttacks).toBe(1)
  })

  it('says nothing rather than something when there are no labels', () => {
    expect(accuracyAgainst([], new Map())).toStrictEqual({
      exhaustiveSlots: 0,
      markedAttacks: 0,
      foundAttacks: 0,
      checkedTriples: 0,
      falsePositives: 0,
      confirmedHits: 0,
      unjudgedHits: 0,
    })
  })

  /**
   * The false-positive denominator. It counts hits a person agreed with wherever they
   * were checked, `sampled` files included — confirming a hit needs only that hit to
   * have been looked at, unlike recall, which needs the whole slot.
   */
  it('counts a confirmed hit in a sampled slot, which recall would not', () => {
    const files = [labels({ slot: 200, coverage: 'sampled', attacks: [attack] })]

    expect(accuracyAgainst(files, new Map([[200, [sandwich(10, 12)]]]))).toMatchObject({
      confirmedHits: 1,
      markedAttacks: 0,
    })
  })

  /**
   * The reason `confirmedHits` exists rather than the rate being taken over everything
   * checked. Both files below hold one detector hit that a person rejected, and the
   * detector is wrong about it either way; only the denominator differs.
   */
  it('separates being wrong about a hit from being silent about a pair', () => {
    const quiet = Array.from({ length: 40 }, (_, index) => ({
      front: 100 + index * 3,
      victims: [101 + index * 3],
      back: 102 + index * 3,
      note: 'nobody traded against anybody',
    }))
    const files = [labels({ attacks: [attack], rejected: [notAnAttack, ...quiet] })]
    const found = new Map([[100, [sandwich(10, 12), sandwich(20, 22)]]])

    const accuracy = accuracyAgainst(files, found)
    const reported = accuracy.confirmedHits + accuracy.falsePositives

    expect(accuracy.falsePositives / reported).toBe(0.5)
    expect(accuracy.falsePositives / accuracy.checkedTriples).toBeLessThan(0.025)
  })

  /**
   * A file that says `exhaustive` while the detector fires on a triple nobody wrote
   * down is not exhaustive, and recall read off it would be flattered by exactly the
   * triples that were skipped.
   */
  it('counts a detector hit that an exhaustive file judged neither way', () => {
    const files = [labels({ attacks: [attack] })]
    const found = new Map([[100, [sandwich(10, 12), sandwich(30, 32)]]])

    expect(accuracyAgainst(files, found).unjudgedHits).toBe(1)
  })

  it('does not hold a sampled file to having judged every hit', () => {
    const files = [labels({ coverage: 'sampled', attacks: [attack] })]
    const found = new Map([[100, [sandwich(10, 12), sandwich(30, 32)]]])

    expect(accuracyAgainst(files, found).unjudgedHits).toBe(0)
  })
})
