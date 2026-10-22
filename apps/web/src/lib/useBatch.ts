import { type BatchView, batchEventSchema } from '@ordercraft/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type ApiClient, ApiFailure } from './api.ts'
import {
  CONNECTING,
  type StreamSignal,
  type StreamState,
  nextStreamState,
} from './batchProgress.ts'

/** The three things a batch screen can be showing. */
export type BatchState =
  | { status: 'running'; stream: StreamState; view: BatchView | null; cancel: CancelState }
  /** Stopped for whatever reason; the view carries the report (FR-016). */
  | { status: 'stopped'; view: BatchView }
  | { status: 'failed'; reason: string }

export type CancelState =
  | { status: 'idle' }
  | { status: 'pending' }
  /** The cancel itself did not go through; the batch is still running. */
  | { status: 'failed'; reason: string }

export interface BatchControl {
  state: BatchState
  /** Stops the batch (FR-017). The slot in flight finishes and is counted. */
  cancel: () => void
  /** Opens the progress stream again after the browser gave up on it. */
  reconnect: () => void
}

/** The tags `GET /batches/:id/events` sets on its messages. */
const EVENT_TAGS = ['progress', 'done', 'cancelled', 'failed'] as const

export type OpenStream = (url: string) => EventSource

const NOT_RECORDED =
  'the batch stopped, but the server has not recorded its report; it recovers it from the stored runs when it next starts'

/** How often the view is read while the stream delivers nothing. */
const FALLBACK_READ_MS = 5_000

const openEventSource: OpenStream = (url) => new EventSource(url)

/**
 * One batch, by id: its progress while it runs and its report once it stops.
 *
 * The stream is opened at once, alongside the read of the batch, rather than after it.
 * The first event a stream sends is the batch's position, so the read is not needed
 * for the count — only for the header, and to find out that a batch reached by a link
 * stopped long ago, in which case the stream is closed unused.
 *
 * Whatever ends the run — the stream's last event, a cancel coming back, or a stream
 * that is lost — the report is read with `GET /batches/:id` and never assembled here:
 * the server's view is the one that has been checked against its own sums.
 */
export function useBatch(
  client: ApiClient,
  batchId: string,
  openStream: OpenStream = openEventSource,
): BatchControl {
  const [state, setState] = useState<BatchState>(running(CONNECTING, null))
  const [attempt, setAttempt] = useState(0)
  const live = useRef(true)

  // Reads the view and, if it has stopped, shows its report. A running view only
  // fills in the header: the count on screen is the stream's, never the read's.
  //
  // `stopped` is the stream's word that the batch ended. The server writes the report
  // before it says so, and the one way the row can still read `running` afterwards is
  // that the write failed — the next boot recovers it — so that is a failure to show
  // in the server's words, not a batch to keep waiting on.
  const settle = useCallback(
    async (stopped: string | null) => {
      try {
        const view = await client.readBatch(batchId)
        if (!live.current) return
        if (view.status !== 'running') {
          setState({ status: 'stopped', view })
        } else if (stopped !== null) {
          setState({ status: 'failed', reason: stopped })
        } else {
          setState((current) => (current.status === 'running' ? { ...current, view } : current))
        }
      } catch (error) {
        if (live.current) setState({ status: 'failed', reason: messageOf(error) })
      }
    },
    [client, batchId],
  )

  // `attempt` is read by nobody inside: bumping it is what `reconnect` does, and the
  // effect running again is the reconnection.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-opens the stream
  useEffect(() => {
    live.current = true
    setState((current) =>
      current.status === 'running' ? { ...current, stream: CONNECTING } : running(CONNECTING, null),
    )

    const source = openStream(client.batchEventsUrl(batchId))
    let stream: StreamState = CONNECTING

    const apply = (signal: StreamSignal) => {
      const next = nextStreamState(stream, signal)
      if (next === stream) return
      stream = next
      if (next.phase === 'stopped' || next.phase === 'lost') source.close()

      setState((current) => (current.status === 'running' ? { ...current, stream: next } : current))
      if (next.phase === 'stopped') void settle(next.message ?? NOT_RECORDED)
      // A lost stream may simply be one that outlived its batch.
      if (next.phase === 'lost') void settle(null)
    }

    for (const tag of EVENT_TAGS) {
      source.addEventListener(tag, (message) => {
        const parsed = batchEventSchema.safeParse(dataOf(message))
        apply(parsed.success ? { type: 'event', event: parsed.data } : { type: 'malformed' })
      })
    }
    source.onerror = () => apply({ type: 'error', closed: source.readyState === source.CLOSED })

    void settle(null)

    // A stream that never opens — a proxy that buffers it, a network that refuses it —
    // would leave the screen connecting after the batch ended. While no count is
    // arriving, the view is read now and then, so the report still turns up; the count
    // itself stays the stream's, and a read never draws a bar.
    const fallback = setInterval(() => {
      if (stream.phase !== 'live' && stream.phase !== 'stopped') void settle(null)
    }, FALLBACK_READ_MS)

    return () => {
      live.current = false
      clearInterval(fallback)
      source.close()
    }
  }, [client, batchId, openStream, settle, attempt])

  const cancel = useCallback(() => {
    setState((current) =>
      current.status === 'running' ? { ...current, cancel: { status: 'pending' } } : current,
    )

    client.cancelBatch(batchId).then(
      () => settle(null),
      (error: unknown) => {
        // The batch finished before the cancel reached it: its report is the whole
        // one, which the stream's `done` brings in. Nothing failed.
        if (error instanceof ApiFailure && error.code === 'CONFLICT') return settle(null)
        if (!live.current) return
        setState((current) =>
          current.status === 'running'
            ? { ...current, cancel: { status: 'failed', reason: messageOf(error) } }
            : current,
        )
      },
    )
  }, [client, batchId, settle])

  const reconnect = useCallback(() => setAttempt((value) => value + 1), [])

  return { state, cancel, reconnect }
}

function running(stream: StreamState, view: BatchView | null): BatchState {
  return { status: 'running', stream, view, cancel: { status: 'idle' } }
}

function dataOf(message: Event): unknown {
  if (!(message instanceof MessageEvent) || typeof message.data !== 'string') return undefined
  try {
    return JSON.parse(message.data)
  } catch {
    return undefined
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
