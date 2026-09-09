import type { PolicyDraft } from './policyDraft.ts'

/**
 * The policy the app opens on, and the only place in the interface holding addresses
 * nobody typed.
 *
 * Every constant here was **measured on the slot the repository ships**
 * (`packages/fixtures`, 445608326), not chosen for looks: the threshold picks out 57
 * transactions of 759, and the three signers are the three busiest in that block. A
 * demo that needs the visitor to invent a policy before anything appears fails SC-009,
 * and one built on invented numbers would be the one thing this product may not do.
 *
 * Replacing the fixture invalidates these numbers. `demoPolicy.test.ts` runs the
 * policy against the shipped slot and fails when the class stops selecting anything.
 */

/** Six decimals, so 100 USDC is 100,000,000 base units. The slot carries no decimals. */
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const HUNDRED_USDC = '100000000'

/** The three busiest signers in slot 445608326: 36, 34 and 33 transactions. */
const BUSIEST = [
  'shakRDxyKwaBbduqZTZt8Q4etTALbDLnAANStv9TLH3',
  'capsFrvPsaCQ6y7RUk3TYkB5D1oNCNjRb4uYuB5UCsZ',
  '77777nPhGvFUVAj6uq8MGyLneBt4SMwCScYZDzzztdsa',
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
        appliesTo: { match: 'tokenDeltaAbove', addresses: '', mint: USDC, amount: HUNDRED_USDC },
      },
      {
        kind: 'batchAuction',
        windowMs: '250',
        appliesTo: { match: 'tokenDeltaAbove', addresses: '', mint: USDC, amount: HUNDRED_USDC },
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
