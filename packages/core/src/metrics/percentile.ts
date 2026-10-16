export interface Percentiles {
  p10: number
  p50: number
  p90: number
  p95: number
  max: number
}

/**
 * Nearest rank: the zero-based position of the `percent` value among `count` sorted
 * values — the smallest value at or above that share of them. No interpolation — the
 * interpolated variant produces fractions, and this package keeps time in whole
 * milliseconds so that two machines cannot round a report differently.
 *
 * One definition for the package: a run's percentiles and a batch's pooled ones are
 * the same function of the same values, so a batch of one block reports exactly what
 * that block's run did.
 */
function nearestRank(count: number, percent: number): number {
  const rank = integerDivide(percent * count + 99, 100)
  const position = rank < 1 ? 0 : rank - 1

  return position < count ? position : count - 1
}

/** Percentiles of an ascending array. Empty gives zeros, which suits one run's metrics. */
export function percentilesOf(ascending: readonly number[]): Percentiles {
  const at = (percent: number) =>
    ascending.length === 0 ? 0 : (ascending[nearestRank(ascending.length, percent)] ?? 0)

  return { p10: at(10), p50: at(50), p90: at(90), p95: at(95), max: ascending.at(-1) ?? 0 }
}

/**
 * Percentiles of values given as `[value, count]` pairs ascending by value, without
 * expanding them: a hundred blocks of 1 500 transactions is 150 000 values, but at most
 * a few hundred distinct whole milliseconds. Null when there is nothing to count.
 */
export function percentilesOfCounts(
  counts: readonly (readonly [value: number, count: number])[],
): Percentiles | null {
  const total = counts.reduce((sum, [, count]) => sum + count, 0)
  if (total === 0) return null

  const at = (percent: number) => {
    const position = nearestRank(total, percent)
    let seen = 0
    for (const [value, count] of counts) {
      seen += count
      if (position < seen) return value
    }

    return counts.at(-1)?.[0] ?? 0
  }

  return { p10: at(10), p50: at(50), p90: at(90), p95: at(95), max: counts.at(-1)?.[0] ?? 0 }
}

/** Floor division without `Math`, which this package may not touch. */
export function integerDivide(value: number, by: number): number {
  return (value - (value % by)) / by
}
