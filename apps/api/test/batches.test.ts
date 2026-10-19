import { rmSync } from 'node:fs'
import {
  type BatchEntry,
  type SlotBundle,
  apply,
  batchEntry,
  batchReport,
  findSandwiches,
  policyHash,
  tripleOutcome,
} from '@ordercraft/core'
import { batches, runs } from '@ordercraft/db'
import {
  type BatchEvent,
  apiErrorSchema,
  batchEventSchema,
  batchViewSchema,
  createBatchResponseSchema,
} from '@ordercraft/shared'
import { slotPath, writeSlot } from '@ordercraft/slots'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BatchRunner } from '../src/services/batches.ts'
import { SlotStore } from '../src/services/slots.ts'
import {
  type Harness,
  POLICY,
  UNKNOWN_SLOT,
  openHarness,
  quietSlot,
  sandwichSlot,
} from './harness.ts'

/**
 * Holds the worker with the slot at a chosen position in flight until released, so a
 * test can look at a batch while it runs without racing a timer.
 */
class Gate {
  #at: number | null = null
  #reached: (() => void) | undefined
  #release: (() => void) | undefined
  reached: Promise<void> = Promise.resolve()

  hold(position: number): void {
    this.#at = position
    this.reached = new Promise((resolve) => {
      this.#reached = resolve
    })
  }

  release(): void {
    this.#at = null
    this.#release?.()
  }

  readonly beforeSlot = async (position: number): Promise<void> => {
    if (position !== this.#at) return
    this.#reached?.()
    await new Promise<void>((resolve) => {
      this.#release = resolve
    })
  }
}

let h: Harness
const gate = new Gate()
const hash = policyHash(POLICY)
const written = new Map<number, SlotBundle>()
let nextSlot = 441_394_500

beforeAll(async () => {
  h = await openHarness({ batches: { beforeSlot: gate.beforeSlot } })
  await h.api('/policies', { method: 'POST', json: { body: POLICY } })
}, 60_000)

afterAll(() => h.close())

/** New fixture slots no test has run yet, alternating a sandwich and a quiet block. */
async function freshSlots(count: number): Promise<number[]> {
  const slots: number[] = []
  for (let offset = 0; offset < count; offset += 1) {
    const slot = nextSlot++
    const bundle = offset % 2 === 0 ? sandwichSlot(slot) : quietSlot(slot)
    writeSlot(h.dirs.fixtures, bundle)
    written.set(slot, bundle)
    slots.push(slot)
  }
  await h.store.syncFixtures(h.db)

  return slots
}

/** What the batch should report, computed with the kernel alone. */
function expectedReport(slots: number[]) {
  const entries: BatchEntry[] = slots.map((slot) => {
    const bundle = written.get(slot)
    if (bundle === undefined) throw new Error(`slot ${slot} was not written by this test`)
    const ordering = apply(POLICY, bundle)
    const outcomes = findSandwiches(bundle).map((sandwich) => tripleOutcome(sandwich, ordering))
    return batchEntry(bundle, ordering, outcomes)
  })

  return batchReport(hash, entries)
}

async function start(slots: number[]): Promise<string> {
  const response = await h.api('/batches', { method: 'POST', json: { hash, slots } })
  expect(response.status).toBe(201)

  return createBatchResponseSchema.parse(await response.json()).batchId
}

async function view(id: string) {
  const response = await h.api(`/batches/${id}`)
  expect(response.status).toBe(200)

  return batchViewSchema.parse(await response.json())
}

/** Reads the event stream to its end, each message checked against the schema. */
async function events(id: string): Promise<BatchEvent[]> {
  const response = await h.api(`/batches/${id}/events`)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/)

  return parseStream(await response.text())
}

function parseStream(text: string): BatchEvent[] {
  return text
    .split('\n\n')
    .filter((message) => message.trim() !== '')
    .map((message) => {
      const fields = Object.fromEntries(
        message.split('\n').map((line) => {
          const colon = line.indexOf(':')
          return [line.slice(0, colon), line.slice(colon + 1).trim()]
        }),
      )
      const event = batchEventSchema.parse(JSON.parse(fields.data ?? ''))
      expect(fields.event).toBe(event.event)
      return event
    })
}

async function storedRuns(slots: number[]): Promise<number[]> {
  const rows = await h.db
    .select({ slot: runs.slot })
    .from(runs)
    .where(and(eq(runs.policyHash, hash), inArray(runs.slot, slots)))

  return rows.map((row) => row.slot).sort((left, right) => left - right)
}

describe('a batch that runs to the end', () => {
  it('runs every slot, stores every run and reports what the kernel reports', async () => {
    const slots = await freshSlots(3)
    const id = await start(slots)
    const stream = await events(id)

    expect(stream.at(-1)).toEqual({ event: 'done' })
    const counts = stream.flatMap((event) => (event.event === 'progress' ? [event.doneCount] : []))
    expect(counts.at(-1)).toBe(3)
    expect(counts).toEqual([...counts].sort((left, right) => left - right))

    const batch = await view(id)
    expect(batch).toMatchObject({ status: 'done', doneCount: 3, slots, policyHash: hash })
    expect(batch.report).toEqual(expectedReport(slots))
    expect(batch.report?.triples).toMatchObject({ found: 2, broken: 2 })
    expect(await storedRuns(slots)).toEqual(slots)
  })

  it('streams one progress per slot to a client that is there from the start', async () => {
    const slots = await freshSlots(3)
    gate.hold(0)
    const id = await start(slots)
    await gate.reached

    const stream = events(id)
    gate.release()

    expect(await stream).toEqual([
      { event: 'progress', doneCount: 0, total: 3 },
      { event: 'progress', doneCount: 1, total: 3 },
      { event: 'progress', doneCount: 2, total: 3 },
      { event: 'progress', doneCount: 3, total: 3 },
      { event: 'done' },
    ])
  })

  it('a stopped batch replays its count and its ending', async () => {
    const slots = await freshSlots(2)
    const id = await start(slots)
    await events(id)

    expect(await events(id)).toEqual([
      { event: 'progress', doneCount: 2, total: 2 },
      { event: 'done' },
    ])
  })

  it('a second batch over the same runs computes nothing new and reports the same', async () => {
    const slots = await freshSlots(3)
    const first = await start(slots)
    await events(first)
    const [{ count: before } = { count: -1 }] = await countRuns()

    const second = await start(slots)
    await events(second)

    expect((await view(second)).report).toEqual((await view(first)).report)
    expect(await countRuns()).toEqual([{ count: before }])
  })

  it('keeps running when the client goes away', async () => {
    const slots = await freshSlots(2)
    gate.hold(1)
    const id = await start(slots)
    await gate.reached

    const response = await h.api(`/batches/${id}/events`)
    await response.body?.cancel()
    gate.release()

    expect((await events(id)).at(-1)).toEqual({ event: 'done' })
    expect((await view(id)).status).toBe('done')
  })
})

describe('cancelling (FR-017)', () => {
  it('finishes the slot in flight, counts it, and runs nothing after it', async () => {
    const slots = await freshSlots(5)
    gate.hold(2)
    const id = await start(slots)
    await gate.reached

    const stream = events(id)
    const cancelled = h.api(`/batches/${id}/cancel`, { method: 'POST' })
    gate.release()

    const response = await cancelled
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'cancelled' })
    expect(await stream).toEqual([
      { event: 'progress', doneCount: 2, total: 5 },
      { event: 'progress', doneCount: 3, total: 5 },
      { event: 'cancelled' },
    ])

    // The answer comes once the report is written, so the very next read has it — and
    // it counts exactly the runs that were stored, the one in flight included.
    const batch = await view(id)
    expect(batch).toMatchObject({ status: 'cancelled', doneCount: 3 })
    expect(batch.report).toEqual(expectedReport(slots.slice(0, 3)))
    expect(await storedRuns(slots)).toEqual(slots.slice(0, 3))
  })

  it('a cancel that arrives during the last slot finds the batch done', async () => {
    const slots = await freshSlots(2)
    gate.hold(1)
    const id = await start(slots)
    await gate.reached

    const cancelled = h.api(`/batches/${id}/cancel`, { method: 'POST' })
    gate.release()

    const response = await cancelled
    expect(response.status).toBe(409)
    expect(apiErrorSchema.parse(await response.json()).error.details).toEqual({ status: 'done' })
    expect(await view(id)).toMatchObject({ status: 'done', doneCount: 2 })
  })

  it('a batch nobody is running cancels with an empty sample when it finished nothing', async () => {
    const slots = await freshSlots(2)
    const [orphan] = await h.db.insert(batches).values({ policyHash: hash, slots }).returning()
    const id = orphan?.id ?? ''

    const response = await h.api(`/batches/${id}/cancel`, { method: 'POST' })
    expect(response.status).toBe(200)

    const batch = await view(id)
    expect(batch).toMatchObject({ status: 'cancelled', doneCount: 0 })
    expect(batch.report).toMatchObject({ blocks: 0, addedDelayMs: null, heldDelayMs: null })
  })

  it('cancelling twice is the same answer; cancelling a finished batch is a conflict', async () => {
    const slots = await freshSlots(3)
    gate.hold(1)
    const cancelledId = await start(slots)
    await gate.reached
    const first = h.api(`/batches/${cancelledId}/cancel`, { method: 'POST' })
    gate.release()
    expect((await first).status).toBe(200)

    const again = await h.api(`/batches/${cancelledId}/cancel`, { method: 'POST' })
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ status: 'cancelled' })

    const doneId = await start(await freshSlots(1))
    await events(doneId)
    const late = await h.api(`/batches/${doneId}/cancel`, { method: 'POST' })
    expect(late.status).toBe(409)
    expect(apiErrorSchema.parse(await late.json()).error).toMatchObject({
      code: 'CONFLICT',
      details: { status: 'done' },
    })
    expect((await view(doneId)).status).toBe('done')
  })
})

describe('refusals', () => {
  it('names every slot that is not loaded, and starts nothing', async () => {
    const [known = 0] = await freshSlots(1)
    const before = await countBatches()

    const response = await h.api('/batches', {
      method: 'POST',
      json: { hash, slots: [known, UNKNOWN_SLOT] },
    })
    expect(response.status).toBe(404)
    expect(apiErrorSchema.parse(await response.json()).error).toMatchObject({
      code: 'NOT_FOUND',
      details: { slots: [UNKNOWN_SLOT] },
    })
    expect(await countBatches()).toEqual(before)
  })

  it('an indexed slot whose file is gone counts as not loaded', async () => {
    const [present = 0, gone = 0] = await freshSlots(2)
    rmSync(slotPath(h.dirs.fixtures, gone))

    const response = await h.api('/batches', {
      method: 'POST',
      json: { hash, slots: [present, gone] },
    })
    expect(response.status).toBe(404)
    expect(apiErrorSchema.parse(await response.json()).error.details).toMatchObject({
      slots: [gone],
    })
  })

  it('refuses a policy version nobody saved', async () => {
    const response = await h.api('/batches', {
      method: 'POST',
      json: { hash: 'a'.repeat(64), slots: await freshSlots(1) },
    })
    expect(response.status).toBe(404)
  })

  it('runs one batch at a time and refuses the next until it stops', async () => {
    gate.hold(0)
    const id = await start(await freshSlots(1))
    await gate.reached

    const busy = await h.api('/batches', {
      method: 'POST',
      json: { hash, slots: await freshSlots(1) },
    })
    expect(busy.status).toBe(429)
    expect(apiErrorSchema.parse(await busy.json()).error.code).toBe('RATE_LIMITED')

    gate.release()
    await events(id)
    await events(await start(await freshSlots(1)))
  })

  it('an unknown batch is a 404, a malformed id a 400, on every route', async () => {
    const unknown = '3f0c2c5e-9a2b-4d7e-8f11-6b2a1c9d0e42'
    expect((await h.api(`/batches/${unknown}`)).status).toBe(404)
    expect((await h.api(`/batches/${unknown}/events`)).status).toBe(404)
    expect((await h.api(`/batches/${unknown}/cancel`, { method: 'POST' })).status).toBe(404)
    expect((await h.api('/batches/42')).status).toBe(400)
  })
})

describe('stopping early without being asked', () => {
  it('a cached block gone mid-batch fails the batch and keeps the runs before it', async () => {
    // The real case: a live-fetched block on an ephemeral disk. (A fixture gone missing
    // fails too, but as a broken build, without naming the slot to the client.)
    const [first = 0, last = 0] = await freshSlots(2)
    const cached = nextSlot++
    written.set(cached, quietSlot(cached))
    // Fetched by another process: this one has no parsed copy in memory to fall back on.
    await new SlotStore(h.dirs).put(h.db, quietSlot(cached))
    const slots = [first, cached, last]

    gate.hold(1)
    const id = await start(slots)
    await gate.reached

    rmSync(slotPath(h.dirs.cache, cached))
    const stream = events(id)
    gate.release()

    const ending = (await stream).at(-1)
    expect(ending).toMatchObject({ event: 'failed' })
    expect(ending?.event === 'failed' && ending.message).toMatch(new RegExp(`slot ${slots[1]}`))

    const batch = await view(id)
    expect(batch).toMatchObject({ status: 'failed', doneCount: 1 })
    expect(batch.report).toEqual(expectedReport(slots.slice(0, 1)))
  })

  it('a batch the last process died with is failed at boot, with a report from its runs', async () => {
    const slots = await freshSlots(3)
    const finished = await start(slots)
    await events(finished)

    // What a dead process leaves: the row says running, two slots counted, nobody on it.
    const [orphan] = await h.db
      .insert(batches)
      .values({ policyHash: hash, slots, doneCount: 2 })
      .returning()
    const id = orphan?.id ?? ''
    expect(await events(id)).toEqual([
      { event: 'progress', doneCount: 2, total: 3 },
      { event: 'failed', message: expect.stringMatching(/stopped before it finished/) },
    ])

    expect(await new BatchRunner(h.db, h.store).recoverOrphans()).toBe(1)

    const batch = await view(id)
    expect(batch).toMatchObject({ status: 'failed', doneCount: 2 })
    expect(batch.report).toEqual(expectedReport(slots.slice(0, 2)))
    expect(await new BatchRunner(h.db, h.store).recoverOrphans()).toBe(0)
  })
})

function countRuns() {
  return h.db.$count(runs).then((count) => [{ count }])
}

function countBatches() {
  return h.db.$count(batches)
}
