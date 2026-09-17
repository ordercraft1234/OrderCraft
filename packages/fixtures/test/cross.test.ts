import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type CrossRoundTrip,
  type SlotBundle,
  type SlotLabels,
  crossRoundTrips,
  findSandwiches,
  slotLabelsSchema,
} from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { decodeSlotBundle } from '../src/index.ts'

const LABELS = fileURLToPath(new URL('../labels-cross', import.meta.url))
const SLOTS = fileURLToPath(new URL('../slots', import.meta.url))

function labelFiles(): SlotLabels[] {
  if (!existsSync(LABELS)) return []

  return readdirSync(LABELS)
    .filter((name) => name.endsWith('.json'))
    .map((name) => slotLabelsSchema.parse(JSON.parse(readFileSync(join(LABELS, name), 'utf8'))))
    .sort((left, right) => left.slot - right.slot)
}

async function bundleFor(slot: number): Promise<SlotBundle> {
  const path = join(SLOTS, `${slot}.json.gz`)
  // A label without its slot cannot be checked, and treating it as an empty slot would
  // read as a set nobody proposed anything in.
  if (!existsSync(path))
    throw new Error(`cross labels for slot ${slot} have no fixture beside them`)

  return decodeSlotBundle(new Uint8Array(readFileSync(path)))
}

const labels = labelFiles()
const proposed = new Map<number, CrossRoundTrip[]>()
const detected = new Map<number, number>()
for (const file of labels) {
  const bundle = await bundleFor(file.slot)
  proposed.set(file.slot, crossRoundTrips(bundle))
  detected.set(file.slot, findSandwiches(bundle).length)
}

const judged = labels.reduce((sum, file) => sum + file.attacks.length + file.rejected.length, 0)
const attacks = labels.reduce((sum, file) => sum + file.attacks.length, 0)
const offered = [...proposed.values()].reduce((sum, trips) => sum + trips.length, 0)

/**
 * T058 — the last assumption, measured: legs signed by **different** parties.
 *
 * Everything that chose a slot for labelling before this asked for one signer either
 * side. So did the detector. A bot running two wallets was therefore invisible to the
 * filter, to the wider screen of T057, to `findSandwiches` and to every label written
 * against them — not judged and found absent, but never proposed.
 *
 * **What was screened, over the 1,071-slot cache on 2026-09-10.** 1,098,597 pairs of
 * legs with different signers inside a window of four; 4,639 reverse a mint; 3,784 carry
 * a readable price on both legs; 877 closed better than they opened; **477 of those have
 * somebody between the legs**, which is what `crossRoundTrips` returns. Of the 477, 186
 * have somebody in the middle trading the same asset.
 *
 * **Relatedness chose the slots, never the pairs.** Two wallets are taken as one operator
 * where the block shows it: a third party that signs somewhere and moved value in both
 * legs, a program almost nobody else invokes, or one signer's balance moving inside the
 * other's transaction. That left **5 pairs in 4 slots**, 3 of them with a witness. Ten
 * more slots were drawn by seed 58 from the 114 that hold a witnessed pair with **no**
 * visible link — the control, and the reason the link requirement is not simply believed.
 * Six further fixture slots already held cross-signer round trips, so they were labelled
 * too and the set covers every one this repository can offer.
 *
 * **The result: 54 pairs judged blind across 20 slots, and none of them is an attack.**
 * That is the third independent nil — T047 by the detector's own draw, T057 by a rule the
 * detector disagrees with, and now a universe the detector cannot see at all.
 *
 * **What it does not prove.** 1,071 slots is about seven minutes of chain, and two wallets
 * of one operator need share nothing an observer can read: separate keypairs, a public
 * router, funding arranged long before the cache begins. 863 of the 877 profitable
 * cross-signer round trips carry no visible link, so what was labelled here is the
 * fraction the block can speak about. The honest statement is "not found in what could be
 * seen", never "does not happen".
 */
describe('T058 — cross-signer pairs, which nothing else in this repository proposes', () => {
  it('reports what it was measured on', () => {
    expect(labels).toHaveLength(20)
    expect(judged).toBe(54)
    expect(offered).toBe(54)
  })

  /**
   * The claim each file makes about its slot, checked rather than trusted — the same
   * precondition `unjudgedHits` guards for the same-signer set. A pair proposed here and
   * judged in neither list would mean recall was read off a sample nobody finished.
   */
  it('judged every cross-signer round trip its slots hold', () => {
    const missing = labels.flatMap((file) => {
      const seen = new Set(
        [...file.attacks, ...file.rejected].map((triple) => `${triple.front}-${triple.back}`),
      )

      return (proposed.get(file.slot) ?? [])
        .filter((trip) => !seen.has(`${trip.front}-${trip.back}`))
        .map((trip) => `${file.slot} #${trip.front}/${trip.back}`)
    })

    expect(missing).toStrictEqual([])
    expect(labels.every((file) => file.coverage === 'exhaustive')).toBe(true)
  })

  /**
   * Stated rather than assumed. `findSandwiches` requires one signer on both legs, so it
   * cannot report any of these pairs whatever they turn out to be — which is exactly why
   * a nil here would have been worthless as *evidence about the detector* had the labels
   * come out the other way, and exactly why the labels had to be collected anyway.
   */
  it('is a universe the detector cannot report, and it reports nothing in these slots', () => {
    expect([...detected.values()].reduce((sum, count) => sum + count, 0)).toBe(0)
  })

  it.skipIf(attacks === 0)('would extend FR-027 if a marked attack existed here', () => {
    // Deliberately unwritten until there is one. The rule it would have to grow —
    // two legs, two signers, one operator — cannot be designed against zero examples,
    // and guessing at it here would be the same mistake T055 corrected by measurement.
    expect(attacks).toBeGreaterThan(0)
  })
})
