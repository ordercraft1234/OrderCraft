import {
  type BatchEvent,
  type BatchStatus,
  MAX_BATCH_SLOTS,
  type SlotSummary,
} from '@ordercraft/shared'

/** How far the batch got, as the last `progress` event said. */
export interface Progress {
  doneCount: number
  total: number
}

/**
 * What the screen knows about a running batch, from the progress stream alone.
 *
 * The distinction this type exists for is between `connecting` and the rest. Until the
 * stream has delivered its first event — the server opens every stream with where the
 * batch is now — there is no count to draw, and a bar at 0 / N would read as a batch
 * that started and stalled. On Render one of four measured streams took 6 s to open
 * (SC-005), which is long enough to be mistaken for exactly that.
 *
 * A stream that drops keeps its last count but says the count is old: a number that
 * stopped moving because nobody is telling us is not the same as a batch that stopped.
 */
export type StreamState =
  | { phase: 'connecting' }
  | { phase: 'live'; progress: Progress }
  /** The browser is retrying on its own; `last` is `null` if nothing arrived before the drop. */
  | { phase: 'reconnecting'; last: Progress | null }
  /** The browser gave up, or the stream sent something this build cannot read. */
  | { phase: 'lost'; last: Progress | null }
  | { phase: 'stopped'; status: Exclude<BatchStatus, 'running'>; message: string | null }

/** What an `EventSource` can tell the screen. */
export type StreamSignal =
  | { type: 'event'; event: BatchEvent }
  /** `onerror`. `closed` is `readyState === CLOSED`: the browser will not retry. */
  | { type: 'error'; closed: boolean }
  | { type: 'malformed' }

export const CONNECTING: StreamState = { phase: 'connecting' }

/**
 * The stream's state after one more signal. `stopped` is final: the server closes the
 * stream after its last event, and the browser reports that close as an error it would
 * otherwise retry.
 */
export function nextStreamState(state: StreamState, signal: StreamSignal): StreamState {
  if (state.phase === 'stopped') return state

  if (signal.type === 'event') {
    const { event } = signal
    switch (event.event) {
      case 'progress':
        return { phase: 'live', progress: { doneCount: event.doneCount, total: event.total } }
      case 'done':
      case 'cancelled':
        return { phase: 'stopped', status: event.event, message: null }
      case 'failed':
        return { phase: 'stopped', status: 'failed', message: event.message }
    }
  }

  const last = lastProgress(state)
  if (signal.type === 'malformed' || signal.closed) return { phase: 'lost', last }
  // Retrying before anything arrived is still connecting: there is no count to call old.
  if (state.phase === 'connecting') return state

  return { phase: 'reconnecting', last }
}

export function lastProgress(state: StreamState): Progress | null {
  switch (state.phase) {
    case 'live':
      return state.progress
    case 'reconnecting':
    case 'lost':
      return state.last
    default:
      return null
  }
}

/**
 * The first `count` of the listed slots, ascending — the sample a batch runs on.
 *
 * A prefix rather than a pick: the report then describes "the first N of the curated
 * set", which somebody else can ask for again and get the same blocks.
 */
export function sampleOf(slots: readonly SlotSummary[], count: number): number[] {
  const ascending = slots.map((summary) => summary.slot).sort((a, b) => a - b)
  const size = Math.max(0, Math.min(Math.floor(count), ascending.length, MAX_BATCH_SLOTS))

  return ascending.slice(0, size)
}
