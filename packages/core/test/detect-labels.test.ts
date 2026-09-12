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
    })
  })
})
