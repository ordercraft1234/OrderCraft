import { POLICY_SCHEMA_VERSION, type Policy } from '../policy/schema.ts'
import { PROGRAMS, WSOL_MINT } from './programs.ts'

/**
 * A named starting point (FR-014). The composition of primitives is `policy.steps`
 * itself rather than a second field that could drift from it.
 *
 * Presets live in code, not in the database: a run is `(policyHash, slot)`, and a
 * preset edited in a table would make every run that started from it unreproducible.
 * The hash of each preset is pinned in `test/presets.test.ts`.
 */
export interface Preset {
  /** Stable, kebab-case. Stored with a policy version as its origin (FR-015). */
  id: string
  /** Equal to `policy.name`, so the builder shows the same words either way. */
  name: string
  /** What the policy does to a block. */
  description: string
  /** When to reach for it. */
  scenario: string
  policy: Policy
}

const LAUNCHPADS = [PROGRAMS.pumpFun, PROGRAMS.meteoraDbc, PROGRAMS.raydiumLaunchLab]
const QUOTING_AMMS = [PROGRAMS.humidiFi, PROGRAMS.tesseraV, PROGRAMS.zeroFi]

/** One wSOL. Below this a swap is too small to be worth placing a pair of legs around. */
const ONE_WSOL = '1000000000'

function preset(fields: Omit<Preset, 'policy'> & { steps: Policy['steps'] }): Preset {
  const { steps, ...rest } = fields
  return {
    ...rest,
    policy: { schemaVersion: POLICY_SCHEMA_VERSION, name: fields.name, steps },
  }
}

const LIBRARY: Preset[] = [
  preset({
    id: 'anti-snipe-launch',
    name: 'Anti-snipe launch',
    description:
      'Holds every launchpad transaction for 120 ms, then settles them in 250 ms windows. Buys that landed first because they were sent first end up in the same window as the ones right behind them.',
    scenario:
      'A token launching on pump.fun, Meteora DBC or Raydium LaunchLab, where the first milliseconds of the curve go to whoever is fastest.',
    steps: [
      { kind: 'speedBump', delayMs: 120, appliesTo: { match: 'program', programs: LAUNCHPADS } },
      {
        kind: 'batchAuction',
        windowMs: 250,
        appliesTo: { match: 'program', programs: LAUNCHPADS },
      },
    ],
  }),
  preset({
    id: 'maker-quotes-first',
    name: 'Market-maker quotes first',
    description:
      'Puts quote updates of HumidiFi, Tessera V and ZeroFi ahead of everything else in the block. In the curated slots these programs never move a token, so the class is quote updates and nothing else.',
    scenario:
      'A proprietary AMM whose quotes are taken stale by a taker who lands between the price moving and the quote following it.',
    steps: [
      {
        kind: 'allowDeny',
        rules: [{ effect: 'prioritise', match: { match: 'program', programs: QUOTING_AMMS } }],
      },
    ],
  }),
  preset({
    id: 'batched-swaps',
    name: 'Batched swap flow',
    description:
      'Settles every transaction moving more than 1 wSOL in 200 ms windows. Inside a window the model has no before and after, which is the position a pair of legs around a swap depends on.',
    scenario:
      'A block where large swaps sit next to each other and the order between them is worth something to a third party.',
    steps: [
      {
        kind: 'batchAuction',
        windowMs: 200,
        appliesTo: { match: 'tokenDeltaAbove', mint: WSOL_MINT, amount: ONE_WSOL },
      },
    ],
  }),
]

/** Frozen all the way down: a caller that edits a preset gets its own copy or an error. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}

export const PRESETS: readonly Preset[] = deepFreeze(LIBRARY)

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((candidate) => candidate.id === id)
}
