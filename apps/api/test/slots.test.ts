import { gunzipSync } from 'node:zlib'
import { slotBundleSchema } from '@ordercraft/core'
import { decodeSlotBundle } from '@ordercraft/fixtures'
import { apiErrorSchema, listSlotsResponseSchema } from '@ordercraft/shared'
import { writeSlot } from '@ordercraft/slots'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  FIXTURE_SLOT,
  type Harness,
  PLAIN_SLOT,
  UNKNOWN_SLOT,
  openHarness,
  quietSlot,
  sandwichSlot,
} from './harness.ts'

let h: Harness

beforeAll(async () => {
  h = await openHarness()
}, 60_000)

afterAll(() => h.close())

describe('GET /slots', () => {
  it('lists what the boot indexed, with labels where a file exists', async () => {
    const response = await h.api('/slots')
    expect(response.status).toBe(200)

    expect(listSlotsResponseSchema.parse(await response.json())).toEqual([
      { slot: FIXTURE_SLOT, source: 'fixture', txCount: 6, hasLabels: true },
      { slot: PLAIN_SLOT, source: 'fixture', txCount: 3, hasLabels: false },
    ])
  })

  it('filters by source and refuses one it does not know', async () => {
    expect(await (await h.api('/slots?source=rpc')).json()).toEqual([])
    expect((await (await h.api('/slots?source=fixture')).json()) as unknown[]).toHaveLength(2)
    expect((await h.api('/slots?source=cache')).status).toBe(400)
  })

  it('indexing again reads nothing it already knows', async () => {
    expect(await h.store.syncFixtures(h.db)).toBe(0)

    writeSlot(h.dirs.fixtures, quietSlot(UNKNOWN_SLOT))
    expect(await h.store.syncFixtures(h.db)).toBe(1)
    expect((await (await h.api('/slots')).json()) as unknown[]).toHaveLength(3)
  })
})

describe('GET /slots/:slot', () => {
  it('hands the file over as gzip that the fixture loader decodes', async () => {
    const response = await h.api(`/slots/${FIXTURE_SLOT}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('content-encoding')).toBe('gzip')

    // `app.request` does not unpack for us the way a browser would.
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(await decodeSlotBundle(bytes)).toEqual(sandwichSlot(FIXTURE_SLOT))
    expect(slotBundleSchema.parse(JSON.parse(gunzipSync(bytes).toString('utf8')))).toEqual(
      sandwichSlot(FIXTURE_SLOT),
    )
  })

  it('a slot nobody loaded is 404 with a hint, a non-number is 400', async () => {
    const missing = await h.api(`/slots/${UNKNOWN_SLOT + 1}`)
    expect(missing.status).toBe(404)
    expect(apiErrorSchema.parse(await missing.json()).error.details).toMatchObject({
      slot: UNKNOWN_SLOT + 1,
      hint: expect.stringContaining('/slots/fetch'),
    })

    expect((await h.api('/slots/latest')).status).toBe(400)
  })
})
