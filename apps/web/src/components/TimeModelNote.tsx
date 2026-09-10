import { SLOT_DURATION_MS, arrivalMs } from '@ordercraft/core'

/**
 * How much of the slot one position is worth, as a string with two decimals.
 *
 * This is the number that makes the rest of the screen legible: at 1,422 transactions
 * a position is 0.28 ms, so a 120 ms speed bump does not nudge a transaction — it puts
 * it behind some four hundred others. Every "moved" on this screen comes from that
 * arithmetic.
 */
export function msPerPosition(recorded: number): string {
  if (recorded <= 0) return '0.00'

  return (SLOT_DURATION_MS / recorded).toFixed(2)
}

/**
 * The sentence that has to sit under every figure this product derives from time
 * (FR-031).
 *
 * A Solana block records order and one timestamp for the whole slot; per-transaction
 * arrival is not in it. The scale here is an assumption, and every delay figure on the
 * screen is a consequence of the assumption rather than a measurement — so the model
 * is printed in full, with its own arithmetic worked out on the block being shown, and
 * not hidden in documentation nobody opens.
 */
export function TimeModelNote({ recorded }: { recorded: number }) {
  const last = recorded > 0 ? recorded - 1 : 0

  return (
    <p className="max-w-[620px] text-[12px] text-muted">
      Arrival time inside a block is not recorded on-chain. This run models it as{' '}
      <span className="text-ink">arrival(i) = floor(i × {SLOT_DURATION_MS} / N)</span> — across{' '}
      {recorded.toLocaleString('en-US')} transactions one position is {msPerPosition(recorded)} ms,
      and the last one arrives at {arrivalMs(last, recorded)} ms. Delay figures are a consequence of
      that model, not a measurement.
    </p>
  )
}
