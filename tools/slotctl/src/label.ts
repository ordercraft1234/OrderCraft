import { LABELS_SCHEMA_VERSION, type SlotLabels } from '@ordercraft/core'
import type { LegPair } from './review.ts'

export type Verdict = 'attack' | 'reject'

export interface Judgement {
  verdict: Verdict
  /** Why the person decided this, in their own words — the schema will not take an empty one. */
  note: string
  /**
   * The transactions actually traded against, when only some of them were.
   *
   * Defaults to everything the shortlist found between the legs. The detector sweeps in
   * all of them, a person often means one, and `accuracyAgainst` matches on the legs, so
   * the two descriptions still agree about the same attack.
   */
  victims?: number[]
}

export interface Progress {
  /** Pairs of this slot that carry a verdict. */
  done: number
  /** Pairs the shortlist proposes in this slot. */
  total: number
  coverage: SlotLabels['coverage']
  /** Indices, as `review --slot` numbers them, that nobody has judged yet. */
  remaining: number[]
}

/**
 * Adds one verdict to a slot's label file, or creates the file around it.
 *
 * The command exists because the protocol asks for a verdict on **every** pair — 56 of
 * them over seven slots — and hand-written JSON is where that goes wrong: a duplicated
 * pair is counted twice by `accuracyAgainst`, and a file that says `exhaustive` while
 * pairs are missing inflates recall by exactly the rows nobody looked at. Both are
 * decided here rather than left to typing.
 *
 * **It never runs the detector**, for the same reason `renderPair` does not: labels that
 * agree with the detector cannot measure it. Nothing in this file imports `sandwich.ts`,
 * and the verdict comes in as an argument.
 */
export function recordVerdict(
  existing: SlotLabels | undefined,
  pair: LegPair,
  judgement: Judgement,
  context: { seed: number; pairsInSlot: number; checkedOn: string },
): { labels: SlotLabels; replaced: boolean } {
  const between = pair.between.map((entry) => entry.index)
  const victims = judgement.victims ?? between

  if (victims.length === 0) {
    throw new Error('a triple needs at least one victim between the legs')
  }

  // A victim outside the legs is a mistyped index, not a judgement. Left in, it would
  // travel into the labels and describe a triple that never existed in the block.
  const stray = victims.filter((index) => !between.includes(index))
  if (stray.length > 0) {
    throw new Error(
      `${stray.join(', ')} not between #${pair.front} and #${pair.back} — the shortlist has ${
        between.length === 0 ? 'nothing' : between.map((index) => `#${index}`).join(', ')
      } there`,
    )
  }

  const file: SlotLabels = existing ?? {
    schemaVersion: LABELS_SCHEMA_VERSION,
    slot: pair.slot,
    coverage: 'sampled',
    seed: context.seed,
    checkedOn: context.checkedOn,
    attacks: [],
    rejected: [],
  }

  if (file.slot !== pair.slot) {
    throw new Error(`labels for slot ${file.slot} cannot hold a pair from slot ${pair.slot}`)
  }

  // Changing one's mind about a pair replaces the verdict; it never leaves two. Both
  // lists feed the same counts, so a pair sitting in each would be judged twice —
  // `checkedTriples` would exceed the pairs that exist, and one of the two would be a
  // false positive against its own confirmation.
  const held = (list: SlotLabels['attacks']): boolean =>
    list.some((triple) => triple.front === pair.front && triple.back === pair.back)
  const replaced = held(file.attacks) || held(file.rejected)
  const without = (list: SlotLabels['attacks']): SlotLabels['attacks'] =>
    list.filter((triple) => !(triple.front === pair.front && triple.back === pair.back))

  const triple = {
    front: pair.front,
    victims: [...victims].sort((left, right) => left - right),
    back: pair.back,
    note: judgement.note,
  }
  const attacks = without(file.attacks)
  const rejected = without(file.rejected)
  if (judgement.verdict === 'attack') attacks.push(triple)
  else rejected.push(triple)

  const labels: SlotLabels = {
    ...file,
    checkedOn: context.checkedOn,
    attacks,
    rejected,
    // `exhaustive` is a claim about the slot, and the file is the only place it is
    // written down — so it is derived from the count rather than typed. Reaching every
    // pair the shortlist proposes is what the claim means; short of that the file still
    // counts towards false positives, which need only the pair they name.
    coverage: attacks.length + rejected.length >= context.pairsInSlot ? 'exhaustive' : 'sampled',
  }

  return { labels, replaced }
}

/** Where the review of one slot stopped, so a session picks up at the next index. */
export function progressOf(existing: SlotLabels | undefined, pairs: LegPair[]): Progress {
  const judged = new Set(
    [...(existing?.attacks ?? []), ...(existing?.rejected ?? [])].map(
      (triple) => `${triple.front}-${triple.back}`,
    ),
  )
  const remaining = pairs
    .map((pair, index) => ({ pair, index }))
    .filter(({ pair }) => !judged.has(`${pair.front}-${pair.back}`))
    .map(({ index }) => index)

  return {
    done: pairs.length - remaining.length,
    total: pairs.length,
    coverage: existing?.coverage ?? 'sampled',
    remaining,
  }
}
