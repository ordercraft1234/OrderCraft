import type { Policy } from '../../src/policy/schema.ts'
import { PROGRAMS, WSOL_MINT } from '../../src/presets/programs.ts'

export const SPEED_BUMP: Policy = {
  schemaVersion: 1,
  name: 'One speed bump',
  steps: [{ kind: 'speedBump', delayMs: 120, appliesTo: { match: 'all' } }],
}

/** Every selector branch, both rule effects, and the edges of every range. */
export const EDGES: Array<[string, Policy]> = [
  ['the smallest policy', SPEED_BUMP],
  [
    'every selector branch',
    {
      schemaVersion: 1,
      name: 'Every selector',
      steps: [
        {
          kind: 'speedBump',
          delayMs: 0,
          appliesTo: { match: 'program', programs: [PROGRAMS.pumpFun] },
        },
        {
          kind: 'speedBump',
          delayMs: 400,
          appliesTo: { match: 'signer', signers: [PROGRAMS.humidiFi, PROGRAMS.zeroFi] },
        },
        {
          kind: 'batchAuction',
          windowMs: 50,
          appliesTo: { match: 'account', accounts: [WSOL_MINT] },
        },
        {
          kind: 'allowDeny',
          rules: [
            {
              effect: 'prioritise',
              match: { match: 'tokenDeltaAbove', mint: WSOL_MINT, amount: '0' },
            },
            {
              effect: 'deny',
              match: { match: 'tokenDeltaAbove', mint: WSOL_MINT, amount: '18446744073709551615' },
            },
          ],
        },
      ],
    },
  ],
  [
    'twelve steps',
    {
      schemaVersion: 1,
      name: 'Twelve steps',
      steps: Array.from({ length: 12 }, (_, index) => ({
        kind: 'speedBump' as const,
        delayMs: index * 30,
        appliesTo: { match: 'all' as const },
      })),
    },
  ],
  [
    'twenty rules',
    {
      schemaVersion: 1,
      name: 'Twenty rules',
      steps: [
        {
          kind: 'allowDeny',
          rules: Array.from({ length: 20 }, () => ({
            effect: 'prioritise' as const,
            match: { match: 'program' as const, programs: [PROGRAMS.tesseraV] },
          })),
        },
      ],
    },
  ],
  [
    'a name JSON has to escape',
    {
      schemaVersion: 1,
      name: 'Ціна «до» і "після"\\\n\t☃ 𝄞',
      steps: [{ kind: 'batchAuction', windowMs: 400, appliesTo: { match: 'all' } }],
    },
  ],
]

/** Keys reversed at every depth: what another tool may write when it saves the file. */
export function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reverseKeys(item)]),
  )
}

/**
 * A deterministic sweep: every step kind and selector branch, lengths up to the
 * limits, the same `count` policies on every run.
 */
export function generatedPolicies(count: number): Policy[] {
  let seed = 41
  const next = (bound: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
    return seed % bound
  }
  const addresses: string[] = Object.values(PROGRAMS)
  const address = () => addresses[next(addresses.length)] ?? WSOL_MINT
  const selector = () => {
    switch (next(5)) {
      case 0:
        return { match: 'all' as const }
      case 1:
        return { match: 'program' as const, programs: [address()] }
      case 2:
        return { match: 'signer' as const, signers: [address()] }
      case 3:
        return { match: 'account' as const, accounts: [WSOL_MINT] }
      default:
        return {
          match: 'tokenDeltaAbove' as const,
          mint: WSOL_MINT,
          amount: String(next(1_000_000)),
        }
    }
  }

  return Array.from({ length: count }, (_, round): Policy => {
    const steps = Array.from({ length: 1 + next(12) }, (): Policy['steps'][number] => {
      switch (next(3)) {
        case 0:
          return { kind: 'speedBump', delayMs: next(401), appliesTo: selector() }
        case 1:
          return { kind: 'batchAuction', windowMs: 50 + next(351), appliesTo: selector() }
        default:
          return {
            kind: 'allowDeny',
            rules: Array.from({ length: 1 + next(20) }, () => ({
              effect: next(2) === 0 ? ('prioritise' as const) : ('deny' as const),
              match: selector(),
            })),
          }
      }
    })
    return { schemaVersion: 1, name: `Generated ${round}`, steps }
  })
}
