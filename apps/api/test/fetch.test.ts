import { existsSync, rmSync } from 'node:fs'
import { policyHash } from '@ordercraft/core'
import {
  apiErrorSchema,
  fetchSlotResponseSchema,
  listSlotsResponseSchema,
  runSchema,
} from '@ordercraft/shared'
import { slotPath } from '@ordercraft/slots'
import { afterEach, describe, expect, it } from 'vitest'
import block from '../../../packages/core/test/fixtures/block-sample.json' with { type: 'json' }
import { FETCH_LIMIT } from '../src/routes/slots.ts'
import { SlotStore } from '../src/services/slots.ts'
import { FIXTURE_SLOT, type Harness, POLICY, UNKNOWN_SLOT, openHarness } from './harness.ts'

const RPC_URL = 'https://rpc.example/?api-key=secret-key'

/** A node that answers every slot with the same three-transaction block. */
function node(answer: (slot: number) => Response = () => ok(block)) {
  const calls: number[] = []
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { params: [number] }
    calls.push(body.params[0])
    return answer(body.params[0])
  }

  return { calls, fetchImpl }
}

const ok = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 })

const refused = (code: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code, message } }), {
    status: 200,
  })

let h: Harness | undefined

afterEach(async () => {
  await h?.close()
  h = undefined
})

/**
 * The deployment this runs on has no disk that survives a restart: a free host stops
 * the container after fifteen quiet minutes and starts a new one with an empty
 * filesystem, while Postgres keeps every row. So the pair (row, file) comes apart in
 * exactly one direction, and only for `rpc` slots — fixtures ship inside the image.
 *
 * Nothing in the suite could see this before, because a temporary directory in a test
 * outlives the test. These three delete the file behind the row on purpose.
 */
describe('a cached block whose file is gone', () => {
  async function fetchThenDeleteFile(): Promise<{ harness: Harness; calls: number[] }> {
    const rpc = node()
    const harness = await openHarness({ rpc: { url: RPC_URL, fetchImpl: rpc.fetchImpl } })

    await harness.api('/slots/fetch', { method: 'POST', json: { slot: UNKNOWN_SLOT } })
    const path = slotPath(harness.dirs.cache, UNKNOWN_SLOT)
    expect(existsSync(path)).toBe(true)
    rmSync(path)

    return { harness, calls: rpc.calls }
  }

  it('is fetched again rather than reported as cached', async () => {
    const { harness, calls } = await fetchThenDeleteFile()
    h = harness

    const response = await h.api('/slots/fetch', { method: 'POST', json: { slot: UNKNOWN_SLOT } })

    expect(response.status).toBe(200)
    expect(fetchSlotResponseSchema.parse(await response.json()).cached).toBe(false)
    expect(calls).toEqual([UNKNOWN_SLOT, UNKNOWN_SLOT])
    expect(existsSync(slotPath(h.dirs.cache, UNKNOWN_SLOT))).toBe(true)
  })

  it('says what happened and what to do about it, rather than failing', async () => {
    const { harness } = await fetchThenDeleteFile()
    h = harness

    const response = await h.api(`/slots/${UNKNOWN_SLOT}`)

    // Not a 500: the block is recoverable and the caller is the one who can recover
    // it. A bare server error would send them to read our logs instead.
    expect(response.status).toBe(404)
    const { error } = apiErrorSchema.parse(await response.json())
    expect(error.code).toBe('NOT_FOUND')
    expect(error.details.hint).toContain('POST /slots/fetch')
  })

  /**
   * A run still answers while this process is the one that fetched the block: the
   * parsed bundle is in memory, and it is the same bundle whichever way it is read.
   * Losing the file does not make the block wrong — it makes it unreadable **next
   * time**, and the next time is a new process.
   */
  it('still runs while the parsed block is in this process, and stops after a restart', async () => {
    const { harness } = await fetchThenDeleteFile()
    h = harness

    await h.api('/policies', { method: 'POST', json: { body: POLICY } })
    const response = await h.api('/runs', {
      method: 'POST',
      json: { hash: policyHash(POLICY), slot: UNKNOWN_SLOT },
    })
    expect(response.status).toBe(200)

    // The restart, faithfully: a new store over the same directories and the same
    // rows, with nothing kept in memory. This is what the host hands us every time
    // it wakes the service up.
    const restarted = new SlotStore(h.dirs)
    await expect(restarted.read(h.db, UNKNOWN_SLOT)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('POST /slots/fetch', () => {
  it('is a closed door while the server has no RPC address', async () => {
    h = await openHarness()

    const response = await h.api('/slots/fetch', { method: 'POST', json: { slot: UNKNOWN_SLOT } })
    expect(response.status).toBe(403)
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('RPC_DISABLED')
  })

  it('answers a slot already on disk from the index, without the network', async () => {
    const rpc = node()
    h = await openHarness({ rpc: { url: RPC_URL, fetchImpl: rpc.fetchImpl } })

    const response = await h.api('/slots/fetch', { method: 'POST', json: { slot: FIXTURE_SLOT } })
    expect(response.status).toBe(200)
    expect(fetchSlotResponseSchema.parse(await response.json())).toEqual({
      slot: FIXTURE_SLOT,
      txCount: 6,
      cached: true,
    })
    expect(rpc.calls).toEqual([])
  })

  it('fetches a new slot once, caches it in the fixture format, and it is then a slot like any other', async () => {
    const rpc = node()
    h = await openHarness({ rpc: { url: RPC_URL, fetchImpl: rpc.fetchImpl } })

    const first = await h.api('/slots/fetch', { method: 'POST', json: { slot: UNKNOWN_SLOT } })
    expect(first.status).toBe(200)
    expect(fetchSlotResponseSchema.parse(await first.json())).toEqual({
      slot: UNKNOWN_SLOT,
      txCount: 3,
      cached: false,
    })
    expect(rpc.calls).toEqual([UNKNOWN_SLOT])
    expect(existsSync(slotPath(h.dirs.cache, UNKNOWN_SLOT))).toBe(true)

    // The second time is the cache, not the node (FR-024).
    const second = await h.api('/slots/fetch', { method: 'POST', json: { slot: UNKNOWN_SLOT } })
    expect(fetchSlotResponseSchema.parse(await second.json()).cached).toBe(true)
    expect(rpc.calls).toEqual([UNKNOWN_SLOT])

    // Listed as rpc, served as a file, and runnable.
    const listed = listSlotsResponseSchema.parse(await (await h.api('/slots?source=rpc')).json())
    expect(listed).toEqual([{ slot: UNKNOWN_SLOT, source: 'rpc', txCount: 3, hasLabels: false }])
    expect((await h.api(`/slots/${UNKNOWN_SLOT}`)).status).toBe(200)

    await h.api('/policies', { method: 'POST', json: { body: POLICY } })
    const run = await h.api('/runs', {
      method: 'POST',
      json: { hash: policyHash(POLICY), slot: UNKNOWN_SLOT },
    })
    expect(run.status).toBe(200)
    expect(runSchema.parse(await run.json()).metrics.recorded).toBe(3)
  })

  it('shares one fetch between requests that race for the same new slot', async () => {
    const rpc = node()
    h = await openHarness({ rpc: { url: RPC_URL, fetchImpl: rpc.fetchImpl } })

    const responses = await Promise.all(
      [1, 2, 3].map(() => h?.api('/slots/fetch', { method: 'POST', json: { slot: UNKNOWN_SLOT } })),
    )
    expect(responses.map((response) => response?.status)).toEqual([200, 200, 200])
    expect(rpc.calls).toEqual([UNKNOWN_SLOT])
  })

  it('a slot the node has no block for is 404, not a failure', async () => {
    const rpc = node(() => refused(-32009, 'Slot 441394402 was skipped, or missing'))
    h = await openHarness({ rpc: { url: RPC_URL, fetchImpl: rpc.fetchImpl } })

    const response = await h.api('/slots/fetch', { method: 'POST', json: { slot: UNKNOWN_SLOT } })
    expect(response.status).toBe(404)
    expect(apiErrorSchema.parse(await response.json()).error).toMatchObject({
      code: 'NOT_FOUND',
      details: { slot: UNKNOWN_SLOT, rpcCode: -32009 },
    })
    expect(existsSync(slotPath(h.dirs.cache, UNKNOWN_SLOT))).toBe(false)
  })

  it('a node that fails is 502, and the answer never quotes the RPC address', async () => {
    const rpc = node(() => new Response(`${RPC_URL} says no`, { status: 503 }))
    h = await openHarness({ rpc: { url: RPC_URL, fetchImpl: rpc.fetchImpl } })

    const response = await h.api('/slots/fetch', { method: 'POST', json: { slot: UNKNOWN_SLOT } })
    expect(response.status).toBe(502)

    const text = JSON.stringify(await response.json())
    expect(text).toContain('RPC_FAILED')
    expect(text).toContain('503')
    expect(text).not.toContain('secret-key')
    expect(text).not.toContain('rpc.example')
  })

  it('a block in a shape the normaliser rejects is 502 with the first issues', async () => {
    const rpc = node(() => ok({ blockTime: 1, transactions: [{ nothing: true }] }))
    h = await openHarness({ rpc: { url: RPC_URL, fetchImpl: rpc.fetchImpl } })

    const response = await h.api('/slots/fetch', { method: 'POST', json: { slot: UNKNOWN_SLOT } })
    expect(response.status).toBe(502)
    expect(apiErrorSchema.parse(await response.json()).error.details).toMatchObject({
      slot: UNKNOWN_SLOT,
      issues: expect.arrayContaining([expect.objectContaining({ path: expect.any(Array) })]),
    })
  })

  it('refuses a malformed body in the one envelope', async () => {
    h = await openHarness({ rpc: { url: RPC_URL } })

    const response = await h.api('/slots/fetch', { method: 'POST', json: { slot: '7' } })
    expect(response.status).toBe(400)
  })
})

describe('the fetch limit', () => {
  it('allows ten a minute from one address, then 429 with retry-after, then again', async () => {
    let clock = 1_000_000
    h = await openHarness({ rpc: { url: RPC_URL, fetchImpl: node().fetchImpl }, now: () => clock })
    const from = (address: string) =>
      h?.api('/slots/fetch', {
        method: 'POST',
        headers: { 'x-forwarded-for': `${address}, 10.0.0.1` },
        json: { slot: FIXTURE_SLOT },
      })

    for (let call = 0; call < FETCH_LIMIT.limit; call++) {
      clock += 1000
      expect((await from('203.0.113.7'))?.status).toBe(200)
    }

    const refusal = await from('203.0.113.7')
    expect(refusal?.status).toBe(429)
    expect(refusal?.headers.get('retry-after')).toBe('51')
    expect(apiErrorSchema.parse(await refusal?.json()).error).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: 51 },
    })

    // Somebody else is not in this bucket, and the bucket drains with the clock.
    expect((await from('203.0.113.8'))?.status).toBe(200)
    clock += FETCH_LIMIT.windowMs
    expect((await from('203.0.113.7'))?.status).toBe(200)
  })

  it('counts a refused fetch too: a closed door still has a limit', async () => {
    let clock = 0
    h = await openHarness({ now: () => clock })

    for (let call = 0; call < FETCH_LIMIT.limit; call++) {
      clock += 1
      expect(
        (await h.api('/slots/fetch', { method: 'POST', json: { slot: UNKNOWN_SLOT } })).status,
      ).toBe(403)
    }
    expect(
      (await h.api('/slots/fetch', { method: 'POST', json: { slot: UNKNOWN_SLOT } })).status,
    ).toBe(429)
  })
})
