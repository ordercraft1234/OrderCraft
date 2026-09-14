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
   * **Skipped from 2026-09-09 to 2026-09-10, and now measured.** Tightening the detector
   * left the old fixture with no triple at all, and the 171 slots then in hand held one
   * candidate slot whose votes sat in a tail costing the comparison screen 43 % of the
   * block. T052 grew the cache to 1,071 slots; 7 carry a triple and 4 of those have no
   * tail. This slot is one of them, and the only one carrying **two**.
   *
   * Both are asserted, because one is the number that made this slot worth taking: a
   * fixture that quietly fell to a single triple would still pass a `> 0` check while no
   * longer being the slot anybody chose.
   */
  it('carries the two triples the fixture was chosen for', () => {
    expect(findSandwiches(bundle)).toHaveLength(2)
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
