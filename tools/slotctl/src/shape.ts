import { type ShapeHit, type ShapePair, type SlotBundle, shapedPairs } from '@ordercraft/core'
import type { LegPair } from './review.ts'

/**
 * The shape screen applied to a slot's leg pairs, as rows a person can read.
 *
 * Like `screen` (T057) it picks **slots**, not pairs: whichever slot holds a survivor is
 * then labelled exhaustively over every pair `scan` proposes in it, which is what gives
 * `coverage: exhaustive` — and with it, a denominator for recall.
 *
 * Unlike `screen`, it does not ask whether the round trip paid. That is the whole point:
 * a front-run that misjudged its victim exits worse than it entered and is still an
 * attack, and requiring a profit is the blind spot every earlier draw shared.
 */
export interface Shaped {
  slot: number
  /** Pairs `scan` proposes here — the labelling cost of choosing this slot. */
  pairs: number
  hits: ShapeHit[]
}

export function shapeSlot(bundle: SlotBundle, pairs: LegPair[]): Shaped {
  const inSlot = pairs.filter((pair) => pair.slot === bundle.slot)
  const shape: ShapePair[] = inSlot.map((pair) => ({
    front: pair.front,
    back: pair.back,
    signer: pair.signer,
    between: pair.between.map((entry) => entry.index),
  }))

  return { slot: bundle.slot, pairs: inSlot.length, hits: shapedPairs(bundle, shape) }
}

/** One survivor as a line: the legs, the asset, the pool, and what the three checks say. */
export function renderHit(hit: ShapeHit): string {
  const victims = hit.victims.map((index) => `#${index}`).join(' ')
  const polarity =
    hit.aligned.length === 0
      ? 'none of them the way the opening leg did'
      : `${hit.aligned.map((index) => `#${index}`).join(' ')} the same way`
  // The proportion the closing leg brought back, as tenths of a percent — integers only,
  // because a screen that printed 0.7594 would invite the eye to a threshold nobody set.
  const closed = hit.size === 0n ? 0n : (hit.closed * 1000n) / hit.size

  return `  #${hit.front}/${hit.back}  ${hit.mint}  pool ${hit.pool}\n      ${victims} traded it there, ${polarity}\n      closed ${Number(closed) / 10}% of the opening leg, ${hit.paid ? 'and it paid' : 'and it did NOT pay'}`
}

/**
 * What the run found and what labelling it would cost.
 *
 * The second line is the one that decides: the three checks `findSandwiches` applies are
 * printed as a tally rather than as a filter, so the sample can be seen for what it is
 * before anybody spends two minutes a pair on it.
 */
export function summarize(shaped: Shaped[], labelled: Set<number>): string {
  const chosen = shaped.filter((slot) => slot.hits.length > 0)
  const fresh = chosen.filter((slot) => !labelled.has(slot.slot))
  const hits = chosen.flatMap((slot) => slot.hits)
  const cost = (slots: Shaped[]): number => slots.reduce((sum, slot) => sum + slot.pairs, 0)

  return [
    `${shaped.length} slots scanned, ${cost(shaped)} leg pairs`,
    `${hits.length} pairs have the shape, in ${chosen.length} slots: ${
      hits.filter((hit) => hit.aligned.length > 0).length
    } with the middle trading the same way, ${hits.filter((hit) => hit.paid).length} that paid`,
    `${fresh.length} of those slots are not labelled yet: ${cost(fresh)} pairs, ${fresh
      .map((slot) => slot.slot)
      .join(' ')}`,
  ].join('\n')
}
