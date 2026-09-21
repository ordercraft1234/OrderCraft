import {
  type NormalizedTransaction,
  POLICY_SCHEMA_VERSION,
  type Policy,
  SLOT_SCHEMA_VERSION,
  type SlotBundle,
  apply,
  policyHash,
} from '@ordercraft/core'
import { type Run, serializeOrdering } from '../src/runs.ts'

export const AMM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const POOL = 'CbjY8Wohs2EnLLjSNMPkFrn9iaPvVJJtAdJiWRYeeN2x'
export const SIGNER = '7QmXo9tXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
export const MINT = '4QXnu6ycbvJRQ1eyhF2egtwURhChYHQGpjr5P9fgpump'
export const QUOTE = 'So11111111111111111111111111111111111111112'

export const SLOT = 441394400
export const RUN_ID = '3f0c2c5e-9a2b-4d7e-8f11-6b2a1c9d0e42'
export const CREATED_AT = '2026-09-21T10:00:00.000Z'

const DIGIT_LETTERS = 'abcdefghij'

function signatureFor(index: number): string {
  const body = [...String(index)].map((digit) => DIGIT_LETTERS[Number(digit)] ?? 'a').join('')
  return `sig${body}`.padEnd(44, 'x')
}

export function tx(index: number): NormalizedTransaction {
  return {
    index,
    signature: signatureFor(index),
    signers: [SIGNER],
    programs: [AMM],
    accounts: [SIGNER, POOL, AMM],
    fee: 5000n,
    failed: false,
    computeUnits: 150000n,
    lamportDelta: {},
    tokenDelta: [],
  }
}

export function bundleOf(count: number): SlotBundle {
  return {
    schemaVersion: SLOT_SCHEMA_VERSION,
    slot: SLOT,
    blockTime: 1787574541,
    transactions: Array.from({ length: count }, (_, index) => tx(index)),
  }
}

/** A speed bump on everything, so that every placement moves and some fall off the end. */
export const POLICY: Policy = {
  schemaVersion: POLICY_SCHEMA_VERSION,
  name: 'bump everything',
  steps: [{ kind: 'speedBump', delayMs: 100, appliesTo: { match: 'all' } }],
}

/** A run over `bundle` with one attack marked on it, bigints and all. */
export function runOver(bundle: SlotBundle): Run {
  const ordering = apply(POLICY, bundle)

  return {
    id: RUN_ID,
    policyHash: policyHash(POLICY),
    slot: bundle.slot,
    baseline: {
      attacks: [
        {
          front: 0,
          victims: [1],
          back: 2,
          signer: SIGNER,
          mint: MINT,
          pool: POOL,
          extracted: {
            tokens: [
              { mint: MINT, amount: -4_000_000_000_000_000_000n },
              { mint: QUOTE, amount: 12_345_678_901_234_567_890n },
            ],
            lamports: -10_000n,
            fees: 10_000n,
          },
        },
      ],
    },
    result: {
      ordering: serializeOrdering(ordering),
      outcomes: [{ broken: true, reason: 'orderChanged', by: 'speedBump' }],
    },
    metrics: {
      recorded: bundle.transactions.length,
      included: ordering.included.length,
      deferred: ordering.excluded.length,
      dropped: 0,
      moved: 0,
      delayed: ordering.included.length,
      reorderedPerMille: 0,
      addedDelayMs: { p10: 100, p50: 100, p90: 100, p95: 100, max: 100 },
    },
    createdAt: CREATED_AT,
  }
}
