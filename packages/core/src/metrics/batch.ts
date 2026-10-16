import type { BrokenReason, TripleOutcome } from '../detect/broken.ts'
import type { Ordering } from '../order/apply.ts'
import { PRIMITIVES, type PrimitiveKind } from '../policy/schema.ts'
import type { SlotBundle } from '../slot/schema.ts'
import { type Percentiles, integerDivide, percentilesOfCounts } from './percentile.ts'
import { type RunMetrics, addedDelays, runMetrics } from './run.ts'

/**
 * What a batch keeps of one finished run: small enough to hold a hundred of in memory,
 * and enough to pool the added delay exactly rather than averaging the run's own
 * percentiles — a median of medians is not the median of anything.
 */
export interface BatchEntry {
  slot: number
  policyHash: string
  metrics: RunMetrics
  /**
   * Added delay over the run's included transactions as `[ms, count]`, ascending by ms,
   * every count positive. Whole milliseconds, so a block of 1 500 transactions is a few
   * hundred pairs.
   */
  addedDelayCounts: [ms: number, count: number][]
  /** One outcome per triple found in the baseline, in the run's order. */
  triples: TripleOutcome[]
}

export interface BatchTransactions {
  recorded: number
  included: number
  deferred: number
  dropped: number
  moved: number
  delayed: number
}

export interface BatchTriples {
  found: number
  broken: number
  /** Found and not broken — the attack remains possible under the policy. */
  possible: number
  /** Broken triples by the primitive the placement names; `unattributed` when none does. */
  byPrimitive: Record<PrimitiveKind | 'unattributed', number>
  byReason: Record<BrokenReason, number>
}

export interface BatchReport {
  policyHash: string
  /** The sample. Every number below is about these blocks and no others. */
  blocks: number
  /** The slots counted, ascending. */
  slots: number[]
  transactions: BatchTransactions
  /**
   * Added delay per transaction, pooled over every included transaction of every block.
   * Like a run's, it leaves deferred transactions out and so flatters a policy that
   * defers its worst cases — `transactions.deferred` and `perBlock.deferredPerMille`
   * stand beside it for that reason. Null when no block included anything.
   */
  addedDelayMs: Percentiles | null
  /**
   * Added delay among the transactions the policy held at all — `transactions.delayed` of
   * them. A policy aimed at a class holds a few percent of a block, so over everyone its
   * percentiles sit at zero and say nothing about how long the class waited; this says
   * that, and the count beside it says how rare it is. Null when nobody was held.
   */
  heldDelayMs: Percentiles | null
  /**
   * Distributions **over blocks**: one value per block, so a block of 200 transactions
   * weighs the same as one of 1 500. Shares are in parts per thousand of the block's
   * own count, floored. Null when the batch counted no block.
   */
  perBlock: {
    /** Of the block's included transactions. */
    reorderedPerMille: Percentiles | null
    /** Of the block's recorded transactions. */
    deferredPerMille: Percentiles | null
    /** Of the block's recorded transactions. */
    droppedPerMille: Percentiles | null
    /** Triples found in the block's baseline. */
    triples: Percentiles | null
  }
  triples: BatchTriples
  /** Blocks where no transaction moved, waited, left the slot or was refused. */
  unchangedBlocks: number
}

/** Summarises one run for a batch. The ordering has to be this slot's. */
export function batchEntry(
  bundle: SlotBundle,
  ordering: Ordering,
  triples: readonly TripleOutcome[],
): BatchEntry {
  if (ordering.slot !== bundle.slot) {
    throw new Error(`ordering is for slot ${ordering.slot}, not slot ${bundle.slot}`)
  }

  const addedDelayCounts: [number, number][] = []
  for (const delay of addedDelays(bundle, ordering)) {
    const last = addedDelayCounts.at(-1)
    if (last !== undefined && last[0] === delay) last[1] += 1
    else addedDelayCounts.push([delay, 1])
  }

  return {
    slot: bundle.slot,
    policyHash: ordering.policyHash,
    metrics: runMetrics(bundle, ordering),
    addedDelayCounts,
    triples: triples.map((outcome) => ({ ...outcome })),
  }
}

/**
 * The aggregated report over a set of runs of one policy (FR-016): distributions, not
 * averages.
 *
 * A wider sample of the same model, not a measurement of anything the model leaves out —
 * arrival times are still `arrival(i) = floor(i × 400 / N)` in every block counted.
 *
 * The runs of a batch finish in any order and a cancelled batch reports whatever had
 * finished (FR-017), so the report depends on the set of entries and not on their order:
 * they are sorted by slot first, and a slot given twice is refused rather than counted
 * twice.
 */
export function batchReport(policyHash: string, entries: readonly BatchEntry[]): BatchReport {
  const sorted = [...entries].sort((left, right) => left.slot - right.slot)

  for (const [position, entry] of sorted.entries()) {
    if (entry.policyHash !== policyHash) {
      throw new Error(
        `slot ${entry.slot} was run under policy ${entry.policyHash}, not ${policyHash}`,
      )
    }
    if (position > 0 && sorted[position - 1]?.slot === entry.slot) {
      throw new Error(`slot ${entry.slot} is counted twice`)
    }
  }

  const sum = (field: keyof BatchTransactions) =>
    sorted.reduce((total, entry) => total + entry.metrics[field], 0)

  const delays = mergeCounts(sorted.map((entry) => entry.addedDelayCounts))

  const perMille = (part: number, whole: number) =>
    whole === 0 ? 0 : integerDivide(part * 1000, whole)

  return {
    policyHash,
    blocks: sorted.length,
    slots: sorted.map((entry) => entry.slot),
    transactions: {
      recorded: sum('recorded'),
      included: sum('included'),
      deferred: sum('deferred'),
      dropped: sum('dropped'),
      moved: sum('moved'),
      delayed: sum('delayed'),
    },
    addedDelayMs: percentilesOfCounts(delays),
    heldDelayMs: percentilesOfCounts(delays.filter(([ms]) => ms > 0)),
    perBlock: {
      reorderedPerMille: overBlocks(sorted, (entry) => entry.metrics.reorderedPerMille),
      deferredPerMille: overBlocks(sorted, (entry) =>
        perMille(entry.metrics.deferred, entry.metrics.recorded),
      ),
      droppedPerMille: overBlocks(sorted, (entry) =>
        perMille(entry.metrics.dropped, entry.metrics.recorded),
      ),
      triples: overBlocks(sorted, (entry) => entry.triples.length),
    },
    triples: tripleTotals(sorted),
    unchangedBlocks: sorted.filter(({ metrics }) => {
      return (
        metrics.moved === 0 &&
        metrics.delayed === 0 &&
        metrics.deferred === 0 &&
        metrics.dropped === 0
      )
    }).length,
  }
}

/** One value per block, counted into the same `[value, count]` form the delays use. */
function overBlocks(
  entries: readonly BatchEntry[],
  pick: (entry: BatchEntry) => number,
): Percentiles | null {
  const values = entries.map(pick).sort((left, right) => left - right)
  return percentilesOfCounts(mergeCounts([values.map((value): [number, number] => [value, 1])]))
}

/** Adds `[value, count]` lists into one, ascending by value. */
function mergeCounts(lists: readonly (readonly [number, number])[][]): [number, number][] {
  const totals = new Map<number, number>()
  for (const list of lists) {
    for (const [value, count] of list) totals.set(value, (totals.get(value) ?? 0) + count)
  }

  return [...totals.entries()].sort((left, right) => left[0] - right[0])
}

function tripleTotals(entries: readonly BatchEntry[]): BatchTriples {
  const byPrimitive = Object.fromEntries([
    ...PRIMITIVES.map((primitive) => [primitive.kind, 0]),
    ['unattributed', 0],
  ]) as Record<PrimitiveKind | 'unattributed', number>
  const byReason: Record<BrokenReason, number> = {
    legLeftBlock: 0,
    victimsLeftBlock: 0,
    sameBatch: 0,
    orderChanged: 0,
  }

  let found = 0
  let broken = 0
  for (const outcome of entries.flatMap((entry) => entry.triples)) {
    found += 1
    if (!outcome.broken) continue

    broken += 1
    byPrimitive[outcome.by ?? 'unattributed'] += 1
    if (outcome.reason !== null) byReason[outcome.reason] += 1
  }

  return { found, broken, possible: found - broken, byPrimitive, byReason }
}
