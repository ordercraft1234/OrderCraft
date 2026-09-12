import type { Ordering, Placement, Sandwich } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { WINDOW, attackWindow } from '../src/lib/attackWindow.ts'

const sandwich: Sandwich = {
  front: 20,
  victims: [21],
  back: 22,
  signer: 'attacker',
  mint: 'mint',
  pool: 'pool',
}

function placed(index: number, overrides: Partial<Placement> = {}): Placement {
  return {
    index,
    signature: `sig${index}`,
    status: 'kept',
    timeMs: index,
    changedBy: null,
    batch: null,
    prioritised: false,
    ...overrides,
  }
}

function orderingOf(indices: number[], excluded: Placement[] = []): Ordering {
  return { slot: 1, policyHash: 'hash', included: indices.map((index) => placed(index)), excluded }
}

const all = Array.from({ length: 60 }, (_, index) => index)

describe('attackWindow', () => {
  it('reaches twelve either side of the triple', () => {
    const rows = attackWindow(sandwich, orderingOf(all), 60)

    expect(rows[0]?.index).toBe(sandwich.front - WINDOW)
    expect(rows.at(-1)?.index).toBe(sandwich.back + WINDOW)
  })

  it('stops at the edges of the block', () => {
    const early: Sandwich = { ...sandwich, front: 1, victims: [2], back: 3 }
    const rows = attackWindow(early, orderingOf(all.slice(0, 10)), 10)

    expect(rows[0]?.index).toBe(0)
    expect(rows.at(-1)?.index).toBe(9)
  })

  it('names each of the three and leaves the rest alone', () => {
    const rows = attackWindow(sandwich, orderingOf(all), 60)
    const named = rows.filter((row) => row.role !== 'bystander')

    expect(named.map((row) => [row.index, row.role])).toStrictEqual([
      [20, 'front'],
      [21, 'victim'],
      [22, 'back'],
    ])
  })

  it('has no right-hand row for a transaction the policy took out', () => {
    const dropped = placed(21, { status: 'dropped', changedBy: 'allowDeny' })
    const rows = attackWindow(
      sandwich,
      orderingOf(
        all.filter((index) => index !== 21),
        [dropped],
      ),
      60,
    )
    const victim = rows.find((row) => row.index === 21)

    expect(victim?.to).toBeNull()
    expect(victim?.left).toBe('dropped')
  })

  it('numbers the right-hand rows in the order the policy put them', () => {
    const reversed = orderingOf([...all.slice(0, 20), 22, 21, 20, ...all.slice(23)])
    const rows = attackWindow(sandwich, reversed, 60)

    expect(rows.find((row) => row.index === 22)?.to).toBe(12)
    expect(rows.find((row) => row.index === 20)?.to).toBe(14)
  })
})
