import { z } from 'zod'
import {
  type NormalizedTransaction,
  SLOT_SCHEMA_VERSION,
  type SlotBundle,
  type TokenDelta,
} from './schema.js'

const tokenBalanceSchema = z.object({
  accountIndex: z.number().int().nonnegative(),
  mint: z.string(),
  owner: z.string().optional(),
  uiTokenAmount: z.object({ amount: z.string() }),
})

const rawTransactionSchema = z.object({
  transaction: z.object({
    signatures: z.array(z.string()).min(1),
    message: z.object({
      accountKeys: z.array(z.string()),
      header: z.object({ numRequiredSignatures: z.number().int().nonnegative() }),
      instructions: z.array(z.object({ programIdIndex: z.number().int().nonnegative() })),
    }),
  }),
  meta: z.object({
    err: z.unknown().nullable(),
    fee: z.number().int().nonnegative(),
    preBalances: z.array(z.number().int()),
    postBalances: z.array(z.number().int()),
    preTokenBalances: z.array(tokenBalanceSchema).nullish(),
    postTokenBalances: z.array(tokenBalanceSchema).nullish(),
    computeUnitsConsumed: z.number().int().nonnegative().nullish(),
    loadedAddresses: z
      .object({ writable: z.array(z.string()), readonly: z.array(z.string()) })
      .nullish(),
  }),
})

export const rawBlockSchema = z.object({
  blockTime: z.number().int().nullish(),
  transactions: z.array(rawTransactionSchema),
})

export type RawBlock = z.input<typeof rawBlockSchema>

type RawTransaction = z.infer<typeof rawTransactionSchema>
type RawTokenBalance = z.infer<typeof tokenBalanceSchema>

export function normalizeBlock(slot: number, raw: unknown): SlotBundle {
  const block = rawBlockSchema.parse(raw)

  return {
    schemaVersion: SLOT_SCHEMA_VERSION,
    slot,
    blockTime: block.blockTime ?? null,
    transactions: block.transactions.map(normalizeTransaction),
  }
}

function normalizeTransaction(entry: RawTransaction, index: number): NormalizedTransaction {
  const { message, signatures } = entry.transaction
  const loaded = entry.meta.loadedAddresses
  const accounts = [
    ...message.accountKeys,
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ]

  const accountAt = (position: number): string => {
    const account = accounts[position]
    if (account === undefined) {
      throw new Error(
        `transaction ${index} refers to account index ${position}, but only ${accounts.length} accounts are known — the block was fetched without its address lookup tables`,
      )
    }
    return account
  }

  const programs: string[] = []
  for (const instruction of message.instructions) {
    const program = accountAt(instruction.programIdIndex)
    if (!programs.includes(program)) programs.push(program)
  }

  return {
    index,
    signature: signatures[0] as string,
    signers: message.accountKeys.slice(0, message.header.numRequiredSignatures),
    programs,
    accounts,
    fee: BigInt(entry.meta.fee),
    failed: entry.meta.err !== null && entry.meta.err !== undefined,
    computeUnits:
      entry.meta.computeUnitsConsumed === null || entry.meta.computeUnitsConsumed === undefined
        ? null
        : BigInt(entry.meta.computeUnitsConsumed),
    lamportDelta: netLamports(entry, index, accounts.length, accountAt),
    tokenDelta: netTokenBalances(
      entry.meta.preTokenBalances ?? [],
      entry.meta.postTokenBalances ?? [],
      accountAt,
    ),
  }
}

function netLamports(
  entry: RawTransaction,
  index: number,
  accountCount: number,
  accountAt: (position: number) => string,
): Record<string, bigint> {
  const { preBalances, postBalances } = entry.meta
  if (preBalances.length !== postBalances.length || preBalances.length > accountCount) {
    throw new Error(
      `transaction ${index} has ${preBalances.length} pre and ${postBalances.length} post balances against ${accountCount} accounts`,
    )
  }

  const deltas: Record<string, bigint> = {}
  for (const [position, before] of preBalances.entries()) {
    const after = postBalances[position] as number
    // Lamports arrive as JSON numbers: the RPC already spent whatever precision a
    // u64 above 2^53 would need, so widening here recovers nothing.
    const delta = BigInt(after) - BigInt(before)
    if (delta !== 0n) deltas[accountAt(position)] = delta
  }
  return deltas
}

function netTokenBalances(
  before: RawTokenBalance[],
  after: RawTokenBalance[],
  accountAt: (position: number) => string,
): TokenDelta[] {
  const totals = new Map<string, bigint>()

  const add = (balance: RawTokenBalance, sign: bigint): void => {
    // An owner is absent on balances written before the field existed; the token
    // account itself is then the only identity available, and it is a stable one.
    const owner = balance.owner ?? accountAt(balance.accountIndex)
    const key = `${owner} ${balance.mint}`
    totals.set(key, (totals.get(key) ?? 0n) + sign * BigInt(balance.uiTokenAmount.amount))
  }

  for (const balance of before) add(balance, -1n)
  for (const balance of after) add(balance, 1n)

  return [...totals.entries()]
    .filter(([, amount]) => amount !== 0n)
    .map(([key, amount]) => {
      const [owner, mint] = key.split(' ') as [string, string]
      return { owner, mint, amount }
    })
    .sort(byOwnerThenMint)
}

function byOwnerThenMint(left: TokenDelta, right: TokenDelta): number {
  if (left.owner !== right.owner) return left.owner < right.owner ? -1 : 1
  if (left.mint === right.mint) return 0
  return left.mint < right.mint ? -1 : 1
}
