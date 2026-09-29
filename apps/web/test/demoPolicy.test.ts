import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PRESETS, apply, policyHash, runMetrics, validatePolicy } from '@ordercraft/core'
import { DEMO_SLOT, decodeSlotBundle, demoSlotUrl } from '@ordercraft/fixtures'
import { describe, expect, it } from 'vitest'
import { demoDraft } from '../src/lib/demoPolicy.ts'
import { toPolicy } from '../src/lib/policyDraft.ts'
import { ribbonsFor } from '../src/lib/ribbons.ts'

const bundle = await decodeSlotBundle(new Uint8Array(readFileSync(fileURLToPath(demoSlotUrl))))
const parsed = toPolicy(demoDraft())

describe('the policy the app opens on', () => {
  it('compiles and is worth running', () => {
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(validatePolicy(parsed.policy).runnable).toBe(true)
    expect(bundle.slot).toBe(DEMO_SLOT)
  })

  /**
   * The demo's numbers were measured on the slot the repository ships, and both can be
   * replaced. This is the test that fails when they stop agreeing — a threshold that
   * selects nothing, or a deny list of addresses that are no longer in the block, is a
   * landing screen showing an untouched ordering and claiming it is a policy at work.
   */
  it('leaves every mark on the shipped slot', () => {
    if (!parsed.ok) throw new Error('the demo policy does not compile')
    const metrics = runMetrics(bundle, apply(parsed.policy, bundle))

    expect(metrics.moved).toBeGreaterThan(0)
    expect(metrics.delayed).toBeGreaterThan(0)
    expect(metrics.dropped).toBeGreaterThan(0)
    expect(metrics.deferred).toBeGreaterThan(0)
  })

  it('fills the field without covering it', () => {
    if (!parsed.ok) throw new Error('the demo policy does not compile')
    const ordering = apply(parsed.policy, bundle)
    const ribbons = ribbonsFor(ordering, bundle.transactions.length)
    const share = ribbons.length / bundle.transactions.length

    // The brief asks the field to read as a weave with visible strands. Under a tenth
    // there is nothing to look at; over nine tenths it is one indigo block.
    expect(share).toBeGreaterThan(0.1)
    expect(share).toBeLessThan(0.9)
  })
})

describe('the demo is not a preset', () => {
  /**
   * The demo was measured on one slot and denies three signers of that block; a preset
   * ships to everyone and names no one. Wearing a preset's name, it would show an origin
   * it does not have (FR-015) — it was called "Anti-snipe launch" until T062.
   */
  it('shares its name with no preset', () => {
    if (!parsed.ok) throw new Error('the demo policy does not compile')
    const demoName = parsed.policy.name
    expect(PRESETS.map((preset) => preset.name)).not.toContain(demoName)
  })

  /** The rename moved the hash and nothing else: the name orders no transaction. */
  it('orders the shipped slot exactly as it did under its old name', () => {
    if (!parsed.ok) throw new Error('the demo policy does not compile')
    const renamed = apply(parsed.policy, bundle)
    const before = apply({ ...parsed.policy, name: 'Anti-snipe launch' }, bundle)

    expect(renamed.policyHash).not.toBe(before.policyHash)
    expect({ ...renamed, policyHash: '' }).toStrictEqual({ ...before, policyHash: '' })
  })

  /** The landing prints the figures of this policy under its hash, and must name this one. */
  it('is the policy the landing page names', () => {
    if (!parsed.ok) throw new Error('the demo policy does not compile')
    const landing = readFileSync(
      fileURLToPath(new URL('../../landing/index.html', import.meta.url)),
      'utf8',
    )
    expect(landing).toContain(`policy ${policyHash(parsed.policy).slice(0, 12)}`)
  })
})
