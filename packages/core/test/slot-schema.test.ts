import { describe, expect, it } from 'vitest'
import {
  SLOT_SCHEMA_VERSION,
  type SlotBundle,
  serializeSlotBundle,
  slotBundleSchema,
} from '../src/slot/schema.js'

const wire = {
  schemaVersion: SLOT_SCHEMA_VERSION,
  slot: 441394400,
  blockTime: 1787574541,
  transactions: [
    {
      index: 0,
      signature: '5fS8qM1kZ1nVxCq7bNRr2hVUxLmT9wKcPq3sJdEaYnWv',
      signers: ['9wTbXo4RxHqLmYtV2pNz8CkDdFgUj1sAeQ7vMhKcRnBu'],
      programs: ['ComputeBudget111111111111111111111111111111'],
      accounts: [
        '9wTbXo4RxHqLmYtV2pNz8CkDdFgUj1sAeQ7vMhKcRnBu',
        'ComputeBudget111111111111111111111111111111',
      ],
      fee: '5000',
      failed: false,
      computeUnits: '150000',
      lamportDelta: { '9wTbXo4RxHqLmYtV2pNz8CkDdFgUj1sAeQ7vMhKcRnBu': '-5000' },
      tokenDelta: [
        {
          owner: '9wTbXo4RxHqLmYtV2pNz8CkDdFgUj1sAeQ7vMhKcRnBu',
          mint: '4QXnu6ycbvJRQ1eyhF2egtwURhChYHQGpjr5P9fgpump',
          amount: '-1250000',
        },
      ],
    },
    {
      index: 1,
      signature: '2xKpR7vAe1QmZnT4bUdWs9YhLcFj6NgVo3PtXrMkDwSq',
      signers: ['3JkPqWm8ZnVuRt2cYbXsAd7LgFhQe1NoMpKvTrUiSyBz'],
      programs: [],
      accounts: ['3JkPqWm8ZnVuRt2cYbXsAd7LgFhQe1NoMpKvTrUiSyBz'],
      fee: '5000',
      failed: true,
      computeUnits: null,
      lamportDelta: {},
      tokenDelta: [],
    },
  ],
}

describe('slotBundleSchema', () => {
  it('parses amounts into bigint and keeps block order', () => {
    const bundle = slotBundleSchema.parse(wire)

    expect(bundle.slot).toBe(441394400)
    expect(bundle.transactions[0]?.fee).toBe(5000n)
    expect(bundle.transactions[0]?.computeUnits).toBe(150000n)
    expect(bundle.transactions[0]?.lamportDelta['9wTbXo4RxHqLmYtV2pNz8CkDdFgUj1sAeQ7vMhKcRnBu']).toBe(
      -5000n,
    )
    expect(bundle.transactions[0]?.tokenDelta[0]?.amount).toBe(-1250000n)
    expect(bundle.transactions[1]?.computeUnits).toBeNull()
    expect(bundle.transactions.map((t) => t.index)).toEqual([0, 1])
  })

  it('round-trips through serialization without losing a digit', () => {
    const bundle = slotBundleSchema.parse(wire)
    const back = serializeSlotBundle(bundle)

    expect(back).toEqual(wire)
    expect(slotBundleSchema.parse(back)).toEqual(bundle)
  })

  it('keeps amounts that exceed Number.MAX_SAFE_INTEGER exact', () => {
    const huge = '18446744073709551615'
    const bundle = slotBundleSchema.parse({
      ...wire,
      transactions: [
        {
          ...wire.transactions[0],
          tokenDelta: [{ ...wire.transactions[0]?.tokenDelta[0], amount: huge }],
        },
      ],
    })

    expect(bundle.transactions[0]?.tokenDelta[0]?.amount).toBe(18446744073709551615n)
    expect(serializeSlotBundle(bundle).transactions[0]?.tokenDelta[0]?.amount).toBe(huge)
  })

  it('rejects a bundle whose indexes are not the block order', () => {
    const shuffled = {
      ...wire,
      transactions: [{ ...wire.transactions[1], index: 1 }, { ...wire.transactions[0], index: 0 }],
    }

    expect(() => slotBundleSchema.parse(shuffled)).toThrow(/block order/)
  })

  it('rejects an amount that is not an integer string', () => {
    const broken = {
      ...wire,
      transactions: [{ ...wire.transactions[0], fee: '5000.5' }],
    }

    expect(() => slotBundleSchema.parse(broken)).toThrow()
  })

  it('rejects a schema version it was not written for', () => {
    expect(() => slotBundleSchema.parse({ ...wire, schemaVersion: SLOT_SCHEMA_VERSION + 1 })).toThrow()
  })

  it('accepts an empty block', () => {
    const empty: SlotBundle = slotBundleSchema.parse({ ...wire, transactions: [] })

    expect(empty.transactions).toEqual([])
  })
})
