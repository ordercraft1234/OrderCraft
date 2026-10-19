import { z } from 'zod'
import { base58 } from '../common/scalars.ts'

export const SLOT_SCHEMA_VERSION = 1

const integerString = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)$/, 'expected a decimal integer written as a string')

const amount = integerString.transform((value) => BigInt(value))

const tokenDeltaSchema = z.object({
  owner: base58,
  mint: base58,
  amount,
})

const transactionSchema = z.object({
  index: z.number().int().nonnegative(),
  signature: base58,
  signers: z.array(base58),
  programs: z.array(base58),
  accounts: z.array(base58),
  fee: amount,
  failed: z.boolean(),
  computeUnits: amount.nullable(),
  lamportDelta: z.record(base58, amount),
  tokenDelta: z.array(tokenDeltaSchema),
})

export const slotBundleSchema = z
  .object({
    schemaVersion: z.literal(SLOT_SCHEMA_VERSION),
    slot: z.number().int().nonnegative(),
    blockTime: z.number().int().nullable(),
    transactions: z.array(transactionSchema),
  })
  .superRefine((bundle, ctx) => {
    for (const [position, transaction] of bundle.transactions.entries()) {
      if (transaction.index !== position) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['transactions', position, 'index'],
          message: `transactions must be stored in block order: expected index ${position}`,
        })
      }
    }
  })

export type SlotBundle = z.infer<typeof slotBundleSchema>
export type NormalizedTransaction = SlotBundle['transactions'][number]
export type TokenDelta = NormalizedTransaction['tokenDelta'][number]

export type SerializedSlotBundle = z.input<typeof slotBundleSchema>

export function serializeSlotBundle(bundle: SlotBundle): SerializedSlotBundle {
  return {
    schemaVersion: bundle.schemaVersion,
    slot: bundle.slot,
    blockTime: bundle.blockTime,
    transactions: bundle.transactions.map((transaction) => ({
      index: transaction.index,
      signature: transaction.signature,
      signers: transaction.signers,
      programs: transaction.programs,
      accounts: transaction.accounts,
      fee: transaction.fee.toString(),
      failed: transaction.failed,
      computeUnits: transaction.computeUnits === null ? null : transaction.computeUnits.toString(),
      lamportDelta: Object.fromEntries(
        Object.entries(transaction.lamportDelta).map(([account, delta]) => [
          account,
          delta.toString(),
        ]),
      ),
      tokenDelta: transaction.tokenDelta.map((delta) => ({
        owner: delta.owner,
        mint: delta.mint,
        amount: delta.amount.toString(),
      })),
    })),
  }
}

/**
 * The inverse of `serializeSlotBundle`, and nothing more: strings back to bigints, with
 * no check of any kind. For bundles this repository wrote and the gate has already
 * parsed with `slotBundleSchema` — the curated fixtures, which ship inside the build. On
 * a slow host the schema is most of the cost of reading a block, and checking a file
 * the build already checked buys nothing. Anything from outside — an RPC answer, the
 * live cache — still goes through the schema.
 */
export function hydrateSlotBundle(serialized: SerializedSlotBundle): SlotBundle {
  return {
    schemaVersion: serialized.schemaVersion,
    slot: serialized.slot,
    blockTime: serialized.blockTime,
    transactions: serialized.transactions.map((transaction) => ({
      index: transaction.index,
      signature: transaction.signature,
      signers: transaction.signers,
      programs: transaction.programs,
      accounts: transaction.accounts,
      fee: BigInt(transaction.fee),
      failed: transaction.failed,
      computeUnits: transaction.computeUnits === null ? null : BigInt(transaction.computeUnits),
      lamportDelta: Object.fromEntries(
        Object.entries(transaction.lamportDelta).map(([account, delta]) => [
          account,
          BigInt(delta),
        ]),
      ),
      tokenDelta: transaction.tokenDelta.map((delta) => ({
        owner: delta.owner,
        mint: delta.mint,
        amount: BigInt(delta.amount),
      })),
    })),
  }
}
