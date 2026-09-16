import { type WideHit, type WidePair, screenPairs } from '@ordercraft/core'
import type { SlotBundle } from '@ordercraft/core'
import type { LegPair } from './review.ts'

/**
 * The wider screen applied to a slot's leg pairs, as rows a person can read.
 *
 * The command it serves picks **slots**, not pairs: whichever slot holds a survivor is
 * then labelled exhaustively over every pair `scan` proposes in it. Screening pairs
 * instead would be cheaper and would leave `coverage` at `sampled` forever, which is the
 * state that left SC-003 without a denominator in the first place.
 */
export interface Screened {
  slot: number
  /** Pairs `scan` proposes here — the labelling cost of choosing this slot. */
  pairs: number
  hits: WideHit[]
}

export function screenSlot(bundle: SlotBundle, pairs: LegPair[]): Screened {
  const inSlot = pairs.filter((pair) => pair.slot === bundle.slot)
  const wide: WidePair[] = inSlot.map((pair) => ({
    front: pair.front,
    back: pair.back,
    signer: pair.signer,
    between: pair.between.map((entry) => entry.index),
  }))

  return { slot: bundle.slot, pairs: inSlot.length, hits: screenPairs(bundle, wide) }
}

/** One survivor as a line: the legs, the asset, and what was between them. */
export function renderHit(hit: WideHit): string {
  const middles =
    hit.touched.length === 0
      ? 'nobody in between traded it'
      : `${hit.touched.map((index) => `#${index}`).join(' ')} traded it, ${
          hit.aligned.length === 0
            ? 'none the way the opening leg did'
            : `${hit.aligned.map((index) => `#${index}`).join(' ')} the same way`
        }`

  return `  #${hit.front}/${hit.back}  ${hit.mint}  ${
    hit.samePool ? 'one pool' : 'two pools'
  }  ${middles}`
}

/**
 * What choosing these slots costs and what it buys, printed under the rows.
 *
 * The two numbers are the decision: pairs to label, and slots to carry as fixtures. They
 * are reported rather than assumed because the answer to "is this affordable" changed the
 * shape of T057 twice already.
 */
export function summarize(screened: Screened[], labelled: Set<number>): string {
  const chosen = screened.filter((slot) => slot.hits.length > 0)
  const fresh = chosen.filter((slot) => !labelled.has(slot.slot))
  const cost = (slots: Screened[]): number => slots.reduce((sum, slot) => sum + slot.pairs, 0)
  const hits = chosen.reduce((sum, slot) => sum + slot.hits.length, 0)

  return [
    `${screened.length} slots scanned, ${cost(screened)} leg pairs`,
    `${hits} profitable round trips in ${chosen.length} slots, ${cost(chosen)} pairs to label there`,
    `${fresh.length} of those slots are not labelled yet: ${cost(fresh)} pairs, ${fresh
      .map((slot) => slot.slot)
      .join(' ')}`,
  ].join('\n')
}
