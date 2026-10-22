import type { Percentiles } from '@ordercraft/core'
import {
  Bar,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { type Strip, type StripUnit, formatTick, formatValue } from '../lib/reportStrips.ts'

interface DistributionStripProps {
  strip: Strip
  values: Percentiles
}

/** The single row each strip is drawn on. */
const ROW = 'row'

/**
 * One distribution as the canvas draws it: a thin line from p10 to p90, a block at
 * p50, a tick at p95 in the colour the product uses for what the policy did, and a
 * dashed tick at the maximum — on an axis of the measure's own.
 *
 * Colour comes from the palette classes rather than from hex values written here, the
 * same way the ribbon field takes it: the SVG strokes are `currentColor`, the class on
 * the group says which colour that is. The axis is styled in `index.css` under
 * `.distribution`, for the same reason.
 *
 * Every mark is a shape function, not a component mounted inside the chart: Recharts
 * only renders the children it recognises, and anything else is dropped without a
 * word in the console.
 */
export function DistributionStrip({ strip, values }: DistributionStripProps) {
  const data = [{ row: ROW, range: [values.p10, values.p90] }]

  return (
    <div className="distribution h-[56px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          layout="vertical"
          data={data}
          margin={{ top: 14, right: 18, bottom: 0, left: 18 }}
        >
          <XAxis
            type="number"
            domain={[0, strip.top]}
            ticks={strip.ticks}
            tickFormatter={(value: number) => formatTick(value, strip.unit, strip.top)}
            tickSize={5}
            fontSize={9}
            interval={0}
            allowDataOverflow
          />
          <YAxis type="category" dataKey="row" hide />
          <Tooltip
            cursor={false}
            isAnimationActive={false}
            content={() => readout(values, strip.unit)}
          />
          <Bar dataKey="range" barSize={2} isAnimationActive={false} shape={rangeLine} />
          <ReferenceLine
            x={values.max}
            ifOverflow="hidden"
            className="text-muted"
            stroke="currentColor"
            strokeDasharray="2 2"
          />
          <ReferenceLine
            x={values.p95}
            className="text-moved"
            stroke="currentColor"
            label={{ value: 'p95', position: 'top', fontSize: 9, fill: 'currentColor' }}
          />
          <ReferenceDot x={values.p50} y={ROW} shape={medianBlock} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

interface BoxProps {
  x?: number
  y?: number
  width?: number
  height?: number
}

function rangeLine({ x = 0, y = 0, width = 0, height = 0 }: BoxProps) {
  return <rect x={x} y={y} width={Math.max(width, 0)} height={height} className="fill-ink" />
}

function medianBlock({ cx = 0, cy = 0 }: { cx?: number; cy?: number }) {
  return <rect x={cx - 3} y={cy - 6} width={6} height={12} className="fill-ink" />
}

/** The tooltip: every percentile, in the strip's unit, in ink rather than in mark colour. */
function readout(values: Percentiles, unit: StripUnit) {
  const rows: [string, number][] = [
    ['p10', values.p10],
    ['p50', values.p50],
    ['p90', values.p90],
    ['p95', values.p95],
    ['max', values.max],
  ]

  return (
    <div className="border border-hairline bg-panel px-3 py-2 text-[11px]">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <span className="text-muted">{label}</span>
          <span>{formatValue(value, unit)}</span>
        </div>
      ))}
    </div>
  )
}
