import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PRESETS,
  type SlotBundle,
  addedDelays,
  apply,
  batchEntry,
  batchReport,
  findSandwiches,
  runMetrics,
  tripleOutcome,
} from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { decodeSlotBundle } from '../src/index.ts'

const SLOTS = fileURLToPath(new URL('../slots', import.meta.url))

const bundles: SlotBundle[] = await Promise.all(
  readdirSync(SLOTS)
    .filter((file) => file.endsWith('.json.gz'))
    .sort()
    .map((file) => decodeSlotBundle(new Uint8Array(readFileSync(join(SLOTS, file))))),
)

function entriesFor(preset: (typeof PRESETS)[number]) {
  return bundles.map((bundle) => {
    const ordering = apply(preset.policy, bundle)
    const outcomes = findSandwiches(bundle).map((sandwich) => tripleOutcome(sandwich, ordering))
    return batchEntry(bundle, ordering, outcomes)
  })
}

/**
 * The batch report on real blocks. The kernel's own tests check the arithmetic on
 * hand-built slots; this checks that it survives 53 recorded ones — blocks of very
 * different sizes, real delay spreads, and the detector's actual output.
 */
describe('batch report over the curated slots', () => {
  it.each(PRESETS)('$id: counts every block once and pools every included delay', (preset) => {
    const entries = entriesFor(preset)
    const report = batchReport(entries[0]?.policyHash ?? '', entries)

    expect(report.blocks).toBe(bundles.length)
    expect(new Set(report.slots).size).toBe(bundles.length)

    const pooled = bundles
      .flatMap((bundle) => addedDelays(bundle, apply(preset.policy, bundle)))
      .sort((left, right) => left - right)
    expect(report.transactions.included).toBe(pooled.length)
    expect(report.addedDelayMs?.max).toBe(pooled.at(-1))

    const p95 = pooled[Math.ceil((95 * pooled.length) / 100) - 1]
    expect(report.addedDelayMs?.p95).toBe(p95)
  })

  /**
   * Measured 2026-10-16: every preset holds a narrow class — anti-snipe 549 of 69 882
   * included, batched swaps 868 of 69 825 — so over everyone p95 is 0 ms and the delay
   * only shows among the held. The maker preset prioritises and holds nobody.
   */
  it.each(PRESETS)('$id: the delay of the held class is not lost under everyone else', (preset) => {
    const entries = entriesFor(preset)
    const report = batchReport(entries[0]?.policyHash ?? '', entries)

    if (report.transactions.delayed === 0) {
      expect(report.heldDelayMs).toBeNull()
      return
    }

    expect(report.addedDelayMs?.p95).toBe(0)
    expect(report.heldDelayMs?.p50).toBeGreaterThan(0)
    expect(report.heldDelayMs?.max).toBe(report.addedDelayMs?.max)
  })

  it.each(PRESETS)('$id: a one-block batch reports exactly what the run did', (preset) => {
    const bundle = bundles[0] as SlotBundle
    const ordering = apply(preset.policy, bundle)
    const report = batchReport(ordering.policyHash, [batchEntry(bundle, ordering, [])])

    expect(report.addedDelayMs).toEqual(runMetrics(bundle, ordering).addedDelayMs)
  })

  it('keeps an entry small: a few hundred delay steps per block, not a delay per transaction', () => {
    const entries = PRESETS.flatMap(entriesFor)
    const steps = entries.map((entry) => entry.addedDelayCounts.length)

    // Delays are whole milliseconds inside a 400 ms slot, so the count of distinct
    // values is bounded by the slot, not by the block size.
    expect(Math.max(...steps)).toBeLessThanOrEqual(400)
  })
})
