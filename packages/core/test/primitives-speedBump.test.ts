import { describe, expect, it } from 'vitest'
import { type Placement, initialPlacements } from '../src/primitives/placement.ts'
import { type SpeedBumpStep, speedBump } from '../src/primitives/speedBump.ts'
import { AMM, ATTACKER, VICTIM, VOTE, bundleOf, tx } from './helpers/build.ts'

const bump = (delayMs: number, appliesTo: SpeedBumpStep['appliesTo'] = { match: 'all' }) =>
  ({ kind: 'speedBump', delayMs, appliesTo }) satisfies SpeedBumpStep

// Four transactions, so arrivals fall on 0 / 100 / 200 / 300.
const bundle = bundleOf([
  tx(0, { signers: [ATTACKER] }),
  tx(1, { signers: [VICTIM] }),
  tx(2, { signers: [ATTACKER] }),
  tx(3, { signers: [VICTIM], programs: [VOTE], accounts: [VICTIM, VOTE] }),
])

const run = (step: SpeedBumpStep, placements: Placement[] = initialPlacements(bundle)) =>
  speedBump(bundle, placements, step)

describe('speedBump', () => {
  it('shifts the whole matched class by the delay', () => {
    expect(run(bump(50)).map((placement) => placement.timeMs)).toEqual([50, 150, 250, 350])
  })

  it('leaves transactions outside the class where they were', () => {
    const after = run(bump(50, { match: 'signer', signers: [ATTACKER] }))

    expect(after.map((placement) => placement.timeMs)).toEqual([50, 100, 250, 300])
    expect(after.map((placement) => placement.changedBy)).toEqual([
      'speedBump',
      null,
      'speedBump',
      null,
    ])
  })

  it('lets the delayed class fall behind transactions it used to precede', () => {
    const after = run(bump(150, { match: 'signer', signers: [ATTACKER] }))

    // Index 0 was first and now sits after index 1: the bump changed the order, which
    // is the whole point of the primitive.
    expect(after.map((placement) => placement.timeMs)).toEqual([150, 100, 350, 300])
  })

  it('defers a transaction pushed to the end of the slot, and does not call it dropped', () => {
    const after = run(bump(100))

    expect(after.map((placement) => placement.status)).toEqual(['kept', 'kept', 'kept', 'deferred'])
    expect(after[3]?.timeMs).toBe(400)
  })

  it('treats the slot boundary as exclusive', () => {
    expect(run(bump(99))[3]?.status).toBe('kept')
    expect(run(bump(100))[3]?.status).toBe('deferred')
  })

  it('is a no-op at zero delay, and claims no credit for it', () => {
    const before = initialPlacements(bundle)
    const after = run(bump(0), before)

    expect(after).toEqual(before)
    expect(after.every((placement) => placement.changedBy === null)).toBe(true)
  })

  it('does not delay a transaction another step already removed', () => {
    const before = initialPlacements(bundle).map((placement) =>
      placement.index === 1
        ? { ...placement, status: 'dropped' as const, changedBy: 'allowDeny' as const }
        : placement,
    )
    const after = run(bump(50), before)

    expect(after[1]).toEqual(before[1])
    expect(after[0]?.timeMs).toBe(50)
  })

  it('does not push a deferred transaction further', () => {
    const once = run(bump(200))
    const twice = run(bump(200), once)

    expect(once.map((placement) => placement.status)).toEqual([
      'kept',
      'kept',
      'deferred',
      'deferred',
    ])
    // Indices 2 and 3 were already out and keep the time they were deferred at;
    // only the two still in the block move again.
    expect(twice.map((placement) => placement.timeMs)).toEqual([400, 500, 400, 500])
    expect(twice.map((placement) => placement.status)).toEqual([
      'deferred',
      'deferred',
      'deferred',
      'deferred',
    ])
  })

  it('composes: two bumps on different classes add up independently', () => {
    const once = run(bump(30, { match: 'signer', signers: [ATTACKER] }))
    const twice = run(bump(20, { match: 'signer', signers: [VICTIM] }), once)

    expect(twice.map((placement) => placement.timeMs)).toEqual([30, 120, 230, 320])
  })

  it('takes a delayed transaction out of the batch it was settling in', () => {
    const batched = initialPlacements(bundle).map((placement) => ({
      ...placement,
      batch: 200,
      timeMs: 200,
    }))
    const after = run(bump(50, { match: 'signer', signers: [ATTACKER] }), batched)

    // It no longer settles with the others, so the model must stop saying it does.
    expect(after.map((placement) => placement.batch)).toEqual([null, 200, null, 200])
  })

  it('does not mutate the placements it was given', () => {
    const before = initialPlacements(bundle)
    const snapshot = structuredClone(before)

    run(bump(50), before)

    expect(before).toEqual(snapshot)
  })

  it('returns the same result for the same input, fifty times over', () => {
    const step = bump(70, { match: 'program', programs: [AMM] })
    const expected = JSON.stringify(run(step))

    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(JSON.stringify(run(step))).toBe(expected)
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
    }

    expect(() => run(bump(50), [stray])).toThrow(/no transaction in slot/)
  })
})
