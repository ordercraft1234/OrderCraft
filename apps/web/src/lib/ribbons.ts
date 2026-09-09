import type { Ordering, Placement } from '@ordercraft/core'

/**
 * Sizes from `docs/m0-design-brief.md`. A column is the same height whatever the block
 * holds — 1,400 transactions and 400 both fill it — because the field compares two
 * orderings of one block, not two blocks.
 */
export const FIELD = {
  height: 560,
  columnWidth: 28,
  /** Width of the drawn field. The columns are laid out beside it, not inside it. */
  gap: 220,
  /** How far short of the right column a stub stops, with its tick at the end. */
  stubGap: 20,
} as const

/**
 * `moved` is a ribbon across the field; `dropped` and `deferred` are stubs that stop
 * short of the right column, because the transaction has no position there to land on.
 * `delayed` is deliberately absent: a transaction the policy delayed without moving
 * anyone past it draws nothing, and the counts row is where that shows up.
 */
export type RibbonKind = 'moved' | 'dropped' | 'deferred'

export interface Ribbon {
  /** Position in the recorded block — unique, so it doubles as the render key. */
  index: number
  kind: RibbonKind
  /** SVG path from the left column to either the right column or the stub tick. */
  d: string
  /** Where the stub's 3 px tick goes, or `null` for a ribbon that crosses. */
  tickY: number | null
}

/**
 * The field, as paths.
 *
 * Geometry is separated from the component so it can be tested without a DOM — the
 * rest of this app tests the same way, and a curve is easier to check as four numbers
 * than as a rendered pixel.
 */
export function ribbonsFor(ordering: Ordering, recorded: number): Ribbon[] {
  const included = ordering.included
  // The field's own coordinates start where the left column ends: the columns are
  // rendered beside the drawing, so the picture can stretch horizontally with the
  // page while the columns stay 28 px wide and crisp.
  const leftX = 0
  const rightX = FIELD.gap
  const control = FIELD.gap / 2

  // Same rule as `runMetrics`: a transaction moved when its place among the included
  // ones changed. Measured against the recorded block instead, dropping one
  // transaction would shift every later one and the field would show a reordering
  // that never happened.
  const byRecordedOrder = [...included].sort((left, right) => left.index - right.index)

  const moved = included.flatMap((placement, position) => {
    if (byRecordedOrder[position]?.index === placement.index) return []

    const fromY = rowCentre(placement.index, recorded)
    const toY = rowCentre(position, included.length)

    return [
      {
        index: placement.index,
        kind: 'moved' as const,
        d: `M ${leftX} ${fromY} C ${leftX + control} ${fromY}, ${rightX - control} ${toY}, ${rightX} ${toY}`,
        tickY: null,
      },
    ]
  })

  const left = ordering.excluded.map((placement) => {
    const y = rowCentre(placement.index, recorded)
    const endX = rightX - FIELD.stubGap

    return {
      index: placement.index,
      kind: kindOf(placement),
      d: `M ${leftX} ${y} L ${endX} ${y}`,
      tickY: y,
    }
  })

  return [...moved, ...left].sort((first, second) => first.index - second.index)
}

/**
 * Where a transaction sits in a column of `count` rows: the middle of its own row.
 * The edge would put the first transaction on the column's border and the last one a
 * row below the bottom.
 */
export function rowCentre(position: number, count: number): number {
  if (count <= 0) return FIELD.height / 2

  return ((position + 0.5) * FIELD.height) / count
}

function kindOf(placement: Placement): RibbonKind {
  return placement.status === 'dropped' ? 'dropped' : 'deferred'
}
