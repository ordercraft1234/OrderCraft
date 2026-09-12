/** JSON-RPC codes a node answers with when a slot simply holds no block. */
const MISSING_BLOCK_CODES = [-32007, -32009]

export interface FillOptions {
  /** First slot to ask for. */
  from: number
  /** How many slots to walk, held or not. */
  count: number
  /** Step between slots. A step above 1 spreads the sample over a wider stretch. */
  every?: number
  /** Wait between calls, and the base for the wait after a refusal. */
  pauseMs?: number
  /** Tries per slot before giving up on it. */
  attempts?: number
}

export interface FillReport {
  fetched: number[]
  /** Slots the node has no block for. Normal: leaders miss their turn. */
  missing: number[]
  /** Slots already in the target directory — the run is resumable. */
  held: number[]
  failed: { slot: number; reason: string }[]
}

export interface FillPorts {
  has(slot: number): boolean
  fetch(slot: number): Promise<unknown>
  store(slot: number, block: unknown): void
  wait(ms: number): Promise<void>
  note(line: string): void
}

/**
 * Walks a stretch of slots into a directory.
 *
 * **Resumable by construction.** A slot already on disk is not asked for again, so a run
 * interrupted at slot 400 of 900 continues where it stopped rather than paying for the
 * first 400 twice. That also makes the command safe to widen: raising `--count` fetches
 * only what is new.
 *
 * **A missing block is not a failure.** Leaders miss their turn, and on a random stretch
 * a few percent of slots hold nothing. Those are counted separately and do not stop the
 * walk. A refusal that is not a missing block — a rate limit, a node under load — is
 * retried with a growing wait, and only then recorded as failed.
 */
export async function fill(ports: FillPorts, options: FillOptions): Promise<FillReport> {
  const every = options.every ?? 1
  const pauseMs = options.pauseMs ?? 200
  const attempts = options.attempts ?? 3

  const report: FillReport = { fetched: [], missing: [], held: [], failed: [] }

  for (let step = 0; step < options.count; step++) {
    const slot = options.from + step * every
    if (ports.has(slot)) {
      report.held.push(slot)
      continue
    }

    await one(ports, slot, { pauseMs, attempts }, report)
    if (report.fetched.length % 25 === 0 && report.fetched.length > 0) {
      ports.note(
        `${report.fetched.length} fetched · ${report.missing.length} missing · ${report.failed.length} failed · at slot ${slot}`,
      )
    }

    await ports.wait(pauseMs)
  }

  return report
}

async function one(
  ports: FillPorts,
  slot: number,
  limits: { pauseMs: number; attempts: number },
  report: FillReport,
): Promise<void> {
  let last = ''
  for (let attempt = 1; attempt <= limits.attempts; attempt++) {
    try {
      ports.store(slot, await ports.fetch(slot))
      report.fetched.push(slot)
      return
    } catch (error: unknown) {
      last = error instanceof Error ? error.message : String(error)
      if (isMissingBlock(last)) {
        report.missing.push(slot)
        return
      }

      // A node under load answers again if asked later, so the wait grows with the try.
      if (attempt < limits.attempts) await ports.wait(limits.pauseMs * 2 ** attempt)
    }
  }

  report.failed.push({ slot, reason: last })
}

/**
 * Read off the message rather than a typed error: `fetchBlock` hands back one `Error` for
 * every way a call can go wrong, and the code it carries is the only thing separating
 * "this slot holds nothing" from "the node would not answer".
 */
function isMissingBlock(message: string): boolean {
  return MISSING_BLOCK_CODES.some((code) => message.includes(`(code ${code})`))
}
