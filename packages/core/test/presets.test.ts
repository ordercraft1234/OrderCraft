import { describe, expect, it } from 'vitest'
import { apply } from '../src/order/apply.ts'
import { canonicalize, policyHash } from '../src/policy/compile.ts'
import { policySchema } from '../src/policy/schema.ts'
import { validatePolicy } from '../src/policy/validate.ts'
import { PRESETS, presetById } from '../src/presets/library.ts'
import { PROGRAMS } from '../src/presets/programs.ts'
import { ATTACKER, QUOTE, bundleOf, tx } from './helpers/build.ts'

/**
 * The content address of every preset, written down.
 *
 * A run is `(policyHash, slot)`, and a stored policy version remembers which preset it
 * came from. A preset that changes under the same id therefore rewrites what an old run
 * claims to have started from. Editing one is allowed — it is a conscious act that
 * updates this table in the same commit, not a side effect of tidying a description.
 */
const PINNED: Record<string, string> = {
  'anti-snipe-launch': '62f74122b08723e3aea6d0f63a0d6b8b7f8c7a6c8399f806adfbfa5b0bb9f807',
  'maker-quotes-first': '33aec4a97aa7e6dcabb89a9cd581aff9df93c6119b31bd9df44e682db120d42d',
  'batched-swaps': '53a7512263adadc0af9a3752ebabf69564347ee6aea1a9d7ed75648f5f761ef6',
}

describe('the preset library (FR-014)', () => {
  it('ships exactly the pinned presets, in a fixed order', () => {
    expect(PRESETS.map((preset) => preset.id)).toStrictEqual(Object.keys(PINNED))
  })

  it.each(PRESETS)('$id hashes to its pinned value', (preset) => {
    expect(policyHash(preset.policy)).toBe(PINNED[preset.id])
  })

  it.each(PRESETS)('$id is a policy the schema accepts unchanged', (preset) => {
    expect(policySchema.parse(preset.policy)).toStrictEqual(preset.policy)
  })

  it.each(PRESETS)('$id raises no issue at all, not even a warning', (preset) => {
    expect(validatePolicy(preset.policy)).toStrictEqual({ issues: [], runnable: true })
  })

  it.each(PRESETS)('$id says what it is and when to reach for it', (preset) => {
    expect(preset.id).toMatch(/^[a-z]+(-[a-z]+)*$/)
    expect(preset.policy.name).toBe(preset.name)
    expect(preset.description.trim().length).toBeGreaterThan(0)
    expect(preset.scenario.trim().length).toBeGreaterThan(0)
  })

  it('never repeats an id or a name', () => {
    expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(PRESETS.length)
    expect(new Set(PRESETS.map((preset) => preset.name)).size).toBe(PRESETS.length)
  })

  /**
   * The words this product may not use about itself (`CLAUDE.md`): a preset describes
   * what the policy would do to a block, never that anyone is protected by it.
   */
  it.each(PRESETS)('$id keeps to the descriptive frame', (preset) => {
    const text = `${preset.name} ${preset.description} ${preset.scenario}`.toLowerCase()
    for (const word of ['saved', 'protected', 'guarantee', 'prevents', 'bam']) {
      expect(text).not.toContain(word)
    }
  })
})

describe('presetById', () => {
  it('finds every preset by its id', () => {
    for (const preset of PRESETS) expect(presetById(preset.id)).toBe(preset)
  })

  it('answers undefined for an id it does not ship', () => {
    expect(presetById('no-such-preset')).toBeUndefined()
  })
})

describe('a preset cannot be edited in place', () => {
  it.each(PRESETS)('$id refuses a change to its parameters and keeps its hash', (preset) => {
    const before = policyHash(preset.policy)
    const step = preset.policy.steps[0] as Record<string, unknown>

    expect(() => {
      step.delayMs = 1
    }).toThrow(TypeError)
    expect(() => {
      ;(preset.policy.steps as unknown[]).push(step)
    }).toThrow(TypeError)
    expect(policyHash(preset.policy)).toBe(before)
  })
})

/**
 * A block every preset has something to do in: launchpad buys, quote updates and large
 * wSOL swaps, interleaved so that a step which moved nothing would show up as an
 * ordering identical to the recorded one.
 */
function mixedSlot() {
  return bundleOf(
    [...Array(60).keys()].map((index) => {
      switch (index % 4) {
        case 0:
          return tx(index, { programs: [PROGRAMS.pumpFun] })
        case 1:
          return tx(index, { programs: [PROGRAMS.humidiFi] })
        case 2:
          return tx(index, {
            tokenDelta: [{ owner: ATTACKER, mint: QUOTE, amount: -2_000_000_000n }],
          })
        default:
          return tx(index)
      }
    }),
  )
}

describe('determinism of a preset run', () => {
  const bundle = mixedSlot()
  const recorded = bundle.transactions.map((transaction) => transaction.index)

  it.each(PRESETS)('$id reorders the mixed slot', (preset) => {
    const { included } = apply(preset.policy, bundle)
    expect(included.map((placement) => placement.index)).not.toStrictEqual(recorded)
  })

  it.each(PRESETS)('$id produces an identical ordering on 50 runs', (preset) => {
    const first = canonicalize(apply(preset.policy, bundle))
    for (let attempt = 1; attempt < 50; attempt += 1) {
      expect(canonicalize(apply(preset.policy, bundle))).toBe(first)
    }
  })
})
