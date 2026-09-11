import { z } from 'zod'
import type { Sandwich } from './sandwich.ts'

export const LABELS_SCHEMA_VERSION = 1

const triple = z.object({
  front: z.number().int().nonnegative(),
  victims: z.array(z.number().int().nonnegative()).min(1),
  back: z.number().int().nonnegative(),
  /** Why the person checking decided this, in their own words. */
  note: z.string().min(1),
})

/**
 * Hand-checked truth for one slot (FR-028).
 *
 * `coverage` is the field that decides what a file may be used for, and it is not a
 * detail: recall can only be measured where **every** candidate in the slot was looked
 * at, because a missed attack that nobody checked is indistinguishable from one that is
 * not there. A `sampled` file says only "these particular triples were checked", and
 * counts towards false positives alone.
 */
export const slotLabelsSchema = z.object({
  schemaVersion: z.literal(LABELS_SCHEMA_VERSION),
  slot: z.number().int().nonnegative(),
  coverage: z.enum(['exhaustive', 'sampled']),
  /**
   * The seed the slot was drawn with, so the set can be drawn again. Labels describe a
   * sample, and a sample nobody can reproduce describes nothing.
   */
  seed: z.number().int(),
  checkedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a date as YYYY-MM-DD'),
  /** Triples the person confirmed are sandwich attacks. */
  attacks: z.array(triple),
  /** Triples that were looked at and rejected — a candidate is not an attack by default. */
  rejected: z.array(triple),
})

export type SlotLabels = z.infer<typeof slotLabelsSchema>

export interface Accuracy {
  /** Slots whose every candidate was checked — the only ones recall can be read from. */
  exhaustiveSlots: number
  /** Attacks marked by hand in those slots. */
  markedAttacks: number
  /** How many of them the detector found. */
  foundAttacks: number
  /** Triples that were checked either way, in every file. */
  checkedTriples: number
  /** Detector hits that a person rejected. */
  falsePositives: number
}

/**
 * The detector against hand-checked labels, as counts rather than percentages.
 *
 * Percentages are left to whoever prints them, together with the sample size — SC-003
 * asks for both numbers to be shown with the size beside them, and a function that
 * returned `0.93` would make that easy to forget.
 *
 * The two figures come from different samples on purpose. Recall needs slots where
 * everything was checked, and checking everything costs hours per slot; false positives
 * only need the triples the detector itself proposed. Reporting them as one score would
 * hide that.
 */
export function accuracyAgainst(labels: SlotLabels[], found: Map<number, Sandwich[]>): Accuracy {
  const accuracy: Accuracy = {
    exhaustiveSlots: 0,
    markedAttacks: 0,
    foundAttacks: 0,
    checkedTriples: 0,
    falsePositives: 0,
  }

  for (const file of labels) {
    const detected = found.get(file.slot) ?? []
    const hits = new Set(detected.map(legs))

    if (file.coverage === 'exhaustive') {
      accuracy.exhaustiveSlots += 1
      accuracy.markedAttacks += file.attacks.length
      accuracy.foundAttacks += file.attacks.filter((attack) => hits.has(legs(attack))).length
    }

    accuracy.checkedTriples += file.attacks.length + file.rejected.length
    accuracy.falsePositives += file.rejected.filter((triple) => hits.has(legs(triple))).length
  }

  return accuracy
}

/**
 * A triple is identified by its two legs, not by the victims between them.
 *
 * The detector groups everyone caught between the pair into one triple; a person
 * checking by hand may write down only the transaction that was actually traded
 * against. Matching on the legs lets those two descriptions agree about the same
 * attack, and the legs are what makes an attack an attack.
 */
function legs(triple: { front: number; back: number }): string {
  return `${triple.front}-${triple.back}`
}
