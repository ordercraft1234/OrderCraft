import {
  type NormalizedTransaction,
  SLOT_SCHEMA_VERSION,
  type SlotBundle,
} from '../../src/slot/schema.ts'

export const POOL = 'CbjY8Wohs2EnLLjSNMPkFrn9iaPvVJJtAdJiWRYeeN2x'
export const AMM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const VOTE = 'Vote111111111111111111111111111111111111111'
export const ATTACKER = '7QmXo9tXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
export const VICTIM = 'Ka91rW7dWD4BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
export const MINT = '4QXnu6ycbvJRQ1eyhF2egtwURhChYHQGpjr5P9fgpump'
/** The side of the pair an attacker holds in its own wallet, in practice SOL. */
export const QUOTE = 'So11111111111111111111111111111111111111112'
export const OTHER_SIGNER = 'BvEQ8sT2ZmXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh'

/** Digits mapped onto letters, because base58 has no `0` and signatures must parse. */
const DIGIT_LETTERS = 'abcdefghij'

function signatureFor(index: number): string {
  const body = [...String(index)].map((digit) => DIGIT_LETTERS[Number(digit)] ?? 'a').join('')
  return `sig${body}`.padEnd(44, 'x')
}

export function tx(
  index: number,
  overrides: Partial<NormalizedTransaction> = {},
): NormalizedTransaction {
  return {
    index,
    signature: signatureFor(index),
    signers: [ATTACKER],
    programs: [AMM],
    accounts: [ATTACKER, POOL, AMM],
    fee: 5000n,
    failed: false,
    computeUnits: 150000n,
    lamportDelta: {},
    tokenDelta: [],
    ...overrides,
  }
}

export function bundleOf(transactions: NormalizedTransaction[]): SlotBundle {
  return {
    schemaVersion: SLOT_SCHEMA_VERSION,
    slot: 441394400,
    blockTime: 1787574541,
    transactions,
  }
}
