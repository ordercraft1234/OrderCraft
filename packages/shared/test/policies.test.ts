import { policyHash } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import {
  createPolicyRequestSchema,
  policyHashParamSchema,
  policyVersionViewSchema,
  policyViewSchema,
} from '../src/policies.ts'
import { CREATED_AT, POLICY, RUN_ID } from './helpers.ts'

describe('POST /policies', () => {
  it('takes a body alone', () => {
    const request = createPolicyRequestSchema.parse({ body: POLICY })
    expect(request).toEqual({ body: POLICY })
  })

  it('takes a shelf and a preset to record the version under', () => {
    const request = createPolicyRequestSchema.parse({
      body: POLICY,
      policyId: RUN_ID,
      presetId: 'fair-launch',
    })
    expect(request.policyId).toBe(RUN_ID)
    expect(request.presetId).toBe('fair-launch')
  })

  it('has no name outside the body', () => {
    const result = createPolicyRequestSchema.safeParse({ name: 'x', body: POLICY })
    expect(result.success).toBe(true)
    expect(result.data).not.toHaveProperty('name')
  })

  it('runs the kernel schema on the body', () => {
    const result = createPolicyRequestSchema.safeParse({ body: { ...POLICY, steps: [] } })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['body', 'steps'])
  })

  it('rejects a preset id that is not lower-case dashed words', () => {
    for (const bad of ['Fair Launch', 'fair_launch', '-fair', 'fair-', '']) {
      expect(createPolicyRequestSchema.safeParse({ body: POLICY, presetId: bad }).success).toBe(
        false,
      )
    }
  })
})

describe('policy views', () => {
  const hash = policyHash(POLICY)

  it('a shelf lists at least one version', () => {
    const view = policyViewSchema.parse({
      id: RUN_ID,
      name: POLICY.name,
      createdAt: CREATED_AT,
      versions: [{ hash, presetId: null, createdAt: CREATED_AT }],
    })
    expect(view.versions).toHaveLength(1)

    expect(policyViewSchema.safeParse({ ...view, versions: [] }).success).toBe(false)
  })

  it('a version carries its body and its shelf', () => {
    const view = policyVersionViewSchema.parse({
      hash,
      policyId: RUN_ID,
      body: POLICY,
      presetId: null,
      createdAt: CREATED_AT,
    })
    expect(view.body).toEqual(POLICY)
  })

  it('a timestamp with an offset is refused', () => {
    const result = policyVersionViewSchema.safeParse({
      hash,
      policyId: RUN_ID,
      body: POLICY,
      presetId: null,
      createdAt: '2026-09-21T13:00:00+03:00',
    })
    expect(result.success).toBe(false)
  })

  it('the hash path parameter is the hash and nothing else', () => {
    expect(policyHashParamSchema.safeParse({ hash }).success).toBe(true)
    expect(policyHashParamSchema.safeParse({ hash: `${hash}0` }).success).toBe(false)
  })
})
