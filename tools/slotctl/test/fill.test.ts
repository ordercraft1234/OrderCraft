import { describe, expect, it } from 'vitest'
import { type FillPorts, fill } from '../src/fill.ts'

/** Codes a node answers with when the slot simply holds no block. */
const MISSING_CODES = [-32007, -32009]

function ports(overrides: Partial<FillPorts> = {}) {
  const stored: number[] = []
  const waits: number[] = []
  const notes: string[] = []

  const base: FillPorts = {
    has: () => false,
    fetch: (slot) => Promise.resolve({ slot }),
    store: (slot) => {
      stored.push(slot)
    },
    wait: (ms) => {
      waits.push(ms)
      return Promise.resolve()
    },
    note: (line) => {
      notes.push(line)
    },
  }

  return { ports: { ...base, ...overrides }, stored, waits, notes }
}

function refusal(code: number) {
  return new Error(`getBlock 1 refused: no block (code ${code})`)
}

describe('fill', () => {
  it('walks the stretch it was given', async () => {
    const { ports: port, stored } = ports()
    const report = await fill(port, { from: 100, count: 3 })

    expect(stored).toStrictEqual([100, 101, 102])
    expect(report.fetched).toStrictEqual([100, 101, 102])
  })

  it('steps by --every so a sample can span a wider stretch', async () => {
    const { ports: port, stored } = ports()
    await fill(port, { from: 100, count: 3, every: 50 })

    expect(stored).toStrictEqual([100, 150, 200])
  })

  /** A run interrupted halfway must not pay for the first half twice. */
  it('does not ask for a slot already on disk', async () => {
    const { ports: port, stored } = ports({ has: (slot) => slot === 101 })
    const report = await fill(port, { from: 100, count: 3 })

    expect(stored).toStrictEqual([100, 102])
    expect(report.held).toStrictEqual([101])
  })

  /** Leaders miss their turn. A few percent of any stretch holds nothing. */
  it.each(MISSING_CODES)(
    'counts a slot with no block as missing, not failed (%i)',
    async (code) => {
      const { ports: port } = ports({
        fetch: (slot) => (slot === 101 ? Promise.reject(refusal(code)) : Promise.resolve({ slot })),
      })
      const report = await fill(port, { from: 100, count: 3 })

      expect(report.missing).toStrictEqual([101])
      expect(report.failed).toStrictEqual([])
      expect(report.fetched).toStrictEqual([100, 102])
    },
  )

  it('does not retry a slot that holds no block', async () => {
    let calls = 0
    const { ports: port } = ports({
      fetch: () => {
        calls++
        return Promise.reject(refusal(-32009))
      },
    })
    await fill(port, { from: 100, count: 1 })

    expect(calls).toBe(1)
  })

  it('retries a node that would not answer, waiting longer each time', async () => {
    let calls = 0
    const { ports: port, waits } = ports({
      fetch: (slot) => {
        calls++
        return calls < 3 ? Promise.reject(new Error('HTTP 429')) : Promise.resolve({ slot })
      },
    })
    const report = await fill(port, { from: 100, count: 1, pauseMs: 10 })

    expect(report.fetched).toStrictEqual([100])
    // Two failed tries wait 20 and 40; the last wait is the pause between slots.
    expect(waits).toStrictEqual([20, 40, 10])
  })

  it('records a slot it could not get and carries on', async () => {
    const { ports: port } = ports({
      fetch: (slot) =>
        slot === 101 ? Promise.reject(new Error('HTTP 500')) : Promise.resolve({ slot }),
    })
    const report = await fill(port, { from: 100, count: 3, attempts: 2, pauseMs: 0 })

    expect(report.failed).toStrictEqual([{ slot: 101, reason: 'HTTP 500' }])
    expect(report.fetched).toStrictEqual([100, 102])
  })

  it('reports progress while it runs, not only at the end', async () => {
    const { ports: port, notes } = ports()
    await fill(port, { from: 100, count: 30 })

    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('25 fetched')
  })
})
