import type { WindowRow } from '../lib/attackWindow.ts'

const ROW = 20
const LABEL = 54
const COLUMN = 28
const LEFT = LABEL + 6
const RIGHT = 540
const WIDTH = RIGHT + COLUMN + 6 + LABEL

/**
 * The ribbon field at the only zoom where a transaction is a transaction.
 *
 * Nothing is stretched here: at thirty-odd rows the picture is small enough to draw at
 * its own size, and the numbers beside each row are the point of the screen. The wide
 * field on the comparison screen is the same idea with the labels taken away, because
 * fourteen hundred of them would not fit.
 */
export function AttackField({ rows }: { rows: WindowRow[] }) {
  // The picture scrolls inside its own box rather than shrinking with the page: at
  // 375 px wide the row numbers become four pixels tall, and a diagram whose labels
  // cannot be read is not a smaller diagram.
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <svg
        viewBox={`0 0 ${WIDTH} ${rows.length * ROW + ROW}`}
        className="h-auto w-full min-w-[560px] max-w-[720px]"
        role="img"
        aria-label={`${rows.length} transactions around the triple, before and after the policy`}
      >
        <title>One attack, before and after</title>
        <text
          x={LEFT + COLUMN}
          y={12}
          className="fill-muted text-[9px] uppercase tracking-[0.16em]"
        >
          baseline
        </text>
        <text
          x={RIGHT}
          y={12}
          textAnchor="end"
          className="fill-muted text-[9px] uppercase tracking-[0.16em]"
        >
          under policy
        </text>

        {rows.map((row) => (
          <Row key={row.index} row={row} />
        ))}
      </svg>
    </div>
  )
}

function Row({ row }: { row: WindowRow }) {
  const marked = row.role !== 'bystander'
  const from = centre(row.from)

  return (
    <g className={marked ? 'text-extracted' : 'text-moved'}>
      <text x={LABEL} y={from + 3} textAnchor="end" className="fill-muted text-[9px] tabular-nums">
        {row.index}
      </text>
      <Mark x={LEFT} y={from} marked={marked} />
      {row.to === null ? (
        <Gone y={from} status={row.left} role={row.role} marked={marked} />
      ) : (
        <Crossing from={from} to={centre(row.to)} role={row.role} marked={marked} />
      )}
    </g>
  )
}

/** Where a transaction sits in one of the two columns. */
function Mark({ x, y, marked }: { x: number; y: number; marked: boolean }) {
  return (
    <line
      x1={x}
      x2={x + COLUMN}
      y1={y}
      y2={y}
      stroke="currentColor"
      strokeWidth={marked ? 2 : 1}
      strokeOpacity={marked ? 1 : 0.35}
    />
  )
}

/** A transaction the policy kept: a ribbon to its new row, and the row itself. */
function Crossing({
  from,
  to,
  role,
  marked,
}: { from: number; to: number; role: WindowRow['role']; marked: boolean }) {
  const control = (RIGHT - LEFT - COLUMN) / 2

  return (
    <>
      <path
        d={`M ${LEFT + COLUMN} ${from} C ${LEFT + COLUMN + control} ${from}, ${RIGHT - control} ${to}, ${RIGHT} ${to}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={marked ? 1.5 : 0.75}
        strokeOpacity={marked ? 1 : 0.3}
      />
      <Mark x={RIGHT} y={to} marked={marked} />
      {marked ? (
        <text
          x={RIGHT + COLUMN + 6}
          y={to + 3}
          className="fill-muted text-[9px] uppercase tracking-[0.12em]"
        >
          {role}
        </text>
      ) : null}
    </>
  )
}

/** A transaction the policy left out of the block: a stub, its tick, and which of the two it was. */
function Gone({
  y,
  status,
  role,
  marked,
}: { y: number; status: WindowRow['left']; role: WindowRow['role']; marked: boolean }) {
  const end = RIGHT - 20

  return (
    <g stroke="currentColor" strokeOpacity={marked ? 0.8 : 0.3}>
      <path d={`M ${LEFT + COLUMN} ${y} L ${end} ${y}`} fill="none" />
      <line x1={end} x2={end} y1={y - 3} y2={y + 3} strokeWidth={1.5} />
      <text
        x={end + 6}
        y={y + 3}
        stroke="none"
        className="fill-muted text-[9px] uppercase tracking-[0.12em]"
      >
        {marked ? `${role} · ${status}` : status}
      </text>
    </g>
  )
}

function centre(row: number): number {
  return row * ROW + ROW
}
