import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Sandwich,
  type SlotLabels,
  accuracyAgainst,
  findSandwiches,
  slotLabelsSchema,
} from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { decodeSlotBundle } from '../src/index.ts'

const LABELS = fileURLToPath(new URL('../labels', import.meta.url))
const SLOTS = fileURLToPath(new URL('../slots', import.meta.url))

/** SC-003, from `docs/SPEC.md`. */
const RECALL_FLOOR = 0.9
const FALSE_POSITIVE_CEILING = 0.05

function labelFiles(): SlotLabels[] {
  if (!existsSync(LABELS)) return []

  return readdirSync(LABELS)
    .filter((name) => name.endsWith('.json'))
    .map((name) => slotLabelsSchema.parse(JSON.parse(readFileSync(join(LABELS, name), 'utf8'))))
}

async function detectionsFor(labels: SlotLabels[]): Promise<Map<number, Sandwich[]>> {
  const found = new Map<number, Sandwich[]>()

  for (const file of labels) {
    const path = join(SLOTS, `${file.slot}.json.gz`)
    // A label without its slot cannot be scored, and quietly scoring it as zero found
    // would read as a detector that misses everything.
    if (!existsSync(path))
      throw new Error(`labels for slot ${file.slot} have no fixture beside them`)

    const bundle = await decodeSlotBundle(new Uint8Array(readFileSync(path)))
    found.set(file.slot, findSandwiches(bundle))
  }

  return found
}

const labels = labelFiles()
const accuracy = accuracyAgainst(labels, await detectionsFor(labels))

/** What the detector proposed and a person then judged, either way. */
const reported = accuracy.confirmedHits + accuracy.falsePositives

/**
 * SC-003 measured, or said out loud to be unmeasured.
 *
 * Hand-checked labels are T047 and they are the owner's hours, not the repository's.
 * Until they exist this file measures nothing — and it says so in the report rather
 * than passing quietly, because a green test over an empty set is exactly how a
 * criterion comes to be believed without ever having been checked.
 *
 * The two figures are read off different samples on purpose, and the sample size is
 * printed beside each one.
 *
 * **Both denominators are chosen so they cannot be empty by construction**, which is
 * the trap the earlier shape of this file walked into. Measured over the 1,071-slot
 * cache on 2026-09-10: the wide filter proposes 3,759 leg pairs over 761 slots, and the
 * detector fired on 9 of them, in 7 slots. Five slots drawn from the 761 would have
 * held 0.05 attacks between them, so recall had no denominator; and a false-positive
 * rate taken over every checked triple would have read 0 of 60 — a criterion passing
 * on a sample that contained nothing it was about.
 *
 * So recall is measured on slots the **detector** fired in, not merely ones the filter
 * proposed a candidate in, and the sample is biased by that: the figure says how many
 * of the attacks present in such a slot the detector finds, not how many attacks exist
 * in a random block. That sentence travels with the number.
 *
 * **And on 2026-09-10 both denominators went empty anyway, from the other end (T055).**
 * The labelling rejected all nine triples; narrowing the rule to ask what the nine
 * rejections named dropped all nine, and a sweep of the whole cache afterwards found no
 * triple anywhere. So the set holds zero marked attacks *and* draws zero detector hits:
 * recall skips for want of attacks, precision skips for want of anything reported. Both
 * skips are the honest reading and neither is a pass — the criterion is unmeasured in
 * both halves until T057 collects a set that does not depend on this detector agreeing.
 */
describe('SC-003 — the detector against hand-checked labels', () => {
  it('reports what it was measured on', () => {
    if (labels.length === 0) {
      expect(accuracy.checkedTriples).toBe(0)
      return
    }

    expect(accuracy.checkedTriples).toBeGreaterThan(0)
  })

  it.skipIf(accuracy.markedAttacks === 0)('finds at least 90 % of the marked attacks', () => {
    const recall = accuracy.foundAttacks / accuracy.markedAttacks

    expect(
      recall,
      `recall ${accuracy.foundAttacks} of ${accuracy.markedAttacks} marked attacks across ${accuracy.exhaustiveSlots} exhaustively checked slots`,
    ).toBeGreaterThanOrEqual(RECALL_FLOOR)
  })

  /**
   * Among what the detector **reports**, not among everything that was checked. The
   * screen shows a user the triples the detector proposed, so those are the ones that
   * can be wrong in front of them; the pairs it stayed silent about are the other
   * criterion's business.
   */
  it.skipIf(reported === 0)('is wrong about at most 5 % of what it reports', () => {
    const rate = accuracy.falsePositives / reported

    expect(
      rate,
      `${accuracy.falsePositives} false positives among ${reported} triples the detector reported, over ${accuracy.checkedTriples} checked`,
    ).toBeLessThanOrEqual(FALSE_POSITIVE_CEILING)
  })

  /**
   * Not a rate, a precondition. An `exhaustive` file claims every candidate in its slot
   * was looked at; a detector hit that appears in neither list contradicts that claim,
   * and every figure above is read off those files.
   */
  it.skipIf(labels.length === 0)('was checked against slots that were really checked whole', () => {
    expect(
      accuracy.unjudgedHits,
      `${accuracy.unjudgedHits} detector hits in exhaustively labelled slots were never judged either way`,
    ).toBe(0)
  })
})
