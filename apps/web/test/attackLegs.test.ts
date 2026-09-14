import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { findSandwiches } from '@ordercraft/core'
import { decodeSlotBundle, demoSlotUrl } from '@ordercraft/fixtures'
import { describe, expect, it } from 'vitest'

const bundle = await decodeSlotBundle(new Uint8Array(readFileSync(fileURLToPath(demoSlotUrl))))
const found = findSandwiches(bundle)

/**
 * The attack screen's whole claim is "the same party either side of somebody else". It
 * used to print each leg's **first** signer, which is not the same thing: a Solana
 * transaction can carry several, and on triple 2 of the shipped slot the two legs list
 * different addresses first. The screen therefore showed two different parties while
 * asserting underneath that they were one — a contradiction no test could see, because
 * until 2026-09-10 the fixture carried no triple at all.
 *
 * This is the data-shaped half of the fix. It fails the moment a fixture stops
 * exercising the co-signer case, at which point the screen is no longer proven.
 */
describe('the legs of a marked triple', () => {
  it('share the signer the detector matched them on', () => {
    expect(found.length).toBeGreaterThan(0)

    for (const sandwich of found) {
      for (const index of [sandwich.front, sandwich.back]) {
        const transaction = bundle.transactions[index]

        expect(transaction?.signers, `#${index} must be signed by ${sandwich.signer}`).toContain(
          sandwich.signer,
        )
      }
    }
  })

  /**
   * The reason the bug was invisible rather than merely absent. If every leg in the
   * fixture listed the shared signer first, printing `signers[0]` would look correct on
   * this slot and break on the next one.
   */
  it('still includes a leg whose first signer is not the shared one', () => {
    const misleading = found.flatMap((sandwich) =>
      [sandwich.front, sandwich.back].filter(
        (index) => bundle.transactions[index]?.signers[0] !== sandwich.signer,
      ),
    )

    expect(misleading.length).toBeGreaterThan(0)
  })
})
