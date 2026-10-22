import { MAX_BATCH_SLOTS, type SlotSummary } from '@ordercraft/shared'
import { describe, expect, it } from 'vitest'
import {
  CONNECTING,
  type StreamSignal,
  type StreamState,
  lastProgress,
  nextStreamState,
  sampleOf,
} from '../src/lib/batchProgress.ts'

const progress = (doneCount: number, total = 53): StreamSignal => ({
  type: 'event',
  event: { event: 'progress', doneCount, total },
})
const retrying: StreamSignal = { type: 'error', closed: false }
const closed: StreamSignal = { type: 'error', closed: true }

function run(...signals: StreamSignal[]): StreamState {
  return signals.reduce(nextStreamState, CONNECTING)
}

describe('nextStreamState', () => {
  /**
   * SC-005 on Render: one stream in four took 6 s to open. Until the first event the
   * screen must say it is connecting — a bar at 0 / 53 would be a batch that stalled.
   */
  it('stays connecting until the first event, however often the browser retries', () => {
    expect(run()).toEqual({ phase: 'connecting' })
    expect(run(retrying, retrying)).toEqual({ phase: 'connecting' })
    expect(lastProgress(run(retrying))).toBeNull()
  })

  it('goes live on the snapshot the server opens every stream with', () => {
    expect(run(progress(0))).toEqual({ phase: 'live', progress: { doneCount: 0, total: 53 } })
    expect(run(progress(0), progress(1), progress(2))).toEqual({
      phase: 'live',
      progress: { doneCount: 2, total: 53 },
    })
  })

  /** A count nobody is updating is shown as old, not as the batch standing still. */
  it('keeps the last count through a drop and says it is old', () => {
    expect(run(progress(7), retrying)).toEqual({
      phase: 'reconnecting',
      last: { doneCount: 7, total: 53 },
    })
    expect(run(progress(7), retrying, progress(9))).toEqual({
      phase: 'live',
      progress: { doneCount: 9, total: 53 },
    })
  })

  it('is lost when the browser stops retrying or the stream is unreadable', () => {
    expect(run(progress(7), closed)).toEqual({ phase: 'lost', last: { doneCount: 7, total: 53 } })
    expect(run(closed)).toEqual({ phase: 'lost', last: null })
    expect(run(progress(3), { type: 'malformed' })).toEqual({
      phase: 'lost',
      last: { doneCount: 3, total: 53 },
    })
  })

  it('stops on each of the three last events, with the server’s reason for a failure', () => {
    expect(run(progress(53), { type: 'event', event: { event: 'done' } })).toEqual({
      phase: 'stopped',
      status: 'done',
      message: null,
    })
    expect(run(progress(4), { type: 'event', event: { event: 'cancelled' } })).toMatchObject({
      status: 'cancelled',
    })
    expect(
      run(progress(4), { type: 'event', event: { event: 'failed', message: 'restarted' } }),
    ).toEqual({ phase: 'stopped', status: 'failed', message: 'restarted' })
  })

  /** The server closes the stream after its last event; the browser calls that an error. */
  it('stays stopped through the close that follows the last event', () => {
    const stopped = run(progress(53), { type: 'event', event: { event: 'done' } })

    expect(nextStreamState(stopped, retrying)).toBe(stopped)
    expect(nextStreamState(stopped, closed)).toBe(stopped)
    expect(nextStreamState(stopped, progress(1))).toBe(stopped)
  })
})

describe('sampleOf', () => {
  const summary = (slot: number): SlotSummary => ({
    slot,
    source: 'fixture',
    txCount: 1000,
    hasLabels: true,
  })

  it('takes the first slots in ascending order, whatever order they were listed in', () => {
    expect(sampleOf([summary(30), summary(10), summary(20)], 2)).toEqual([10, 20])
  })

  it('clamps the count to what is listed, to zero, and to whole slots', () => {
    const slots = [summary(1), summary(2), summary(3)]

    expect(sampleOf(slots, 10)).toEqual([1, 2, 3])
    expect(sampleOf(slots, -1)).toEqual([])
    expect(sampleOf(slots, 2.7)).toEqual([1, 2])
  })

  it('never names more slots than one batch may', () => {
    const many = Array.from({ length: MAX_BATCH_SLOTS + 5 }, (_, index) => summary(index + 1))

    expect(sampleOf(many, MAX_BATCH_SLOTS + 5)).toHaveLength(MAX_BATCH_SLOTS)
  })
})
