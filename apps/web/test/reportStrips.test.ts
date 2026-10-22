import { batchReportSchema } from '@ordercraft/shared'
import { describe, expect, it } from 'vitest'
import {
  axisFor,
  formatTick,
  formatValue,
  isFlat,
  percent,
  stripsOf,
} from '../src/lib/reportStrips.ts'
import { REPORT } from './fixtures/report.ts'

describe('the report fixture', () => {
  /** Strips drawn from a report the contract would refuse would test nothing real. */
  it('is a report the API could send', () => {
    expect(batchReportSchema.safeParse(REPORT).success).toBe(true)
  })
})

describe('stripsOf', () => {
  it('gives every distribution of the report one strip, in a fixed order', () => {
    expect(stripsOf(REPORT).map((strip) => strip.key)).toEqual([
      'held',
      'added',
      'reordered',
      'deferred',
      'dropped',
      'triples',
    ])
  })

  it('passes the kernel’s percentiles through untouched', () => {
    const [held, added, reordered] = stripsOf(REPORT)

    expect(held?.values).toEqual(REPORT.heldDelayMs)
    expect(added?.values).toEqual(REPORT.addedDelayMs)
    expect(reordered?.values).toEqual(REPORT.perBlock.reorderedPerMille)
  })

  /** Nothing to take percentiles of is not a row of zeros, and the strip must not say it is. */
  it('keeps an absent distribution absent', () => {
    const triples = stripsOf(REPORT).find((strip) => strip.key === 'triples')

    expect(triples?.values).toBeNull()
  })

  it('names the population each delay is taken across', () => {
    const [held, added] = stripsOf(REPORT)

    expect(held?.note).toContain('549')
    expect(added?.note).toContain('4,150')
  })

  it('puts each strip on an axis of its own that covers its maximum', () => {
    for (const strip of stripsOf(REPORT)) {
      if (strip.values === null) continue
      expect(strip.top).toBeGreaterThanOrEqual(strip.values.max)
      expect(strip.ticks[0]).toBe(0)
      expect(strip.ticks.at(-1)).toBe(strip.top)
    }
  })
})

describe('isFlat', () => {
  it('is true only when every value is zero', () => {
    expect(isFlat({ p10: 0, p50: 0, p90: 0, p95: 0, max: 0 })).toBe(true)
    // Pooled added latency under a speed bump: zero up to p95, one tail above it.
    expect(isFlat({ p10: 0, p50: 0, p90: 0, p95: 0, max: 118 })).toBe(false)
  })
})

describe('axisFor', () => {
  it('steps in 1, 2 or 5 × 10ⁿ, at most five intervals', () => {
    expect(axisFor(391)).toEqual({ top: 400, ticks: [0, 100, 200, 300, 400] })
    expect(axisFor(410)).toEqual({ top: 500, ticks: [0, 100, 200, 300, 400, 500] })
    expect(axisFor(518)).toEqual({ top: 600, ticks: [0, 200, 400, 600] })
    expect(axisFor(14)).toEqual({ top: 15, ticks: [0, 5, 10, 15] })
  })

  it('never draws a single interval', () => {
    expect(axisFor(1)).toEqual({ top: 2, ticks: [0, 1, 2] })
    expect(axisFor(0)).toEqual({ top: 2, ticks: [0, 1, 2] })
    expect(axisFor(200)).toEqual({ top: 200, ticks: [0, 50, 100, 150, 200] })
  })

  /** A share can reach the whole block and the axis must not run past it. */
  it('never runs a share past the whole block', () => {
    for (let max = 0; max <= 1000; max += 1) expect(axisFor(max).top).toBeLessThanOrEqual(1000)
  })

  it('covers every maximum it is given', () => {
    for (const max of [3, 7, 99, 101, 999, 1001, 12_345, 400_000]) {
      const { top, ticks } = axisFor(max)
      expect(top).toBeGreaterThanOrEqual(max)
      expect(ticks.length - 1).toBeLessThanOrEqual(5)
    }
  })
})

describe('formatting', () => {
  it('adds the decimal point to a share on the way to the screen, and only there', () => {
    expect(percent(441)).toBe('44.1')
    expect(percent(0)).toBe('0.0')
    expect(formatValue(518, 'perMille')).toBe('51.8 %')
  })

  it('prints delays in whole milliseconds and counts as counts', () => {
    expect(formatValue(1284, 'ms')).toBe('1,284 ms')
    expect(formatValue(2, 'count')).toBe('2')
  })

  it('puts the unit on the last tick only', () => {
    expect(formatTick(200, 'ms', 400)).toBe('200')
    expect(formatTick(400, 'ms', 400)).toBe('400 ms')
    expect(formatTick(200, 'perMille', 600)).toBe('20')
    expect(formatTick(600, 'perMille', 600)).toBe('60 %')
    expect(formatTick(5, 'perMille', 15)).toBe('0.5')
    expect(formatTick(15, 'count', 15)).toBe('15')
  })
})
