import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRESETS, type SlotBundle, apply } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { decodeSlotBundle } from '../src/index.ts'

const SLOTS = fileURLToPath(new URL('../slots', import.meta.url))

const bundles: SlotBundle[] = await Promise.all(
  readdirSync(SLOTS)
    .filter((file) => file.endsWith('.json.gz'))
    .sort()
    .map((file) => decodeSlotBundle(new Uint8Array(readFileSync(join(SLOTS, file))))),
)

/**
 * In how many curated slots each preset changes at least one placement — measured on
 * 2026-09-29 over the 53 slots the repository ships.
 *
 * A preset is a starting point on the user's own slot, and one whose class selects
 * nothing on real blocks is a policy that does not exist. The launchpad class is the
 * thinnest: pump.fun, Meteora DBC and Raydium LaunchLab together are absent from two
 * slots of the set. The other two classes are in every slot.
 */
const ACTIVE_IN: Record<string, number> = {
  'anti-snipe-launch': 51,
  'maker-quotes-first': 53,
  'batched-swaps': 53,
}

describe('presets on the curated slots', () => {
  it('reads the whole set', () => {
    expect(bundles.length).toBe(53)
  })

  it.each(PRESETS)('$id changes something in the slots it was measured on', (preset) => {
    const active = bundles.filter((bundle) => {
      const { included, excluded } = apply(preset.policy, bundle)
      return [...included, ...excluded].some((placement) => placement.changedBy !== null)
    })

    expect(active.length).toBe(ACTIVE_IN[preset.id])
  })
})
