import {
  type Corpus,
  type CrossRoundTrip,
  type Link,
  type SlotBundle,
  crossRoundTrips,
  linksBetween,
} from '@ordercraft/core'
import type { Candidate } from './scan.ts'

/**
 * The corpus facts `linksBetween` needs, measured over a body of slots.
 *
 * **Which corpus is measured changes the answer, and it must be said out loud.** A
 * program invoked by three signers in a thirty-slot fixture set may be invoked by ninety
 * thousand on chain; breadth over a subset is only ever a lower bound. The slots chosen
 * for T058 were chosen on the 1,071-slot cache, and that choice is recorded in the docs
 * rather than recomputed — what the repository has to reproduce is the *set of pairs*
 * offered for labelling, and that is `crossRoundTrips`, which needs no corpus at all.
 */
export function corpusOf(bundles: SlotBundle[], maxProgramSigners?: number): Corpus {
  const signers = new Set<string>()
  const invokers = new Map<string, Set<string>>()

  for (const bundle of bundles) {
    for (const transaction of bundle.transactions) {
      if (transaction.failed) continue
      for (const signer of transaction.signers) signers.add(signer)
      for (const program of transaction.programs) {
        invokers.set(program, invokedBy(invokers.get(program), transaction.signers))
      }
    }
  }

  return {
    signers,
    programSigners: new Map([...invokers].map(([program, seen]) => [program, seen.size])),
    ...(maxProgramSigners === undefined ? {} : { maxProgramSigners }),
  }
}

/** The signers known to invoke a program, plus the ones this transaction adds. */
function invokedBy(seen: Set<string> | undefined, signers: string[]): Set<string> {
  return new Set([...(seen ?? []), ...signers])
}

export interface CrossHit {
  trip: CrossRoundTrip
  links: Link[]
}

export interface CrossSlot {
  slot: number
  /** Every profitable cross-signer round trip here — the pairs a label file must cover. */
  hits: CrossHit[]
}

/**
 * One slot's cross-signer round trips, each carrying whatever relates its two signers.
 *
 * The link decides which **slots** are worth a person's time; it never decides which
 * pairs get labelled. That separation is the same one T057 settled on and for the same
 * reason: a set filtered by the hypothesis under test measures agreement with itself.
 */
export function crossSlot(bundle: SlotBundle, corpus: Corpus): CrossSlot {
  const at = new Map(bundle.transactions.map((transaction) => [transaction.index, transaction]))

  return {
    slot: bundle.slot,
    hits: crossRoundTrips(bundle).map((trip) => {
      const front = at.get(trip.front)
      const back = at.get(trip.back)

      return {
        trip,
        links: front === undefined || back === undefined ? [] : linksBetween(front, back, corpus),
      }
    }),
  }
}

/**
 * The pairs as shortlist rows, so `review` and `label` work on them unchanged.
 *
 * One row per transaction between the legs, exactly as `scan` emits them — the two
 * commands group rows back into pairs, and a second row shape would mean a second review
 * path, a second grouping and an index that names different pairs in each.
 */
export function toCandidates(slots: CrossSlot[]): Candidate[] {
  return slots.flatMap((slot) =>
    slot.hits.flatMap(({ trip }) =>
      trip.between.map(
        (middle): Candidate => ({
          slot: slot.slot,
          positions: [trip.front, middle, trip.back],
          signer: trip.frontSigner,
          counterSigner: trip.backSigner,
          sharedAccounts: [trip.mint],
        }),
      ),
    ),
  )
}

/** One round trip as a line: the legs, the asset, the venues, and what related them. */
export function renderHit({ trip, links }: CrossHit): string {
  const middles =
    trip.touched.length === 0
      ? 'nobody in between traded it'
      : `${trip.touched.map((index) => `#${index}`).join(' ')} traded it, ${
          trip.aligned.length === 0
            ? 'none the way the opening leg did'
            : `${trip.aligned.map((index) => `#${index}`).join(' ')} the same way`
        }`
  const related =
    links.length === 0
      ? 'no visible link'
      : links
          .map((link) => (link.address === '' ? link.kind : `${link.kind} ${link.address}`))
          .join(', ')

  return `  #${trip.front}/${trip.back}  ${trip.mint}  ${
    trip.samePool ? 'one pool' : 'two pools'
  }  ${middles}\n      ${related}`
}

/**
 * What the run found and what labelling it would cost.
 *
 * Both halves are printed because the decision is between them: the linked slots are the
 * ones that answer T058's question, and the rest are the ones that say whether the link
 * requirement is throwing real attacks away.
 */
export function summarize(slots: CrossSlot[]): string {
  const withHits = slots.filter((slot) => slot.hits.length > 0)
  const pairs = withHits.reduce((sum, slot) => sum + slot.hits.length, 0)
  const linked = withHits.filter((slot) => slot.hits.some((hit) => hit.links.length > 0))
  const witnessed = withHits.filter((slot) =>
    slot.hits.some((hit) => hit.trip.touched.length > 0 && hit.links.length === 0),
  )
  const cost = (chosen: CrossSlot[]): number =>
    chosen.reduce((sum, slot) => sum + slot.hits.length, 0)

  return [
    `${slots.length} slots scanned, ${pairs} profitable cross-signer round trips in ${withHits.length} slots`,
    `${linked.length} slots hold a pair whose signers are visibly linked: ${cost(linked)} pairs to label, ${linked
      .map((slot) => slot.slot)
      .join(' ')}`,
    `${witnessed.length} slots hold an unlinked pair somebody in the middle traded against — the control`,
  ].join('\n')
}
