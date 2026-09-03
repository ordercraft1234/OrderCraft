import { describe, expect, it } from 'vitest'
import { type AllowDenyStep, allowDeny } from '../src/primitives/allowDeny.ts'
import { type Placement, initialPlacements } from '../src/primitives/placement.ts'
import { AMM, ATTACKER, POOL, VICTIM, VOTE, bundleOf, tx } from './helpers/build.ts'

type Rule = AllowDenyStep['rules'][number]

const step = (...rules: Rule[]) => ({ kind: 'allowDeny', rules }) satisfies AllowDenyStep

const bundle = bundleOf([
  tx(0, { signers: [ATTACKER] }),
  tx(1, { signers: [VICTIM] }),
  tx(2, { signers: [ATTACKER], programs: [VOTE], accounts: [ATTACKER, VOTE] }),
  tx(3, { signers: [VICTIM] }),
])

const run = (rules: AllowDenyStep, placements: Placement[] = initialPlacements(bundle)) =>
  allowDeny(bundle, placements, rules)

describe('allowDeny', () => {
  it('refuses the class a deny rule names', () => {
    const after = run(step({ effect: 'deny', match: { match: 'signer', signers: [ATTACKER] } }))

    expect(after.map((placement) => placement.status)).toEqual([
      'dropped',
      'kept',
      'dropped',
      'kept',
    ])
    expect(after[0]?.changedBy).toBe('allowDeny')
  })

  it('marks a prioritised class without moving it in time', () => {
    const after = run(step({ effect: 'prioritise', match: { match: 'signer', signers: [VICTIM] } }))

    expect(after.map((placement) => placement.prioritised)).toEqual([false, true, false, true])
    // Priority is a class, not an earlier arrival: the clock is untouched, so the
    // added-delay metric stays honest.
    expect(after.map((placement) => placement.timeMs)).toEqual([0, 100, 200, 300])
  })

  it('leaves a transaction no rule names exactly as it was', () => {
    const before = initialPlacements(bundle)
    const after = run(
      step({ effect: 'deny', match: { match: 'program', programs: [VOTE] } }),
      before,
    )

    expect(after[0]).toEqual(before[0])
    expect(after[0]?.changedBy).toBeNull()
  })

  describe('when two different rules catch the same transaction', () => {
    const denyAttacker: Rule = {
      effect: 'deny',
      match: { match: 'signer', signers: [ATTACKER] },
    }
    const prioritisePool: Rule = {
      effect: 'prioritise',
      match: { match: 'account', accounts: [POOL] },
    }

    it('lets deny win, whichever order the rules are written in', () => {
      const denyFirst = run(step(denyAttacker, prioritisePool))
      const denyLast = run(step(prioritisePool, denyAttacker))

      expect(denyFirst[0]?.status).toBe('dropped')
      expect(denyLast[0]?.status).toBe('dropped')
      expect(denyFirst).toEqual(denyLast)
    })

    it('does not also mark the refused transaction prioritised', () => {
      expect(run(step(denyAttacker, prioritisePool))[0]?.prioritised).toBe(false)
    })
  })

  it('takes a refused transaction out of the batch it was settling in', () => {
    const batched = initialPlacements(bundle).map((placement) => ({ ...placement, batch: 200 }))
    const after = run(
      step({ effect: 'deny', match: { match: 'signer', signers: [ATTACKER] } }),
      batched,
    )

    expect(after.map((placement) => placement.batch)).toEqual([null, 200, null, 200])
  })

  it('does not act on a transaction already out of the block', () => {
    const before = initialPlacements(bundle).map((placement) =>
      placement.index === 0 ? { ...placement, status: 'deferred' as const } : placement,
    )
    const after = run(step({ effect: 'deny', match: { match: 'all' } }), before)

    // A deny after a bump that already deferred something is visibly a no-op, not a
    // silent overwrite of why the transaction is not in the block.
    expect(after[0]).toEqual(before[0])
    expect(after[0]?.status).toBe('deferred')
    expect(after[1]?.status).toBe('dropped')
  })

  it('applies several rules in one step', () => {
    const after = run(
      step(
        { effect: 'deny', match: { match: 'program', programs: [VOTE] } },
        { effect: 'prioritise', match: { match: 'program', programs: [AMM] } },
      ),
    )

    expect(after.map((placement) => placement.status)).toEqual(['kept', 'kept', 'dropped', 'kept'])
    expect(after.map((placement) => placement.prioritised)).toEqual([true, true, false, true])
  })

  it('does not mutate the placements it was given', () => {
    const before = initialPlacements(bundle)
    const snapshot = structuredClone(before)

    run(step({ effect: 'deny', match: { match: 'all' } }), before)

    expect(before).toEqual(snapshot)
  })

  it('returns the same result for the same input, fifty times over', () => {
    const rules = step(
      { effect: 'deny', match: { match: 'signer', signers: [ATTACKER] } },
      { effect: 'prioritise', match: { match: 'account', accounts: [POOL] } },
    )
    const expected = JSON.stringify(run(rules))

    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(JSON.stringify(run(rules))).toBe(expected)
    }
  })

  it('rejects a placement that does not belong to the slot', () => {
    const stray: Placement = {
      index: 99,
      signature: 'sigjjxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      status: 'kept',
      timeMs: 0,
      changedBy: null,
      batch: null,
      prioritised: false,
    }

    expect(() => run(step({ effect: 'deny', match: { match: 'all' } }), [stray])).toThrow(
      /no transaction in slot/,
    )
  })
})
