import type { BatchReport, Percentiles } from '@ordercraft/core'

/**
 * The units a batch report counts in. Every one is a whole number as the kernel wrote
 * it; the decimal point is added here, on the way to the screen, and nowhere earlier.
 */
export type StripUnit = 'ms' | 'perMille' | 'count'

/**
 * One measure of the report, ready to draw as a distribution: p10 to p90 as a range,
 * p50 marked, p95 marked, `max` at the end — on an axis of its own, because a
 * millisecond and a share of the block do not belong on one scale.
 */
export interface Strip {
  key: string
  name: string
  /** What one value is, and across what — printed under the name. */
  note: string
  unit: StripUnit
  /**
   * `null` when the sample has nothing to take percentiles of — no transaction was
   * held, say — which is not the same as all of them being zero.
   */
  values: Percentiles | null
  /** The axis runs from 0 to here, in the strip's own unit. */
  top: number
  /** Where the axis is labelled, 0 and `top` included. */
  ticks: number[]
}

/**
 * The report's six distributions, in the order the eye should take them: what the
 * policy cost the transactions it touched, what it cost the block as a whole, then how
 * much of each block it changed and how much was there to change.
 */
export function stripsOf(report: BatchReport): Strip[] {
  const { transactions, perBlock } = report

  return [
    strip(
      'held',
      'Delay, held transactions',
      `ms · across the ${count(transactions.delayed)} the policy held`,
      'ms',
      report.heldDelayMs,
    ),
    strip(
      'added',
      'Added latency',
      `ms · across all ${count(transactions.included)} included`,
      'ms',
      report.addedDelayMs,
    ),
    strip(
      'reordered',
      'Reordered share',
      '% of a block’s included · one value per block',
      'perMille',
      perBlock.reorderedPerMille,
    ),
    strip(
      'deferred',
      'Deferred share',
      '% of a block’s recorded · one value per block',
      'perMille',
      perBlock.deferredPerMille,
    ),
    strip(
      'dropped',
      'Dropped share',
      '% of a block’s recorded · one value per block',
      'perMille',
      perBlock.droppedPerMille,
    ),
    strip(
      'triples',
      'Triples per block',
      'found in the recorded order · one value per block',
      'count',
      perBlock.triples,
    ),
  ]
}

/**
 * Whether a strip has anything to draw. A distribution that is zero from p10 to max
 * is a fact worth one line of text, and a chart of it would be an axis with a dot
 * at its origin.
 */
export function isFlat(values: Percentiles): boolean {
  return values.max === 0
}

/**
 * The axis for values up to `max`: the smallest step of 1, 2 or 5 × 10ⁿ that covers
 * `max` in at most five intervals, and never fewer than two — one interval is a
 * ruler with nothing written on it.
 */
export function axisFor(max: number): { top: number; ticks: number[] } {
  const target = Math.max(max, 1)
  let step = 1
  for (let magnitude = 1; ; magnitude *= 10) {
    const fit = [1, 2, 5].map((base) => base * magnitude).find((s) => target / s <= 5)
    if (fit !== undefined) {
      step = fit
      break
    }
  }

  const intervals = Math.max(2, Math.ceil(target / step))
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => index * step)

  return { top: intervals * step, ticks }
}

/** A value as the screen prints it, unit included. */
export function formatValue(value: number, unit: StripUnit): string {
  switch (unit) {
    case 'ms':
      return `${count(value)} ms`
    case 'perMille':
      return `${percent(value)} %`
    case 'count':
      return count(value)
  }
}

/** A tick label: bare numbers, with the unit on the last one only, as the canvas has it. */
export function formatTick(value: number, unit: StripUnit, top: number): string {
  const digits = unit === 'perMille' ? trimmedPercent(value) : count(value)
  if (value !== top || unit === 'count') return digits

  return `${digits} ${unit === 'ms' ? 'ms' : '%'}`
}

/** Per mille to a percentage with one decimal — the only rounding the report goes through. */
export function percent(perMille: number): string {
  return (perMille / 10).toFixed(1)
}

function trimmedPercent(perMille: number): string {
  return perMille % 10 === 0 ? String(perMille / 10) : percent(perMille)
}

const number = new Intl.NumberFormat('en-US')

function count(value: number): string {
  return number.format(value)
}

function strip(
  key: string,
  name: string,
  note: string,
  unit: StripUnit,
  values: Percentiles | null,
): Strip {
  const { top, ticks } = axisFor(values?.max ?? 0)

  return { key, name, note, unit, values, top, ticks }
}
