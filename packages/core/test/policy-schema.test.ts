import { describe, expect, it } from 'vitest'
import { PRIMITIVES, policySchema } from '../src/policy/schema.ts'

const SIGNER = '7QmXo9tXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const POOL = 'CbjY8Wohs2EnLLjSNMPkFrn9iaPvVJJtAdJiWRYeeN2x'
const PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const MINT = 'CWZ6BsdnjkDVTGkmL6bGbJXXig6ceef12KvyGQW14cMt'

const antiSnipe = {
  schemaVersion: 1,
  name: 'Anti-snipe launch',
  steps: [
    { kind: 'speedBump', delayMs: 120, appliesTo: { match: 'account', accounts: [POOL] } },
    { kind: 'batchAuction', windowMs: 250, appliesTo: { match: 'all' } },
    {
      kind: 'allowDeny',
      rules: [{ effect: 'deny', match: { match: 'signer', signers: [SIGNER] } }],
    },
  ],
}

describe('policySchema', () => {
  it('accepts a policy built from the three primitives', () => {
    const policy = policySchema.parse(antiSnipe)

    expect(policy.steps).toHaveLength(3)
    expect(policy.steps[0]?.kind).toBe('speedBump')
  })

  it('accepts every selector the slot can answer', () => {
    const selectors = [
      { match: 'all' },
      { match: 'program', programs: [PROGRAM] },
      { match: 'signer', signers: [SIGNER] },
      { match: 'account', accounts: [POOL] },
      { match: 'tokenDeltaAbove', mint: MINT, amount: '5000000000' },
    ]

    for (const appliesTo of selectors) {
      expect(() =>
        policySchema.parse({
          ...antiSnipe,
          steps: [{ kind: 'speedBump', delayMs: 10, appliesTo }],
        }),
      ).not.toThrow()
    }
  })

  it('holds each parameter to the range the registry publishes', () => {
    const speedBump = PRIMITIVES.find((primitive) => primitive.kind === 'speedBump')
    const batch = PRIMITIVES.find((primitive) => primitive.kind === 'batchAuction')

    expect(speedBump?.parameter).toMatchObject({ min: 0, max: 400, unit: 'ms' })
    expect(batch?.parameter).toMatchObject({ min: 50, max: 400, unit: 'ms' })

    const withDelay = (delayMs: number) => ({
      ...antiSnipe,
      steps: [{ kind: 'speedBump', delayMs, appliesTo: { match: 'all' } }],
    })

    expect(() => policySchema.parse(withDelay(401))).toThrow()
    expect(() => policySchema.parse(withDelay(-1))).toThrow()
    expect(() => policySchema.parse(withDelay(400))).not.toThrow()
  })

  it('refuses a batch window shorter than the registry allows', () => {
    const tooShort = {
      ...antiSnipe,
      steps: [{ kind: 'batchAuction', windowMs: 49, appliesTo: { match: 'all' } }],
    }

    expect(() => policySchema.parse(tooShort)).toThrow()
  })

  it('refuses a fractional parameter', () => {
    const fractional = {
      ...antiSnipe,
      steps: [{ kind: 'speedBump', delayMs: 120.5, appliesTo: { match: 'all' } }],
    }

    expect(() => policySchema.parse(fractional)).toThrow()
  })

  it('refuses an unknown primitive', () => {
    const unknown = { ...antiSnipe, steps: [{ kind: 'orderPrivacy', appliesTo: { match: 'all' } }] }

    expect(() => policySchema.parse(unknown)).toThrow()
  })

  it('refuses an address that is not base58', () => {
    const zeroInKey = {
      ...antiSnipe,
      steps: [
        { kind: 'speedBump', delayMs: 10, appliesTo: { match: 'signer', signers: [`0${SIGNER}`] } },
      ],
    }

    expect(() => policySchema.parse(zeroInKey)).toThrow()
  })

  it('refuses an empty policy and an empty selector list', () => {
    expect(() => policySchema.parse({ ...antiSnipe, steps: [] })).toThrow()
    expect(() =>
      policySchema.parse({
        ...antiSnipe,
        steps: [{ kind: 'speedBump', delayMs: 10, appliesTo: { match: 'signer', signers: [] } }],
      }),
    ).toThrow()
  })

  it('refuses more than twenty allow/deny rules', () => {
    const rules = Array.from({ length: 21 }, () => ({
      effect: 'deny',
      match: { match: 'signer', signers: [SIGNER] },
    }))

    expect(() =>
      policySchema.parse({ ...antiSnipe, steps: [{ kind: 'allowDeny', rules }] }),
    ).toThrow()
    expect(() =>
      policySchema.parse({
        ...antiSnipe,
        steps: [{ kind: 'allowDeny', rules: rules.slice(0, 20) }],
      }),
    ).not.toThrow()
  })

  it('strips nothing and adds nothing — what goes in is what gets hashed', () => {
    expect(policySchema.parse(antiSnipe)).toEqual(antiSnipe)
  })
})
