import { policyHash } from '@ordercraft/core'
import {
  apiErrorSchema,
  createPolicyResponseSchema,
  policyVersionViewSchema,
  policyViewSchema,
} from '@ordercraft/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Harness, POLICY, UNRUNNABLE_POLICY, openHarness } from './harness.ts'

let h: Harness

beforeAll(async () => {
  h = await openHarness()
}, 60_000)

afterAll(() => h.close())

describe('POST /policies', () => {
  it('saves a version under its hash and opens a shelf named after it', async () => {
    const response = await h.api('/policies', { method: 'POST', json: { body: POLICY } })
    expect(response.status).toBe(201)

    const saved = createPolicyResponseSchema.parse(await response.json())
    expect(saved.hash).toBe(policyHash(POLICY))
    expect(saved.created).toBe(true)

    const shelf = policyViewSchema.parse(await (await h.api(`/policies/${saved.policyId}`)).json())
    expect(shelf.name).toBe(POLICY.name)
    expect(shelf.versions.map((version) => version.hash)).toEqual([saved.hash])
  })

  it('answers the same body with the same address and writes nothing', async () => {
    const first = createPolicyResponseSchema.parse(
      await (await h.api('/policies', { method: 'POST', json: { body: POLICY } })).json(),
    )
    const response = await h.api('/policies', { method: 'POST', json: { body: POLICY } })
    expect(response.status).toBe(200)

    const again = createPolicyResponseSchema.parse(await response.json())
    expect(again).toEqual({ ...first, created: false })
  })

  it('puts a new version on the shelf it is told to', async () => {
    const first = createPolicyResponseSchema.parse(
      await (await h.api('/policies', { method: 'POST', json: { body: POLICY } })).json(),
    )
    const revised = { ...POLICY, name: 'bump the attacker, revised' }

    const second = createPolicyResponseSchema.parse(
      await (
        await h.api('/policies', {
          method: 'POST',
          json: { body: revised, policyId: first.policyId, presetId: 'fair-launch' },
        })
      ).json(),
    )
    expect(second.policyId).toBe(first.policyId)
    expect(second.hash).toBe(policyHash(revised))

    const shelf = policyViewSchema.parse(await (await h.api(`/policies/${first.policyId}`)).json())
    expect(shelf.versions).toHaveLength(2)
    expect(shelf.versions[0]?.hash).toBe(second.hash)
    expect(shelf.versions[0]?.presetId).toBe('fair-launch')
  })

  it('refuses a shelf that does not exist', async () => {
    const response = await h.api('/policies', {
      method: 'POST',
      json: {
        body: { ...POLICY, name: 'orphan' },
        policyId: '00000000-0000-4000-8000-000000000000',
      },
    })
    expect(response.status).toBe(404)
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('refuses a body the schema rejects, issue by issue', async () => {
    const response = await h.api('/policies', {
      method: 'POST',
      json: { body: { ...POLICY, steps: [] } },
    })
    expect(response.status).toBe(400)

    const { error } = apiErrorSchema.parse(await response.json())
    expect(error.code).toBe('INVALID_INPUT')
    expect(error.details.issues).toEqual([
      { path: ['body', 'steps'], message: 'a policy needs at least one step' },
    ])
  })

  it('refuses a policy the kernel would not run', async () => {
    const response = await h.api('/policies', {
      method: 'POST',
      json: { body: UNRUNNABLE_POLICY },
    })
    expect(response.status).toBe(400)

    const { error } = apiErrorSchema.parse(await response.json())
    expect(error.code).toBe('INVALID_INPUT')
    expect(error.details.issues).toMatchObject([{ code: 'denies-everything' }])
  })

  it('refuses a body past 64 KB before reading it', async () => {
    const response = await h.api('/policies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: { ...POLICY, name: 'x'.repeat(70_000) } }),
    })
    expect(response.status).toBe(413)
  })
})

describe('GET /policies', () => {
  it('a version by hash carries its body and its shelf', async () => {
    const saved = createPolicyResponseSchema.parse(
      await (await h.api('/policies', { method: 'POST', json: { body: POLICY } })).json(),
    )

    const version = policyVersionViewSchema.parse(
      await (await h.api(`/policies/hash/${saved.hash}`)).json(),
    )
    expect(version.body).toEqual(POLICY)
    expect(version.policyId).toBe(saved.policyId)
  })

  it('an unknown hash and an unknown shelf are 404, a malformed one is 400', async () => {
    expect((await h.api(`/policies/hash/${'0'.repeat(64)}`)).status).toBe(404)
    expect((await h.api('/policies/00000000-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await h.api('/policies/hash/abc')).status).toBe(400)
    expect((await h.api('/policies/not-a-uuid')).status).toBe(400)
  })
})
