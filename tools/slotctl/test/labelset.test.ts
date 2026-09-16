import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findSandwiches } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { groupByLegs } from '../src/review.ts'
import { findCandidates } from '../src/scan.ts'
import { readSlot } from '../src/store.ts'

const SLOTS = fileURLToPath(new URL('../../../packages/fixtures/slots', import.meta.url))

const bundles = readdirSync(SLOTS)
  .filter((name) => name.endsWith('.json.gz'))
  .map((name) => readSlot(join(SLOTS, name)))

const candidates = bundles.flatMap((bundle) => findCandidates(bundle))
const pairs = groupByLegs(candidates)

/**
 * The set T047 is labelled against, guarded where changing it is visible.
 *
 * The seven slots in `packages/fixtures/slots` are the ones the detector fired in over
 * the 1,071-slot cache — 0.65 % of it — when the set was drawn, before T055 narrowed it.
 * They are in the repository rather than only in
 * `.cache/slots` for a reason that outlives the labelling: a label file names a slot,
 * and `accuracy.test.ts` refuses to score one whose slot is missing, so labels checked
 * against a 424 MB cache nobody else holds would be unverifiable anywhere but this
 * machine. Scanning the fixture directory reproduces the shortlist exactly — measured
 * 2026-09-10, the same 82 rows and 56 pairs the full cache yields for these slots.
 *
 * The figures are pinned rather than merely printed because the labels are written
 * against these pairs. A change to `scan` that adds or drops a row leaves the label
 * files describing a set that no longer exists, and silence about it would show up much
 * later as recall over an incomplete sample.
 */
describe('the set T047 labels', () => {
  it('holds the seven slots the labelling was done on', () => {
    expect(bundles.map((bundle) => bundle.slot).sort((a, b) => a - b)).toStrictEqual([
      445507853, 445553238, 445572644, 445625228, 445660284, 445813028, 445829304,
    ])
  })

  it('is 56 pairs of legs, which is what the budget was measured on', () => {
    expect(candidates).toHaveLength(82)
    expect(pairs).toHaveLength(56)
  })

  /**
   * The property the whole measurement rests on. Recall is read off files that claim
   * every candidate in the slot was checked, and the reviewer works from this
   * shortlist — so a triple the detector reports that the shortlist does not offer
   * would never be judged either way, and `accuracyAgainst` counts exactly that as
   * `unjudgedHits`. Here it is checked in advance, where it is cheap.
   */
  it('offers every triple the detector reports, so nothing goes unjudged', () => {
    const offered = new Set(pairs.map((pair) => `${pair.slot}-${pair.front}-${pair.back}`))
    const missing = bundles.flatMap((bundle) =>
      findSandwiches(bundle)
        .map((triple) => `${bundle.slot}-${triple.front}-${triple.back}`)
        .filter((key) => !offered.has(key)),
    )

    expect(missing).toStrictEqual([])
  })

  /**
   * What T055 did, pinned where the set is defined.
   *
   * The pool rule reported nine triples over these seven slots and the blind labelling
   * rejected every one of them; the narrowed rule reports none. Nine was the
   * false-positive denominator, so this file used to pin it — the number to pin now is
   * zero, and it is not a good number: a set the detector is silent on cannot measure
   * precision either. That is T057, and the silence is stated here so it cannot be
   * mistaken for the labels having been satisfied.
   */
  it('carries none of the nine triples, all of which the labelling rejected', () => {
    const found = bundles.flatMap((bundle) => findSandwiches(bundle))

    expect(found).toStrictEqual([])
  })
})
