import { describe, expect, it } from 'vitest'
import { tripleOutcome } from '../src/detect/broken.ts'
import type { Sandwich } from '../src/detect/sandwich.ts'
import type { Ordering } from '../src/order/apply.ts'
import type { Placement } from '../src/primitives/placement.ts'

const sandwich: Sandwich = {
  front: 10,
  victims: [11],
  back: 12,
  signer: 'attacker',
  mint: 'mint',
  shared: ['pool'],
}

function placed(index: number, overrides: Partial<Placement> = {}): Placement {
  return {
    index,
    signature: `sig${index}`,
    status: 'kept',
    timeMs: index,
    changedBy: null,
    batch: null,
    prioritised: false,
    ...overrides,
  }
}

function ordering(included: Placement[], excluded: Placement[] = []): Ordering {
  return { slot: 1, policyHash: 'hash', included, excluded }
}

describe('tripleOutcome', () => {
  it('says the attack survives when the policy left the three where they were', () => {
    const untouched = ordering([placed(9), placed(10), placed(11), placed(12)])

    expect(tripleOutcome(sandwich, untouched)).toStrictEqual({
      broken: false,
      reason: null,
      by: null,
    })
  })

  it('names the primitive that refused a leg', () => {
    const denied = ordering(
      [placed(9), placed(11), placed(12)],
      [placed(10, { status: 'dropped', changedBy: 'allowDeny' })],
    )

    expect(tripleOutcome(sandwich, denied)).toStrictEqual({
      broken: true,
      reason: 'legLeftBlock',
      by: 'allowDeny',
    })
  })

  it('counts a leg pushed past the end of the slot as gone', () => {
    const deferred = ordering(
      [placed(10), placed(11)],
      [placed(12, { status: 'deferred', changedBy: 'speedBump' })],
    )

    expect(tripleOutcome(sandwich, deferred)).toMatchObject({
      broken: true,
      reason: 'legLeftBlock',
      by: 'speedBump',
    })
  })

  /**
   * The attack needs somebody in the middle. When the policy takes every one of them
   * out, the pair is left surrounding nothing — broken, and for a reason worth naming
   * separately from a leg leaving.
   */
  it('says so when the transaction between them is the one that left', () => {
    const gone = ordering(
      [placed(10), placed(12)],
      [placed(11, { status: 'dropped', changedBy: 'allowDeny' })],
    )

    expect(tripleOutcome(sandwich, gone)).toStrictEqual({
      broken: true,
      reason: 'victimsLeftBlock',
      by: 'allowDeny',
    })
  })

  /**
   * Inside one settlement group the model has no "before" and "after" to sell, so a
   * batch breaks the triple even though the order on screen is unchanged.
   */
  it('reads one settlement group as broken even with the order intact', () => {
    const batched = ordering([
      placed(10, { timeMs: 250, batch: 250, changedBy: 'batchAuction' }),
      placed(11, { timeMs: 250, batch: 250, changedBy: 'batchAuction' }),
      placed(12, { timeMs: 250, batch: 250, changedBy: 'batchAuction' }),
    ])

    expect(tripleOutcome(sandwich, batched)).toStrictEqual({
      broken: true,
      reason: 'sameBatch',
      by: 'batchAuction',
    })
  })

  it('is not fooled by two of the three settling together', () => {
    const partial = ordering([
      placed(10, { timeMs: 250, batch: 250, changedBy: 'batchAuction' }),
      placed(11, { timeMs: 250, batch: 250, changedBy: 'batchAuction' }),
      placed(12, { timeMs: 300 }),
    ])

    expect(tripleOutcome(sandwich, partial).reason).not.toBe('sameBatch')
  })

  it('breaks the triple when nobody is left between the legs', () => {
    const moved = ordering([
      placed(11),
      placed(10, { timeMs: 120, changedBy: 'speedBump' }),
      placed(12, { timeMs: 130 }),
    ])

    expect(tripleOutcome(sandwich, moved)).toStrictEqual({
      broken: true,
      reason: 'orderChanged',
      by: 'speedBump',
    })
  })

  /**
   * A policy that puts the back-run first has not left the attack intact — it has left
   * the attacker buying after it sold.
   */
  it('breaks the triple when the legs swapped around the victim', () => {
    const swapped = ordering([
      placed(12, { timeMs: 5, prioritised: true, changedBy: 'allowDeny' }),
      placed(11),
      placed(10),
    ])

    expect(tripleOutcome(sandwich, swapped)).toStrictEqual({
      broken: true,
      reason: 'orderChanged',
      by: 'allowDeny',
    })
  })

  it('leaves the attack standing when the three moved together', () => {
    const shifted = ordering([
      placed(9),
      placed(10, { timeMs: 120, changedBy: 'speedBump' }),
      placed(11, { timeMs: 121, changedBy: 'speedBump' }),
      placed(12, { timeMs: 122, changedBy: 'speedBump' }),
    ])

    expect(tripleOutcome(sandwich, shifted).broken).toBe(false)
  })
})
