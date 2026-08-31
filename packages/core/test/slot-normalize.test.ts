import { describe, expect, it } from 'vitest'
import { normalizeBlock } from '../src/slot/normalize.ts'
import { serializeSlotBundle, slotBundleSchema } from '../src/slot/schema.ts'
import block from './fixtures/block-sample.json' with { type: 'json' }

const SLOT = 441394400

const clone = (source: typeof block): typeof block => JSON.parse(JSON.stringify(source))

describe('normalizeBlock', () => {
  it('keeps block order and carries the slot through', () => {
    const bundle = normalizeBlock(SLOT, block)

    expect(bundle.slot).toBe(SLOT)
    expect(bundle.blockTime).toBe(1787574541)
    expect(bundle.transactions.map((t) => t.index)).toEqual([0, 1, 2])
  })

  it('reads a vote transaction', () => {
    const tx = normalizeBlock(SLOT, block).transactions[0]

    expect(tx?.signature.startsWith('6qrKLGVPGK7L')).toBe(true)
    expect(tx?.signers).toEqual(['9UM8wQ8F5oMiRcP5YdqD6Lr4krpBWCD8LtgQYoisJd9i'])
    expect(tx?.programs).toEqual(['Vote111111111111111111111111111111111111111'])
    expect(tx?.fee).toBe(5000n)
    expect(tx?.computeUnits).toBe(2100n)
    expect(tx?.failed).toBe(false)
    expect(tx?.lamportDelta).toEqual({ '9UM8wQ8F5oMiRcP5YdqD6Lr4krpBWCD8LtgQYoisJd9i': -5000n })
    expect(tx?.tokenDelta).toEqual([])
  })

  it('nets token balances per owner and mint', () => {
    const tx = normalizeBlock(SLOT, block).transactions[1]

    expect(tx?.tokenDelta).toEqual([
      {
        owner: 'DBzeF8yuDs5hGoF4BGfPwi1BQCf74FQ83RGFVWqCkrHC',
        mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        amount: -1000000000n,
      },
      {
        owner: 'DboEaQHQP2paNjfxHqcYQCE4hjtn3xFfMqCPZXwftq8C',
        mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        amount: 1000000000n,
      },
    ])
  })

  it('resolves programs that live in the address lookup table, and marks failure', () => {
    const tx = normalizeBlock(SLOT, block).transactions[2]

    expect(tx?.failed).toBe(true)
    expect(tx?.accounts).toHaveLength(16)
    expect(tx?.programs).toEqual([
      'ComputeBudget111111111111111111111111111111',
      'DRVSpZ2YUYYKgZP8XtLhAGtT1zYSCKzeHfb4DgRnrgqD',
    ])
  })

  it('drops balances that did not change', () => {
    const bundle = normalizeBlock(SLOT, block)

    for (const tx of bundle.transactions) {
      expect(Object.values(tx.lamportDelta).every((delta) => delta !== 0n)).toBe(true)
      expect(tx.tokenDelta.every((delta) => delta.amount !== 0n)).toBe(true)
    }
  })

  it('produces a bundle its own schema accepts', () => {
    const bundle = normalizeBlock(SLOT, block)

    expect(slotBundleSchema.parse(serializeSlotBundle(bundle))).toEqual(bundle)
  })

  it('refuses a program index that no account backs', () => {
    const broken = clone(block)
    const instructions = broken.transactions[0]?.transaction.message.instructions
    if (instructions?.[0]) instructions[0].programIdIndex = 99

    expect(() => normalizeBlock(SLOT, broken)).toThrow(/account index 99/)
  })

  it('refuses a block whose balance arrays disagree with the account list', () => {
    const broken = clone(block)
    broken.transactions[0]?.meta.postBalances.pop()

    expect(() => normalizeBlock(SLOT, broken)).toThrow(/balances/)
  })
})
