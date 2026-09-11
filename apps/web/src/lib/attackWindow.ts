import type { Ordering, Sandwich } from '@ordercraft/core'

/** How far either side of the triple the zoomed field reaches, from the brief. */
export const WINDOW = 12

export type Role = 'front' | 'victim' | 'back' | 'bystander'

export interface WindowRow {
  /** Position in the recorded block. */
  index: number
  role: Role
  /** Row in the left column, from 0. */
  from: number
  /** Row in the right column, or `null` when the policy left it out of the block. */
  to: number | null
  /** Why it is not in the right column: the placement's own status. */
  left: 'dropped' | 'deferred' | null
}

/**
 * The transactions the zoomed field draws, and where each one sits on both sides.
 *
 * The window is positions, not time: `± 12` around the triple as the block recorded it.
 * Transactions the policy moved into the window from outside it are deliberately absent
 * — the picture is about what happened to these three and their neighbours, and a row
 * arriving from position 900 would be a line from off-screen.
 */
export function attackWindow(
  sandwich: Sandwich,
  ordering: Ordering,
  recorded: number,
): WindowRow[] {
  const first = clamp(sandwich.front - WINDOW, recorded)
  const last = clamp(sandwich.back + WINDOW, recorded)

  const position = new Map(ordering.included.map((placement, place) => [placement.index, place]))
  const excluded = new Map(ordering.excluded.map((placement) => [placement.index, placement]))
  const inWindow = ordering.included
    .filter((placement) => placement.index >= first && placement.index <= last)
    .map((placement) => placement.index)

  const rows: WindowRow[] = []
  for (let index = first; index <= last; index++) {
    const gone = excluded.get(index)
    const place = position.get(index)

    rows.push({
      index,
      role: roleOf(sandwich, index),
      from: index - first,
      // Rows on the right are numbered inside the window, not in the whole block: the
      // field is a picture of these thirty-odd transactions, and their absolute
      // positions are printed beside them rather than drawn.
      to: place === undefined ? null : inWindow.indexOf(index),
      left: gone === undefined || gone.status === 'kept' ? null : gone.status,
    })
  }

  return rows
}

function roleOf(sandwich: Sandwich, index: number): Role {
  if (index === sandwich.front) return 'front'
  if (index === sandwich.back) return 'back'
  if (sandwich.victims.includes(index)) return 'victim'

  return 'bystander'
}

function clamp(value: number, recorded: number): number {
  if (value < 0) return 0

  return value > recorded - 1 ? recorded - 1 : value
}
