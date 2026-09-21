import { policyHash } from '@ordercraft/core'
import { apiErrorSchema, hydrateOrdering, runSchema } from '@ordercraft/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ATTACKER,
  FIXTURE_SLOT,
  type Harness,
  PLAIN_SLOT,
  POLICY,
  QUOTE,
  UNKNOWN_SLOT,
  openHarness,
  sandwichSlot,
} from './harness.ts'

let h: Harness
const hash = policyHash(POLICY)

beforeAll(async () => {
  h = await openHarness()
  await h.api('/policies', { method: 'POST', json: { body: POLICY } })
}, 60_000)

afterAll(() => h.close())

describe('POST /runs', () => {
  it('runs the policy on the slot and answers with the whole run', async () => {
    const response = await h.api('/runs', { method: 'POST', json: { hash, slot: FIXTURE_SLOT } })
    expect(response.status).toBe(200)

    const run = runSchema.parse(await response.json())
    expect(run.policyHash).toBe(hash)
    expect(run.slot).toBe(FIXTURE_SLOT)

    // The detector marked the triple on the recorded block …
    expect(run.baseline.attacks).toHaveLength(1)
    expect(run.baseline.attacks[0]).toMatchObject({
      front: 1,
      victims: [2],
      back: 3,
      signer: ATTACKER,
    })
    expect(run.baseline.attacks[0]?.extracted).toEqual({
      tokens: [{ mint: QUOTE, amount: 100n }],
      lamports: 0n,
      fees: 10_000n,
    })

    // … the policy broke it, and the metrics say what it did to the block.
    expect(run.result.outcomes).toEqual([{ broken: true, reason: 'orderChanged', by: 'speedBump' }])
    expect(run.metrics.recorded).toBe(6)
    expect(run.metrics.included + run.metrics.deferred + run.metrics.dropped).toBe(6)

    // The ordering comes back without signatures and hydrates against the slot.
    const ordering = hydrateOrdering(run.result.ordering, sandwichSlot(FIXTURE_SLOT))
    expect(ordering.included.length + ordering.excluded.length).toBe(6)
  })

  it('is idempotent: the second request returns the first run, id and all', async () => {
    const first = runSchema.parse(
      await (await h.api('/runs', { method: 'POST', json: { hash, slot: FIXTURE_SLOT } })).json(),
    )
    const second = runSchema.parse(
      await (await h.api('/runs', { method: 'POST', json: { hash, slot: FIXTURE_SLOT } })).json(),
    )
    expect(second).toEqual(first)

    const rows = await h.db.query.runs.findMany()
    expect(rows).toHaveLength(1)
  })

  it('a different slot is a different run', async () => {
    const run = runSchema.parse(
      await (await h.api('/runs', { method: 'POST', json: { hash, slot: PLAIN_SLOT } })).json(),
    )
    expect(run.slot).toBe(PLAIN_SLOT)
    expect(run.baseline.attacks).toEqual([])
    expect(run.result.outcomes).toEqual([])
    expect(run.metrics.recorded).toBe(3)
  })

  it('refuses a version that was never saved and a slot that was never loaded', async () => {
    const noVersion = await h.api('/runs', {
      method: 'POST',
      json: { hash: policyHash({ ...POLICY, name: 'unsaved' }), slot: FIXTURE_SLOT },
    })
    expect(noVersion.status).toBe(404)
    expect(apiErrorSchema.parse(await noVersion.json()).error.details).toMatchObject({
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })

    const noSlot = await h.api('/runs', { method: 'POST', json: { hash, slot: UNKNOWN_SLOT } })
    expect(noSlot.status).toBe(404)
    expect(apiErrorSchema.parse(await noSlot.json()).error.details).toMatchObject({
      slot: UNKNOWN_SLOT,
    })
  })

  it('refuses a malformed request in the one envelope', async () => {
    const response = await h.api('/runs', { method: 'POST', json: { hash, slot: '1' } })
    expect(response.status).toBe(400)
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('INVALID_INPUT')
  })
})

describe('GET /runs/:id', () => {
  it('opens the same run by its id without computing again', async () => {
    const created = runSchema.parse(
      await (await h.api('/runs', { method: 'POST', json: { hash, slot: FIXTURE_SLOT } })).json(),
    )

    const response = await h.api(`/runs/${created.id}`)
    expect(response.status).toBe(200)
    expect(runSchema.parse(await response.json())).toEqual(created)
  })

  it('an unknown id is 404, a malformed one 400', async () => {
    expect((await h.api('/runs/00000000-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await h.api('/runs/42')).status).toBe(400)
  })
})
