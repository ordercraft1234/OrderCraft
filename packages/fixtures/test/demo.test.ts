import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { findSandwiches, serializeSlotBundle } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { DEMO_SLOT, decodeSlotBundle, demoSlotUrl } from '../src/index.ts'

const VOTE_PROGRAM = 'Vote111111111111111111111111111111111111111'
const path = fileURLToPath(demoSlotUrl)
const bundle = await decodeSlotBundle(new Uint8Array(readFileSync(path)))

describe('the demo fixture', () => {
  it('is the slot the constant names', () => {
    expect(demoSlotUrl.endsWith(`/${DEMO_SLOT}.json.gz`)).toBe(true)
    expect(bundle.slot).toBe(DEMO_SLOT)
  })

  it('decodes into a bundle the schema accepts', () => {
    expect(bundle.transactions.length).toBeGreaterThan(0)
    expect(bundle.blockTime).toBeGreaterThan(0)
    expect(bundle.transactions.map((transaction) => transaction.index)).toStrictEqual(
      bundle.transactions.map((_, position) => position),
    )
  })

  /**
   * What the fixture is *for*, written as numbers. A replacement slot that fails this
   * is not a smaller demo — it is a comparison screen with nothing to compare and an
   * attack screen with nothing to find, and that has to fail here rather than in
   * front of the owner.
   */
  it('carries enough traffic to be worth showing', () => {
    const real = bundle.transactions.filter(
      (transaction) => !transaction.programs.includes(VOTE_PROGRAM),
    )
    const moving = real.filter((transaction) => transaction.tokenDelta.length > 0)

    expect(real.length).toBeGreaterThanOrEqual(300)
    expect(moving.length).toBeGreaterThanOrEqual(100)
  })

  /**
   * A static server may answer for `.gz` with `Content-Encoding: gzip` and unwrap the
   * file before the page sees it. Both shapes have to arrive at the same bundle, or
   * the demo works on one host and breaks on the next.
   */
  it('decodes the same bundle whether or not the transport unwrapped it', async () => {
    const plain = new TextEncoder().encode(JSON.stringify(serializeSlotBundle(bundle)))
    const decoded = await decodeSlotBundle(plain)

    expect(decoded).toStrictEqual(bundle)
  })

  /**
   * The attack screen has nothing to draw without one of these, and the detector is a
   * heuristic over a real block rather than something the fixture can promise on its
   * own — so the two are checked against each other here, where replacing either one
   * fails loudly.
   *
   * **Skipped again on 2026-09-10 (T055), and no slot can satisfy it today.** The two
   * triples this fixture was chosen for are both in the blind labelling's rejected list
   * — one a plain large sale, one a market maker filling two orders — and the narrowed
   * rule drops them along with the other seven it used to report. Swept over the whole
   * 1,071-slot cache afterwards, it reports **nothing at all**, so there is no slot to
   * swap this one for; the set has to be collected against a wider rule first (T057).
   *
   * Unskipping this is the visible half of T057. Both figures are asserted, because one
   * was the number that made this slot worth taking: a fixture that quietly fell to a
   * single triple would still pass a `> 0` check while no longer being the slot anybody
   * chose.
   */
  it.skip('carries the two triples the fixture was chosen for', () => {
    expect(findSandwiches(bundle)).toHaveLength(2)
  })

  /**
   * The state the screen is actually in, asserted rather than left to be discovered.
   * The attack screen draws its empty state on this fixture, and that is a measured
   * consequence of T055 and not a broken build. This test and the skip above are one
   * pair: the day either changes, both do.
   */
  it('reports no triple under the narrowed rule, which is why the screen is empty', () => {
    expect(findSandwiches(bundle)).toStrictEqual([])
  })

  /**
   * The repository carries this file forever. 400 KB was the budget in T051; the
   * ceiling is set above it so a slightly busier slot fits, and far below the 3.9 MB
   * a raw block costs.
   */
  it('stays inside the size the repository agreed to carry', () => {
    expect(statSync(path).size).toBeLessThan(700 * 1024)
  })
})
