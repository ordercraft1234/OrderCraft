import type { Ordering } from '@ordercraft/core'
import { useMemo } from 'react'
import { FIELD, type Ribbon, ribbonsFor } from '../lib/ribbons.ts'

interface RibbonFieldProps {
  ordering: Ordering
  /** Transactions the block recorded — the height of the left column. */
  recorded: number
}

/**
 * Two orderings of one block, and what the policy did between them.
 *
 * The columns are HTML beside the drawing rather than shapes inside it. The field has
 * to stretch with the page — that is the whole picture — but a column stretched with
 * it would become a band, so only the part that should stretch is inside the SVG, and
 * the strokes are told not to scale.
 *
 * Both columns are drawn as one block of ink each, not one bar per transaction. At
 * 1,400 transactions a bar is 0.4 px: the bars tile with no gap between them, so a
 * thousand of them paint exactly the rectangle a single one does, and cost a thousand
 * nodes to do it.
 */
export function RibbonField({ ordering, recorded }: RibbonFieldProps) {
  const ribbons = useMemo(() => ribbonsFor(ordering, recorded), [ordering, recorded])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <ColumnLabel>Baseline</ColumnLabel>
        <ColumnLabel>Under policy</ColumnLabel>
      </div>

      <div className="flex items-stretch" style={{ height: FIELD.height }}>
        <Column count={recorded} />
        <svg
          viewBox={`0 0 ${FIELD.gap} ${FIELD.height}`}
          preserveAspectRatio="none"
          className="h-full flex-1"
          role="img"
          aria-label={`${ribbons.length} transactions the policy moved or left out of the block`}
        >
          <title>Ribbon field</title>
          {ribbons.map((ribbon) => (
            <RibbonPath key={ribbon.index} ribbon={ribbon} />
          ))}
        </svg>
        <Column count={ordering.included.length} />
      </div>
    </div>
  )
}

/**
 * Opacities, measured on the shipped slot rather than taken from the brief.
 *
 * The brief's 18 % was written for 547 ribbons on a canvas. A real policy moves most
 * of the block — a delay applied to 57 transactions pushes everything behind them back
 * a place — and 795 near-horizontal strokes at 18 % stack into one indigo rectangle.
 * The instruction that survives is the one the brief gave for exactly this case: lower
 * the opacity, never drop ribbons.
 *
 * A stub is quieter than a ribbon and its tick is louder: the line only says where the
 * transaction was, the tick says it did not arrive.
 */
const INK = {
  moved: { width: 0.75, opacity: 0.07 },
  stub: { width: 0.75, opacity: 0.16 },
  tick: { width: 1, opacity: 0.55 },
} as const

function RibbonPath({ ribbon }: { ribbon: Ribbon }) {
  const line = ribbon.kind === 'moved' ? INK.moved : INK.stub

  // `vector-effect` is not inherited, so it goes on every shape rather than on the
  // group. Without it the field's horizontal stretch — 220 units drawn across some
  // 1,100 px — scales the stroke with the geometry, and the tick, being vertical,
  // comes out five times its width.
  return (
    <g className="text-moved" stroke="currentColor">
      <path
        d={ribbon.d}
        fill="none"
        strokeWidth={line.width}
        strokeOpacity={line.opacity}
        vectorEffect="non-scaling-stroke"
      />
      {ribbon.tickY === null ? null : (
        <line
          x1={FIELD.gap - FIELD.stubGap}
          x2={FIELD.gap - FIELD.stubGap}
          y1={ribbon.tickY - 1.5}
          y2={ribbon.tickY + 1.5}
          strokeWidth={INK.tick.width}
          strokeOpacity={INK.tick.opacity}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  )
}

/** One column of the field: the block as a texture, never as a list. */
function Column({ count }: { count: number }) {
  return (
    <div
      className="h-full shrink-0 bg-ink/[0.12]"
      style={{ width: FIELD.columnWidth }}
      title={`${count} transactions`}
    />
  )
}

function ColumnLabel({ children }: { children: string }) {
  return <span className="text-[11px] uppercase tracking-[0.16em] text-muted">{children}</span>
}
