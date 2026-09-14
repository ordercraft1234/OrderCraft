import type { PolicyDraft } from './policyDraft.ts'

/**
 * The policy the app opens on, and the only place in the interface holding addresses
 * nobody typed.
 *
 * Every constant here was **measured on the slot the repository ships**
 * (`packages/fixtures`, 445553238), not chosen for looks: the threshold picks out 31
 * transactions of 426 non-vote, and the three signers are the three busiest in that
 * block. A demo that needs the visitor to invent a policy before anything appears fails
 * SC-009, and one built on invented numbers would be the one thing this product may not do.
 *
 * **Re-measured 2026-09-10** when T052 replaced the fixture. The class moved from USDC to
 * wSOL because this block is denominated differently: USDC appears in 21 of its
 * transactions against wSOL's 147, and a threshold on the thinner of the two would select
 * five transactions and call itself a policy.
 *
 * Replacing the fixture invalidates these numbers. `demoPolicy.test.ts` runs the
 * policy against the shipped slot and fails when the class stops selecting anything.
 */

/** Nine decimals, so half a wSOL is 500,000,000 base units. The slot carries no decimals. */
const WSOL = 'So11111111111111111111111111111111111111112'
const HALF_WSOL = '500000000'

/** The three busiest signers in slot 445553238: 12, 10 and 10 transactions. */
const BUSIEST = [
  '83TSSS7qojPowqrrvH23mCrhEJjnJG2ygaf7FEq9ZgKC',
  'FTp1BybZ51NiZKbnZH6MsrV3tUZNauhpQMbBcqYUEr5f',
  'AuNYDxqLav774fntdjAWNoqwNUZzojn7tgXkiNZ8yy6v',
]

/**
 * Three steps, in the order the M0 canvas drew them.
 *
 * The one deviation from the canvas is step 2's class. The canvas batches the **whole
 * block**, and on a real slot that settles every transaction at one of two times,
 * after which the total order is the recorded order again: `moved` comes out 0 and the
 * ribbon field is empty. That is a true result and worth showing deliberately — it is
 * not a landing screen. Batching the same class as the speed bump keeps the primitive
 * and leaves a field to look at.
 */
export function demoDraft(): PolicyDraft {
  return {
    name: 'Anti-snipe launch',
    steps: [
      {
        kind: 'speedBump',
        delayMs: '120',
        appliesTo: { match: 'tokenDeltaAbove', addresses: '', mint: WSOL, amount: HALF_WSOL },
      },
      {
        kind: 'batchAuction',
        windowMs: '250',
        appliesTo: { match: 'tokenDeltaAbove', addresses: '', mint: WSOL, amount: HALF_WSOL },
      },
      {
        kind: 'allowDeny',
        rules: [
          {
            effect: 'deny',
            match: { match: 'signer', addresses: BUSIEST.join('\n'), mint: '', amount: '' },
          },
        ],
      },
    ],
  }
}
