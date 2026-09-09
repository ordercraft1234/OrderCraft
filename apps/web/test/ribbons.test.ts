import type { Ordering, Placement } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { FIELD, ribbonsFor, rowCentre } from '../src/lib/ribbons.ts'

function placement(index: number, status: Placement['status'] = 'kept'): Placement {
  return {
    index,
    signature: `sig-${index}`,
    status,
    timeMs: 0,
    changedBy: null,
    batch: null,
    prioritised: false,
  }
}

function ordering(included: Placement[], excluded: Placement[] = []): Ordering {
  return { slot: 1, policyHash: 'hash', included, excluded }
}

describe('rowCentre', () => {
  it('puts a transaction in the middle of its own row', () => {
    expect(rowCentre(0, 2)).toBe(FIELD.height / 4)
    expect(rowCentre(1, 2)).toBe((FIELD.height * 3) / 4)
  })

  it('does not divide by an empty block', () => {
    expect(rowCentre(0, 0)).toBe(FIELD.height / 2)
  })
})

describe('ribbonsFor', () => {
  it('draws nothing when the policy changed no positions', () => {
    const kept = [placement(0), placement(1), placement(2)]

    expect(ribbonsFor(ordering(kept), 3)).toStrictEqual([])
  })

  it('draws a ribbon only for the transactions whose place changed', () => {
    // 2 jumped the queue; 0 and 1 are each one place later than they were.
    const ribbons = ribbonsFor(ordering([placement(2), placement(0), placement(1)]), 3)

    expect(ribbons.map((ribbon) => ribbon.index)).toStrictEqual([0, 1, 2])
    expect(ribbons.every((ribbon) => ribbon.kind === 'moved')).toBe(true)
    expect(ribbons.every((ribbon) => ribbon.tickY === null)).toBe(true)
  })

  /**
   * The same rule `runMetrics` uses. Measured against the recorded block instead,
   * dropping one transaction would shift every later one by a place and the field
   * would show a reordering that never happened.
   */
  it('measures position among the included, not against the recorded block', () => {
    const ribbons = ribbonsFor(ordering([placement(1), placement(2)], [placement(0, 'dropped')]), 3)

    expect(ribbons.filter((ribbon) => ribbon.kind === 'moved')).toStrictEqual([])
  })

  it('ends a dropped or deferred transaction short of the right column', () => {
    const ribbons = ribbonsFor(
      ordering([placement(1)], [placement(0, 'dropped'), placement(2, 'deferred')]),
      3,
    )

    expect(ribbons.map((ribbon) => ribbon.kind)).toStrictEqual(['dropped', 'deferred'])
    for (const ribbon of ribbons) {
      expect(ribbon.d.endsWith(`L ${FIELD.gap - FIELD.stubGap} ${ribbon.tickY}`)).toBe(true)
      expect(ribbon.tickY).not.toBeNull()
    }
  })

  it('starts a moved ribbon at the recorded row and lands it on the policy row', () => {
    const [ribbon] = ribbonsFor(ordering([placement(1), placement(0)]), 2)

    expect(ribbon?.index).toBe(0)
    expect(ribbon?.d.startsWith(`M 0 ${rowCentre(0, 2)} C`)).toBe(true)
    expect(ribbon?.d.endsWith(`${FIELD.gap} ${rowCentre(1, 2)}`)).toBe(true)
  })
})
