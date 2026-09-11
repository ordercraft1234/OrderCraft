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

/**
 * SC-003 measured, or said out loud to be unmeasured.
 *
 * Hand-checked labels are T047 and they are the owner's hours, not the repository's.
 * Until they exist this file measures nothing — and it says so in the report rather
 * than passing quietly, because a green test over an empty set is exactly how a
 * criterion comes to be believed without ever having been checked.
 *
 * The two figures are read off different samples on purpose, and the sample size is
 * printed beside each one. Recall comes only from slots where every candidate was
 * looked at; the five such slots are drawn from slots the wide filter found a candidate
 * in, so **the recall figure is measured on a sample the filter biased** — on 171 slots
 * the shape appears in 12.9 % of them, and five random slots would have held on average
 * half an attack between them.
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

  it.skipIf(accuracy.checkedTriples === 0)('is wrong about at most 5 % of what it reports', () => {
    const rate = accuracy.falsePositives / accuracy.checkedTriples

    expect(
      rate,
      `${accuracy.falsePositives} false positives among ${accuracy.checkedTriples} checked triples`,
    ).toBeLessThanOrEqual(FALSE_POSITIVE_CEILING)
  })
})
