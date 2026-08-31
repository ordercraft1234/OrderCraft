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
