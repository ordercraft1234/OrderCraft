import type { BatchReport } from '@ordercraft/core'

/**
 * A report in the shape the kernel writes, with figures chosen so that every strip
 * has something different to say: drawn, flat, and absent.
 */
export const REPORT: BatchReport = {
  policyHash: 'a'.repeat(64),
  blocks: 3,
  slots: [445553238, 445553239, 445553240],
  transactions: {
    recorded: 4200,
    included: 4150,
    deferred: 50,
    dropped: 0,
    moved: 1800,
    delayed: 549,
  },
  addedDelayMs: { p10: 0, p50: 0, p90: 0, p95: 0, max: 118 },
  heldDelayMs: { p10: 42, p50: 96, p90: 246, p95: 284, max: 391 },
  perBlock: {
    reorderedPerMille: { p10: 314, p50: 441, p90: 497, p95: 518, max: 518 },
    deferredPerMille: { p10: 0, p50: 11, p90: 14, p95: 14, max: 14 },
    droppedPerMille: { p10: 0, p50: 0, p90: 0, p95: 0, max: 0 },
    triples: null,
  },
  triples: {
    found: 0,
    broken: 0,
    possible: 0,
    byPrimitive: { speedBump: 0, batchAuction: 0, allowDeny: 0, unattributed: 0 },
    byReason: { legLeftBlock: 0, victimsLeftBlock: 0, sameBatch: 0, orderChanged: 0 },
  },
  unchangedBlocks: 0,
}
