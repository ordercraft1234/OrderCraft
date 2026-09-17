import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findSandwiches } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { groupByLegs } from '../src/review.ts'
import { findCandidates } from '../src/scan.ts'
import { screenSlot } from '../src/screen.ts'
import { readSlot } from '../src/store.ts'

const SLOTS = fileURLToPath(new URL('../../../packages/fixtures/slots', import.meta.url))

const bundles = readdirSync(SLOTS)
  .filter((name) => name.endsWith('.json.gz'))
  .map((name) => readSlot(join(SLOTS, name)))

const candidates = bundles.flatMap((bundle) => findCandidates(bundle))
const pairs = groupByLegs(candidates)

/** Drawn by the detector (T047) and by the wider screen (T057), in that order. */
const DETECTOR_DRAWN = [445507853, 445553238, 445572644, 445625228, 445660284, 445813028, 445829304]
const SCREEN_DRAWN = [
  445504723, 445516617, 445529763, 445580782, 445591737, 445608326, 445657009, 445676247, 445706295,
  445714433, 445722258, 445736969, 445740099, 445741351, 445782667, 445787362,
]
/**
 * Drawn by `slotctl cross` (T058), where the two legs have **different** signers.
 *
 * Four hold a pair whose signers the block visibly relates; ten are the control, drawn
 * with seed 58 from the 114 cached slots that hold a witnessed cross-signer round trip
 * with no visible link at all. Their verdicts live in `packages/fixtures/labels-cross`,
 * a set apart because `coverage` there counts a different universe of pairs: what `scan`
 * proposes is one signer either side, and none of these pairs is in it.
 */
const CROSS_DRAWN = [
  445508166, 445546039, 445551360, 445565758, 445577339, 445636496, 445685950, 445691271, 445765452,
  445795500, 445833060,
]

/** The slots the same-signer labels were written against — the first two draws. */
const LABELLED = [...DETECTOR_DRAWN, ...SCREEN_DRAWN]
const labelledBundles = bundles.filter((bundle) => LABELLED.includes(bundle.slot))
const labelledPairs = groupByLegs(labelledBundles.flatMap((bundle) => findCandidates(bundle)))

/**
 * The set the labels are written against, guarded where changing it is visible.
 *
 * **Three draws, and they were made by different rules on purpose.** Seven slots came from
 * T047: the ones `findSandwiches` fired in over the 1,071-slot cache, before T055
 * narrowed it. The blind labelling rejected all nine triples they held, which left the
 * set with zero known attacks — and a set drawn by the detector's agreement can never
 * hold anything else, however the rule is later corrected. Sixteen more came from T057,
 * drawn by `slotctl screen`: a leg pair whose round trip closed at a better price than it
 * opened, each leg priced at its own pool. Over the same cache that draw finds 26 pairs
 * in 19 slots where the narrow rule finds none. Eleven more came from T058 and `slotctl
 * cross`, where the two legs have different signers — a universe `scan` does not propose
 * at all, labelled in `labels-cross` and counted apart from everything here.
 *
 * They are in the repository rather than only in `.cache/slots` for a reason that
 * outlives the labelling: a label file names a slot, and `accuracy.test.ts` refuses to
 * score one whose slot is missing, so labels checked against a 424 MB cache nobody else
 * holds would be unverifiable anywhere but this machine.
 *
 * The figures are pinned rather than merely printed because the labels are written
 * against these pairs. A change to `scan` that adds or drops a row leaves the label files
 * describing a set that no longer exists, and silence about it would show up much later
 * as recall over an incomplete sample.
 */
describe('the set the labels describe', () => {
  it('holds all three draws, and says which slot came from which', () => {
    expect(bundles.map((bundle) => bundle.slot).sort((a, b) => a - b)).toStrictEqual(
      [...DETECTOR_DRAWN, ...SCREEN_DRAWN, ...CROSS_DRAWN].sort((a, b) => a - b),
    )
  })

  /**
   * Pinned over the labelled slots rather than the directory, because that is what the
   * claim is about. The eleven slots T058 added carry no same-signer labels — they were
   * drawn for a universe `scan` does not propose — and counting their pairs here would
   * quietly restate a number the label files were never written against.
   */
  it('is 148 pairs of legs, which is what the budget was measured on', () => {
    expect(labelledPairs).toHaveLength(148)
    expect(labelledBundles.flatMap((bundle) => findCandidates(bundle))).toHaveLength(221)
  })

  /** What the third draw costs the first two: nothing but rows nobody labelled. */
  it('leaves the same-signer shortlist alone: the new slots add pairs, not verdicts', () => {
    expect(candidates).toHaveLength(272)
    expect(pairs).toHaveLength(189)
  })

  /**
   * The property T057 exists for. Scanning the fixture directory has to reproduce what
   * the full cache said about these slots — otherwise the set carries slots chosen for a
   * reason nobody can check again.
   */
  it('reproduces the screen that drew the sixteen: 26 round trips in 19 slots', () => {
    const screened = labelledBundles.map((bundle) => screenSlot(bundle, labelledPairs))
    const chosen = screened.filter((slot) => slot.hits.length > 0)

    expect(chosen.reduce((sum, slot) => sum + slot.hits.length, 0)).toBe(26)
    expect(chosen).toHaveLength(19)
    expect(chosen.reduce((sum, slot) => sum + slot.pairs, 0)).toBe(122)
  })

  /**
   * Three of the seven the detector drew turn up in the screen's draw too, and their
   * verdicts still stand: a label describes a block, not a rule. Pinned because "which
   * slots does the new set add" is the number the labelling budget was read off.
   */
  it('overlaps the earlier draw in exactly three slots', () => {
    const overlap = bundles
      .map((bundle) => bundle.slot)
      .filter((slot) => DETECTOR_DRAWN.includes(slot) && screenDrew(slot))

    expect(overlap.sort((a, b) => a - b)).toStrictEqual([445553238, 445572644, 445625228])
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

  /**
   * The same-signer screen finds nothing new in the eleven slots T058 drew, which is the
   * point of them: they were chosen by a question about two signers, and the wider screen
   * of T057 cannot ask it. Pinned so that a slot added for one draw cannot silently
   * enlarge the denominator of another.
   */
  it('adds nothing to the second draw: the cross-signer slots hold no same-signer hit', () => {
    const inCross = bundles
      .filter((bundle) => CROSS_DRAWN.includes(bundle.slot))
      .map((bundle) => screenSlot(bundle, pairs))

    expect(inCross.reduce((sum, slot) => sum + slot.hits.length, 0)).toBe(0)
  })
})

/** Whether the wider screen reports anything in this slot, by its own reading. */
function screenDrew(slot: number): boolean {
  const bundle = bundles.find((one) => one.slot === slot)

  return bundle !== undefined && screenSlot(bundle, pairs).hits.length > 0
}
