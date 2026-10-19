import { type BatchEntry, type Policy, batchEntry, batchReport } from '@ordercraft/core'
import { type Db, batches, policyVersions, runs } from '@ordercraft/db'
import {
  type BatchEvent,
  type BatchStatus,
  type BatchView,
  type CreateBatchRequest,
  hydrateOrdering,
} from '@ordercraft/shared'
import { and, eq, inArray } from 'drizzle-orm'
import { HttpError, notFound } from '../errors.ts'
import { Phases } from './phases.ts'
import { runSlot } from './runs.ts'
import type { SlotStore } from './slots.ts'

type BatchRow = typeof batches.$inferSelect
type Stopped = Exclude<BatchStatus, 'running'>

export interface BatchRunnerOptions {
  /**
   * How many batches one process runs at once; the next one is refused with
   * `RATE_LIMITED`. One by default: on a free instance two batches share a tenth of a
   * CPU and both miss SC-005, where one at a time keeps it for whoever is running.
   */
  maxActive?: number | undefined
  /**
   * Awaited once a slot is under way — past the cancel check, before its run — for tests
   * that need a batch to stand still with a slot in flight. Absent in the server.
   */
  beforeSlot?: ((position: number) => Promise<void>) | undefined
  /**
   * Where the one line per stopped batch goes — its time, split by phase. The console
   * by default, which on the host is the service log.
   */
  log?: ((line: string) => void) | undefined
}

interface Active {
  id: string
  version: { hash: string; body: Policy }
  slots: number[]
  /** One per finished slot, in the batch's order — always a prefix of `slots`. */
  entries: BatchEntry[]
  cancelRequested: boolean
  listeners: Set<(event: BatchEvent) => void>
  /** Settles once the batch has stopped and its row says so. Never rejects. */
  finished: Promise<Stopped>
}

/** What a client that missed the moment is told. The specific reason was in the live event. */
const STOPPED_EARLY = 'the batch stopped before it finished; the runs it finished are kept'

/**
 * Batch runs (FR-016, FR-017), one worker per batch inside this process.
 *
 * The worker walks the slots in order and keeps each finished run twice: as a row in
 * `runs` through the same path as `POST /runs`, and as a `BatchEntry` in memory, which
 * is what the report pools. `done_count` is written after every slot so that the row
 * tells the truth to anyone who asks; the report is written once, when the batch stops,
 * whichever way it stops. Cancelling therefore loses nothing: the runs were stored as
 * they finished, and the report covers exactly them.
 *
 * A batch runs whether or not anyone is listening — closing the tab does not stop it,
 * only `cancel` does. Memory is the one thing a restart takes away, and `recoverOrphans`
 * deals with that at boot: the runs are in the database, so the report is rebuilt from
 * them.
 */
export class BatchRunner {
  readonly #db: Db
  readonly #store: SlotStore
  readonly #maxActive: number
  readonly #beforeSlot: ((position: number) => Promise<void>) | undefined
  readonly #log: (line: string) => void
  readonly #active = new Map<string, Active>()
  /** Batches between the limit check and their entry in `#active`. */
  #starting = 0

  constructor(db: Db, store: SlotStore, options: BatchRunnerOptions = {}) {
    this.#db = db
    this.#store = store
    this.#maxActive = options.maxActive ?? 1
    this.#beforeSlot = options.beforeSlot
    this.#log = options.log ?? ((line) => console.log(line))
  }

  /**
   * `POST /batches`. Everything that can be known up front is checked before the row
   * exists: the policy, and that every slot's file is on disk — a batch that would stop
   * at slot 40 for a missing file is refused at slot 0 with the list of them instead.
   */
  async create(request: CreateBatchRequest): Promise<{ batchId: string }> {
    if (this.#active.size + this.#starting >= this.#maxActive) {
      throw new HttpError(
        'RATE_LIMITED',
        'the server is already running a batch; try again when it finishes',
        { running: this.#active.size + this.#starting },
      )
    }

    this.#starting += 1
    try {
      const version = await this.#db.query.policyVersions.findFirst({
        where: eq(policyVersions.hash, request.hash),
      })
      if (version === undefined) throw notFound('policy version', { hash: request.hash })

      const unreadable = await this.#store.unreadable(this.#db, request.slots)
      if (unreadable.length > 0) {
        throw new HttpError(
          'NOT_FOUND',
          `${unreadable.length} of the slots asked for are not loaded`,
          { slots: unreadable, hint: 'load each with POST /slots/fetch' },
        )
      }

      const [row] = await this.#db
        .insert(batches)
        .values({ policyHash: request.hash, slots: request.slots })
        .returning()
      if (row === undefined) throw new Error('the batch row was not returned')

      const active: Active = {
        id: row.id,
        version: { hash: version.hash, body: version.body },
        slots: request.slots,
        entries: [],
        cancelRequested: false,
        listeners: new Set(),
        finished: Promise.resolve('done'),
      }
      this.#active.set(row.id, active)
      active.finished = this.#work(active)

      return { batchId: row.id }
    } finally {
      this.#starting -= 1
    }
  }

  /** `GET /batches/:id`. */
  async get(id: string): Promise<BatchView> {
    return toView(await this.#row(id))
  }

  /**
   * `POST /batches/:id/cancel`. Answers once the worker has stopped and the report is
   * written — the slot in flight finishes first, because its run is stored either way
   * and a run that exists but is not counted would be the one thing cancelling loses.
   * A batch that finished in the meantime is a conflict, not a cancellation.
   */
  async cancel(id: string): Promise<{ status: 'cancelled' }> {
    const active = this.#active.get(id)
    let status: BatchStatus

    if (active !== undefined) {
      active.cancelRequested = true
      status = await active.finished
    } else {
      const row = await this.#row(id)
      status = row.status === 'running' ? await this.#settleOrphan(row, 'cancelled') : row.status
    }

    if (status !== 'cancelled') {
      throw new HttpError('CONFLICT', `the batch has already stopped: it is ${status}`, {
        status,
      })
    }

    return { status: 'cancelled' }
  }

  /**
   * `GET /batches/:id/events`. Starts with where the batch is now, then one `progress`
   * per finished slot, then exactly one of `done`, `cancelled`, `failed`, after which it
   * ends. A batch that has already stopped gives its count and its ending at once. The
   * generator also ends when `signal` aborts — the client went away.
   */
  async *events(id: string, signal?: AbortSignal): AsyncGenerator<BatchEvent> {
    const active = this.#active.get(id)
    if (active === undefined) {
      yield* replay(await this.#row(id))
      return
    }

    const queue: BatchEvent[] = [progressOf(active)]
    let wake: (() => void) | undefined
    const listener = (event: BatchEvent) => {
      queue.push(event)
      wake?.()
    }
    const onAbort = () => wake?.()

    active.listeners.add(listener)
    signal?.addEventListener('abort', onAbort)
    try {
      while (signal?.aborted !== true) {
        const event = queue.shift()
        if (event === undefined) {
          await new Promise<void>((resolve) => {
            wake = resolve
          })
          wake = undefined
          continue
        }

        yield event
        if (event.event !== 'progress') return
      }
    } finally {
      active.listeners.delete(listener)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /**
   * Batches the database says are running and no process is running: the previous
   * process died with them. Each is marked `failed` with a report over the runs it had
   * finished, rebuilt from `runs`. Called at boot, before the server listens.
   */
  async recoverOrphans(): Promise<number> {
    const orphans = await this.#db.query.batches.findMany({
      where: eq(batches.status, 'running'),
    })
    const mine = orphans.filter((row) => !this.#active.has(row.id))
    for (const row of mine) await this.#settleOrphan(row, 'failed')

    return mine.length
  }

  async #work(active: Active): Promise<Stopped> {
    let status: Stopped = 'done'
    let message = STOPPED_EARLY
    const phases = new Phases()
    const started = performance.now()
    let slowest = 0

    try {
      // Two queries for the whole batch instead of two for every slot.
      const sources = await phases.time('prefetch', () =>
        this.#store.sources(this.#db, active.slots),
      )
      const stored = await phases.time('prefetch', () => this.#storedSlots(active))

      for (const [position, slot] of active.slots.entries()) {
        const slotStarted = performance.now()
        // A turn of the event loop between slots, so that a cancel request and the
        // progress stream are served even when every read below hits memory.
        await phases.time('turn', () => new Promise((resolve) => setImmediate(resolve)))
        if (active.cancelRequested) {
          status = 'cancelled'
          break
        }

        // From here the slot is in flight: a cancel that arrives now waits for it, and
        // it is counted — its run is stored either way.
        await this.#beforeSlot?.(position)

        const run = await runSlot(this.#db, this.#store, active.version, slot, {
          phases,
          source: sources.get(slot),
          stored: stored.has(slot),
        })
        const entry = await phases.time('summarise', () =>
          batchEntry(run.bundle, run.ordering, run.outcomes),
        )
        active.entries.push(entry)
        await phases.time('count', () =>
          this.#db
            .update(batches)
            .set({ doneCount: active.entries.length })
            .where(eq(batches.id, active.id)),
        )

        emit(active, progressOf(active))
        slowest = Math.max(slowest, performance.now() - slotStarted)
      }
    } catch (error) {
      status = 'failed'
      const slot = active.slots[active.entries.length]
      message =
        error instanceof HttpError && error.code === 'NOT_FOUND'
          ? `slot ${slot} could not be read; the runs finished before it are kept`
          : 'the server could not finish the batch; the runs finished before the error are kept'
      if (!(error instanceof HttpError)) console.error(error)
    }

    try {
      await this.#settle(active.id, status, active.version.hash, active.entries)
    } catch (error) {
      // The row stays `running`; the next boot recovers it from the stored runs.
      console.error(error)
      status = 'failed'
      message = STOPPED_EARLY
    }

    this.#active.delete(active.id)
    emit(active, ending(status, message))
    this.#log(
      `batch ${active.id}: ${status}, ${active.entries.length}/${active.slots.length} slots ` +
        `in ${Math.round(performance.now() - started)} ms, slowest ${Math.round(slowest)} ms — ${phases}`,
    )

    return status
  }

  /** The slots of the batch whose run under its policy exists already. */
  async #storedSlots(active: Active): Promise<Set<number>> {
    const rows = await this.#db
      .select({ slot: runs.slot })
      .from(runs)
      .where(and(eq(runs.policyHash, active.version.hash), inArray(runs.slot, active.slots)))

    return new Set(rows.map((row) => row.slot))
  }

  /** The report over a batch's entries and its final state, in one write. */
  async #settle(id: string, status: Stopped, hash: string, entries: BatchEntry[]): Promise<void> {
    await this.#db
      .update(batches)
      .set({ status, doneCount: entries.length, report: batchReport(hash, entries) })
      .where(eq(batches.id, id))
  }

  /**
   * Stops a batch nobody is running. The first `doneCount` slots are the ones it is known
   * to have finished — the worker counts in order — and their runs are in `runs`. A slot
   * whose file has gone since (a live-fetched block after a restart) ends the prefix
   * there: its run is kept, but without the block it cannot be summarised.
   */
  async #settleOrphan(row: BatchRow, status: Stopped): Promise<Stopped> {
    const finished = row.slots.slice(0, row.doneCount)
    const stored =
      finished.length === 0
        ? []
        : await this.#db.query.runs.findMany({
            where: and(eq(runs.policyHash, row.policyHash), inArray(runs.slot, finished)),
          })
    const bySlot = new Map(stored.map((run) => [run.slot, run]))

    const entries: BatchEntry[] = []
    for (const slot of finished) {
      const run = bySlot.get(slot)
      if (run === undefined || (await this.#store.unreadable(this.#db, [slot])).length > 0) break

      const bundle = await this.#store.read(this.#db, slot)
      const ordering = hydrateOrdering(run.result.ordering, bundle)
      entries.push(batchEntry(bundle, ordering, run.result.outcomes))
    }

    await this.#settle(row.id, status, row.policyHash, entries)

    return status
  }

  async #row(id: string): Promise<BatchRow> {
    const row = await this.#db.query.batches.findFirst({ where: eq(batches.id, id) })
    if (row === undefined) throw notFound('batch', { id })

    return row
  }
}

function toView(row: BatchRow): BatchView {
  return {
    id: row.id,
    policyHash: row.policyHash,
    slots: row.slots,
    status: row.status,
    doneCount: row.doneCount,
    report: row.report ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

function progressOf(active: Active): BatchEvent {
  return { event: 'progress', doneCount: active.entries.length, total: active.slots.length }
}

function ending(status: Stopped, message: string): BatchEvent {
  return status === 'failed' ? { event: 'failed', message } : { event: status }
}

function emit(active: Active, event: BatchEvent): void {
  for (const listener of active.listeners) listener(event)
}

function* replay(row: BatchRow): Generator<BatchEvent> {
  yield { event: 'progress', doneCount: row.doneCount, total: row.slots.length }
  // Running here means nobody is running it: an orphan not yet recovered.
  yield row.status === 'running'
    ? ending('failed', STOPPED_EARLY)
    : ending(row.status, STOPPED_EARLY)
}
