import { describe, expect, it } from 'vitest'
import { canonicalize } from '../src/policy/compile.ts'
import type { Policy, PolicyStep } from '../src/policy/schema.ts'
import { diffFromPreset } from '../src/presets/diff.ts'
import { PRESETS } from '../src/presets/library.ts'

const SIGNER = '7QmXo9tXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const PROGRAM = 'CbjY8Wohs2EnLLjSNMPkFrn9iaPvVJJtAdJiWRYeeN2x'

const bump = (delayMs: number): PolicyStep => ({
  kind: 'speedBump',
  delayMs,
  appliesTo: { match: 'program', programs: [PROGRAM] },
})
const batch = (windowMs: number): PolicyStep => ({
  kind: 'batchAuction',
  windowMs,
  appliesTo: { match: 'program', programs: [PROGRAM] },
})

const policy = (steps: PolicyStep[], name = 'base'): Policy => ({
  schemaVersion: 1,
  name,
  steps,
})

const BASE = policy([bump(120), batch(250)])

describe('diffFromPreset (FR-015)', () => {
  it('finds nothing between a preset and itself', () => {
    for (const preset of PRESETS) {
      const diff = diffFromPreset(preset.policy, preset.policy)
      expect(diff.identical).toBe(true)
      expect(diff.renamed).toBeNull()
      expect(diff.deviations).toBe(0)
      expect(diff.steps.every((step) => step.status === 'same')).toBe(true)
    }
  })

  /** The name is in the hash, so the content differs — but no parameter does. */
  it('reports a rename apart from the deviations', () => {
    const diff = diffFromPreset(policy(BASE.steps, 'mine'), BASE)
    expect(diff.identical).toBe(false)
    expect(diff.renamed).toStrictEqual({ preset: 'base', policy: 'mine' })
    expect(diff.deviations).toBe(0)
  })

  it('names the parameter that moved, with both values', () => {
    const diff = diffFromPreset(policy([bump(200), batch(250)]), BASE)
    expect(diff.deviations).toBe(1)
    expect(diff.steps).toStrictEqual([
      {
        status: 'changed',
        policyIndex: 0,
        presetIndex: 0,
        fields: [{ field: 'delayMs', preset: 120, policy: 200 }],
      },
      { status: 'same', policyIndex: 1, presetIndex: 1 },
    ])
  })

  it('reports a changed class as one field holding both selectors', () => {
    const changed: PolicyStep = {
      kind: 'speedBump',
      delayMs: 120,
      appliesTo: { match: 'signer', signers: [SIGNER] },
    }
    const diff = diffFromPreset(policy([changed, batch(250)]), BASE)
    expect(diff.steps[0]).toStrictEqual({
      status: 'changed',
      policyIndex: 0,
      presetIndex: 0,
      fields: [
        {
          field: 'appliesTo',
          preset: { match: 'program', programs: [PROGRAM] },
          policy: { match: 'signer', signers: [SIGNER] },
        },
      ],
    })
  })

  /**
   * The reason alignment is not positional: a step put in front must not turn every
   * step after it into a change.
   */
  it('shows a step inserted in front as one addition and leaves the rest alone', () => {
    const diff = diffFromPreset(policy([batch(100), bump(120), batch(250)]), BASE)
    expect(diff.deviations).toBe(1)
    expect(diff.steps).toStrictEqual([
      { status: 'added', policyIndex: 0 },
      { status: 'same', policyIndex: 1, presetIndex: 0 },
      { status: 'same', policyIndex: 2, presetIndex: 1 },
    ])
  })

  it('shows a removed step at the place it was', () => {
    const diff = diffFromPreset(policy([batch(250)]), BASE)
    expect(diff.deviations).toBe(1)
    expect(diff.steps).toStrictEqual([
      { status: 'removed', presetIndex: 0 },
      { status: 'same', policyIndex: 0, presetIndex: 1 },
    ])
  })

  /** Order is part of the policy: swapping two steps is visible, not reconciled away. */
  it('shows swapped steps as a change of order', () => {
    const diff = diffFromPreset(policy([batch(250), bump(120)]), BASE)
    expect(diff.deviations).toBe(2)
    expect(diff.steps.map((step) => step.status).sort()).toStrictEqual(['added', 'removed', 'same'])
  })

  it('pairs a repeated kind with the copy that did not change', () => {
    const diff = diffFromPreset(policy([bump(200), bump(120), batch(250)]), BASE)
    expect(diff.steps).toStrictEqual([
      { status: 'added', policyIndex: 0 },
      { status: 'same', policyIndex: 1, presetIndex: 0 },
      { status: 'same', policyIndex: 2, presetIndex: 1 },
    ])
  })

  it('compares allow/deny rules one by one', () => {
    const preset = PRESETS.find((candidate) => candidate.id === 'maker-quotes-first')
    if (preset === undefined) throw new Error('maker-quotes-first is not shipped')
    const [step] = preset.policy.steps
    if (step?.kind !== 'allowDeny') throw new Error('expected an allow/deny step')

    const extra = {
      effect: 'deny' as const,
      match: { match: 'signer' as const, signers: [SIGNER] },
    }
    const flipped = { ...step.rules[0], effect: 'deny' as const } as (typeof step.rules)[number]
    const edited = policy([{ kind: 'allowDeny', rules: [flipped, extra] }], preset.name)

    const diff = diffFromPreset(edited, preset.policy)
    expect(diff.deviations).toBe(2)
    expect(diff.steps[0]).toStrictEqual({
      status: 'changed',
      policyIndex: 0,
      presetIndex: 0,
      fields: [
        { field: 'rule', rule: 0, preset: step.rules[0], policy: flipped },
        { field: 'rule', rule: 1, preset: null, policy: extra },
      ],
    })
  })

  it('answers the same diff twice', () => {
    const edited = policy([batch(100), bump(200)], 'mine')
    expect(canonicalize(diffFromPreset(edited, BASE))).toBe(
      canonicalize(diffFromPreset(edited, BASE)),
    )
  })
})
