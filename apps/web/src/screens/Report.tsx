import { type BatchReport, PRIMITIVES, SLOT_DURATION_MS, validatePolicy } from '@ordercraft/core'
import type { BatchView, SlotSummary } from '@ordercraft/shared'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { DistributionStrip } from '../components/DistributionStrip.tsx'
import { Screen } from '../components/Screen.tsx'
import { type ApiClient, ApiFailure, api } from '../lib/api.ts'
import { type Progress, type StreamState, lastProgress, sampleOf } from '../lib/batchProgress.ts'
import { recordable } from '../lib/presetChoice.ts'
import { type Strip, formatValue, isFlat, percent, stripsOf } from '../lib/reportStrips.ts'
import { toHash } from '../lib/router.ts'
import { type CancelState, useBatch } from '../lib/useBatch.ts'
import { navigate } from '../lib/useLocation.ts'
import type { PolicySession } from '../lib/usePolicySession.ts'

const number = new Intl.NumberFormat('en-US')

const TITLE = 'Across many blocks'

interface ReportProps {
  /** `null` on the screen that starts a batch; the batch on screen otherwise. */
  batchId: string | null
  session: PolicySession
}

/**
 * Artboard 4: one policy across many recorded blocks (US4).
 *
 * Two screens under one route. Without a batch id it picks the sample and starts the
 * batch; with one it follows that batch's progress and then draws its report. Starting
 * moves the address to the batch, so a reload during the run comes back to the run and
 * a finished report is a link that can be sent.
 *
 * A batch needs the server — the blocks, the runs and the worker are all there — so a
 * build without an API says so instead of falling back to the one slot it ships: one
 * block is the anecdote this screen exists to get past.
 */
export function Report({ batchId, session }: ReportProps) {
  if (api === null) {
    return (
      <Screen title={TITLE}>
        <Note>
          A batch runs on the server: the recorded blocks, the stored runs and the worker that goes
          through them are all there. This build has no API address, so it can replay only the one
          block it ships — and one block is an anecdote, not a sample.
        </Note>
      </Screen>
    )
  }

  if (batchId === null) return <Launch client={api} session={session} />

  return <Batch key={batchId} client={api} batchId={batchId} session={session} />
}

type SlotList =
  | { status: 'loading' }
  | { status: 'failed'; reason: string }
  | { status: 'ready'; slots: SlotSummary[] }

type Start =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'starting' }
  | { status: 'failed'; reason: string }

/**
 * The sample is the first N of the curated fixtures, ascending. Fixtures and not the
 * whole cache: they are the blocks every deployment has the files for, so a batch
 * started here cannot be refused for a block that is listed but not loaded.
 */
function Launch({ client, session }: { client: ApiClient; session: PolicySession }) {
  const [list, setList] = useState<SlotList>({ status: 'loading' })
  const [count, setCount] = useState<number | null>(null)
  const [start, setStart] = useState<Start>({ status: 'idle' })

  const policy = session.parsed.ok ? session.parsed.policy : null
  const runnable = useMemo(() => policy !== null && validatePolicy(policy).runnable, [policy])

  useEffect(() => {
    let live = true
    client.listSlots('fixture').then(
      (slots) => {
        if (live) setList({ status: 'ready', slots })
      },
      (error: unknown) => {
        if (live) setList({ status: 'failed', reason: messageOf(error) })
      },
    )

    return () => {
      live = false
    }
  }, [client])

  if (policy === null || session.draftHash === null || !runnable) {
    return (
      <Screen title={TITLE}>
        <Note>
          Nothing to run yet: the policy on the Policy screen{' '}
          {policy === null ? 'is not valid' : 'would not order anything'}. A batch runs whatever
          that screen holds, and never a policy of its own.
        </Note>
      </Screen>
    )
  }

  if (list.status === 'loading') {
    return (
      <Screen title={TITLE} subtitle="Listing the recorded blocks">
        <Note>
          Asking the server which blocks it holds. On a free-plan API the first request after a
          quiet spell also has to wake the server.
        </Note>
      </Screen>
    )
  }

  if (list.status === 'failed') {
    return (
      <Screen title={TITLE} subtitle="The list of blocks did not come back">
        <Note>{list.reason}</Note>
      </Screen>
    )
  }

  const available = list.slots.length
  const size = Math.min(count ?? available, available)
  const sample = sampleOf(list.slots, size)
  const hash = session.draftHash
  const busy = start.status === 'saving' || start.status === 'starting'

  const run = async () => {
    setStart({ status: 'saving' })
    try {
      // Saving is part of starting: a batch is addressed by a stored policy. Both calls
      // are idempotent on content, as they are for a single run.
      const saved = await client.savePolicy(policy, recordable(session.origin))
      if (saved.hash !== hash) {
        throw new ApiFailure(
          'MALFORMED',
          `the API addressed this policy as ${saved.hash.slice(0, 12)} and this build as ${hash.slice(0, 12)}`,
        )
      }
      session.markStored(saved.hash)

      setStart({ status: 'starting' })
      const { batchId } = await client.startBatch(saved.hash, sample)
      navigate(toHash({ name: 'report', batchId }, saved.hash))
    } catch (error) {
      setStart({ status: 'failed', reason: messageOf(error) })
    }
  }

  return (
    <Screen title={TITLE} subtitle={`${available} recorded blocks on the server`}>
      <div className="flex flex-col gap-6">
        <Headline left={`${policy.name} · ${number.format(size)} blocks`} right={shortHash(hash)} />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-hairline pt-4 text-[12px]">
          <label className="flex items-center gap-2">
            <span className="text-muted">Run on the first</span>
            <input
              type="number"
              min={1}
              max={available}
              value={size}
              disabled={busy}
              onChange={(event) => setCount(clampCount(event.target.valueAsNumber, available))}
              className="w-16 border border-hairline bg-panel px-2 py-1 text-ink"
            />
            <span className="text-muted">of {available} recorded blocks, ascending by slot</span>
          </label>
          <button
            type="button"
            disabled={busy || sample.length === 0}
            onClick={() => void run()}
            className="border border-ink px-4 py-1 text-ink hover:bg-ink hover:text-ground disabled:border-hairline disabled:text-muted disabled:hover:bg-transparent"
          >
            {start.status === 'saving'
              ? 'Saving the policy…'
              : start.status === 'starting'
                ? 'Starting…'
                : `Run on ${number.format(sample.length)} blocks`}
          </button>
        </div>

        {start.status === 'failed' ? <Note>{start.reason}</Note> : null}

        <Note>
          Each block is replayed once under this policy; a block it was already run on is read back
          rather than run again. Progress arrives as each block finishes, and stopping keeps every
          block finished so far.
        </Note>
      </div>
    </Screen>
  )
}

interface BatchProps {
  client: ApiClient
  batchId: string
  session: PolicySession
}

function Batch({ client, batchId, session }: BatchProps) {
  const { state, cancel, reconnect } = useBatch(client, batchId)

  if (state.status === 'failed') {
    return (
      <Screen title={TITLE} subtitle="The batch could not be read">
        <Note>{state.reason}</Note>
      </Screen>
    )
  }

  const view = state.view
  const name = view === null ? null : policyName(session, view.policyHash)

  if (state.status === 'running') {
    return (
      <Screen
        title={TITLE}
        subtitle={view === null ? `batch ${batchId.slice(0, 8)}` : subtitleOf(view)}
      >
        <div className="flex flex-col gap-6">
          {view === null ? null : (
            <Headline
              left={`${name ?? 'Saved policy'} · ${number.format(view.slots.length)} blocks`}
              right={shortHash(view.policyHash)}
            />
          )}
          <ProgressPanel
            stream={state.stream}
            cancelState={state.cancel}
            onCancel={cancel}
            onReconnect={reconnect}
          />
        </div>
      </Screen>
    )
  }

  return (
    <Screen title={TITLE} subtitle={subtitleOf(state.view)}>
      {state.view.report === null ? null : (
        <ReportView view={state.view} report={state.view.report} name={name} />
      )}
    </Screen>
  )
}

interface ProgressPanelProps {
  stream: StreamState
  cancelState: CancelState
  onCancel: () => void
  onReconnect: () => void
}

/**
 * The count, the bar and the stop button. Until the stream's first event there is no
 * count and no bar — only a sentence saying the screen is connecting (SC-005).
 */
function ProgressPanel({ stream, cancelState, onCancel, onReconnect }: ProgressPanelProps) {
  const progress = lastProgress(stream)
  const current = stream.phase === 'live'
  const stopping = cancelState.status === 'pending'

  return (
    <div className="flex flex-col gap-3 border-t border-hairline pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="text-[12px]" aria-live="polite">
          {statusLine(stream, progress)}
        </div>
        {stream.phase === 'stopped' ? null : (
          <button
            type="button"
            disabled={stopping}
            onClick={onCancel}
            className="border border-hairline px-4 py-1 text-[12px] hover:border-ink disabled:text-muted disabled:hover:border-hairline"
          >
            {stopping ? 'Stopping — the block in flight finishes first' : 'Stop'}
          </button>
        )}
      </div>

      {progress === null ? null : <Bar progress={progress} current={current} />}

      {stream.phase === 'connecting' ? (
        <Note>
          The count appears with the first message from the server. On a free-plan API the first
          request after a quiet spell also has to wake it.
        </Note>
      ) : null}

      {stream.phase === 'lost' ? (
        <div className="flex flex-wrap items-baseline gap-3">
          <Note>
            The batch carries on on the server whether or not this page is listening; its report is
            there when it ends.
          </Note>
          <button
            type="button"
            onClick={onReconnect}
            className="border border-hairline px-4 py-1 text-[12px] hover:border-ink"
          >
            Reconnect
          </button>
        </div>
      ) : null}

      {cancelState.status === 'failed' ? (
        <Note>The stop did not go through: {cancelState.reason}</Note>
      ) : null}
    </div>
  )
}

function statusLine(stream: StreamState, progress: Progress | null): string {
  const count =
    progress === null
      ? null
      : `${number.format(progress.doneCount)} / ${number.format(progress.total)} blocks`

  switch (stream.phase) {
    case 'connecting':
      return 'Connecting to the progress stream…'
    case 'live':
      return count ?? ''
    case 'reconnecting':
      return count === null
        ? 'The progress stream dropped; reconnecting…'
        : `${count} when the stream dropped · reconnecting, this count is not current`
    case 'lost':
      return count === null
        ? 'The progress stream is gone'
        : `${count} when the stream was lost · this count is not current`
    case 'stopped':
      return 'Stopped · reading the report'
  }
}

/** A hairline that fills in ink while the count is current and in muted ink when it is old. */
function Bar({ progress, current }: { progress: Progress; current: boolean }) {
  const share = progress.total === 0 ? 0 : progress.doneCount / progress.total

  return (
    // The count beside it is the readable form, announced as it changes; the line is
    // the same number drawn, and says nothing a screen reader has not already heard.
    <div className="relative h-px bg-hairline" aria-hidden="true">
      <div
        className={`absolute left-0 top-0 h-px ${current ? 'bg-ink' : 'bg-muted'}`}
        style={{ width: `${share * 100}%` }}
      />
    </div>
  )
}

interface ReportViewProps {
  view: BatchView
  report: BatchReport
  name: string | null
}

function ReportView({ view, report, name }: ReportViewProps) {
  const strips = stripsOf(report)
  const { triples, transactions } = report

  return (
    <div className="flex flex-col gap-8">
      <Headline
        left={`${name ?? 'Saved policy'} · ${number.format(report.blocks)} blocks · ${number.format(triples.found)} triples found`}
        right={shortHash(view.policyHash)}
      />

      {view.status === 'done' ? null : <StoppedNote view={view} report={report} />}

      {report.blocks === 0 ? (
        <Note>No block finished before the batch stopped, so there is nothing to report.</Note>
      ) : (
        <>
          <div className="flex flex-col">
            <Key />
            <div className="flex flex-col border-t border-hairline">
              {strips.map((strip) => (
                <StripRow key={strip.key} strip={strip} />
              ))}
            </div>
          </div>

          <Triples report={report} />

          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-hairline pt-3 text-[12px]">
            <Count label="recorded" value={number.format(transactions.recorded)} />
            <Count label="moved" value={number.format(transactions.moved)} />
            <Count label="delayed" value={number.format(transactions.delayed)} />
            <Count label="deferred" value={number.format(transactions.deferred)} />
            <Count label="dropped" value={number.format(transactions.dropped)} />
          </div>

          <PercentileTable strips={strips} />

          <Note>
            A wider sample of the same model, not a measurement of it. Arrival time inside a block
            is modelled as{' '}
            <span className="text-ink">arrival(i) = floor(i × {SLOT_DURATION_MS} / N)</span>; every
            delay above inherits that assumption. The {SLOT_DURATION_MS} ms is the protocol’s
            nominal slot, not these blocks’ measured length — the blocks sampled for this project
            ran nearer 317 ms.
          </Note>
          <Note>
            Delays are pooled over transactions, shares are one value per block. Percentiles are
            nearest-rank over the {number.format(report.blocks)} blocks counted, with no
            interpolation. Each block’s run is stored and opens on its own by policy and slot.
          </Note>
        </>
      )}

      <a
        href={toHash({ name: 'report', batchId: null }, view.policyHash)}
        className="text-[12px] text-muted hover:text-ink"
      >
        Run another batch
      </a>
    </div>
  )
}

function StoppedNote({ view, report }: { view: BatchView; report: BatchReport }) {
  const finished = `${number.format(report.blocks)} of ${number.format(view.slots.length)}`

  return (
    <Note>
      {view.status === 'cancelled'
        ? `Stopped on request after ${finished} blocks.`
        : `The server stopped the batch after ${finished} blocks — a restart, or a block it could not read.`}{' '}
      Everything below is about the blocks it finished; their runs are kept.
    </Note>
  )
}

/** How to read a strip, drawn with the same marks the strips use. */
function Key() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pb-2 text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-[2px] w-5 bg-ink" />
        p10 to p90
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-1.5 bg-ink" />
        p50
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-px bg-moved" />
        p95
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 border-l border-dashed border-muted" />
        max
      </span>
    </div>
  )
}

/** One measure: its name, its distribution, and the two figures the eye reads first. */
function StripRow({ strip }: { strip: Strip }) {
  const { values } = strip

  return (
    <div className="grid grid-cols-1 items-center gap-3 border-b border-hairline py-6 sm:grid-cols-[200px_minmax(0,1fr)_150px] sm:gap-8">
      <div className="flex flex-col gap-1">
        <div>{strip.name}</div>
        <div className="text-[11px] text-muted">{strip.note}</div>
      </div>

      {values === null ? (
        <div className="text-[12px] text-muted">Nothing to measure in this sample.</div>
      ) : isFlat(values) ? (
        <div className="text-[12px] text-muted">
          {strip.unit === 'ms' ? '0 ms for every one of them.' : '0 in every block.'}
        </div>
      ) : (
        <DistributionStrip strip={strip} values={values} />
      )}

      <div className="flex gap-4 text-[12px] sm:flex-col sm:gap-0.5 sm:text-right">
        {values === null ? (
          <div className="text-muted">—</div>
        ) : (
          <>
            <div>p50 {formatValue(values.p50, strip.unit)}</div>
            <div className="text-muted">p95 {formatValue(values.p95, strip.unit)}</div>
            <div className="text-muted">max {formatValue(values.max, strip.unit)}</div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Found, separated, still possible. With nothing found the first two would be "0 of 0"
 * and a percentage of nothing, so the row says in words that there was nothing to
 * separate — and stays silent about whether the policy would have.
 */
function Triples({ report }: { report: BatchReport }) {
  const { found, broken, possible, byPrimitive } = report.triples
  const credited = [
    ...PRIMITIVES.map((primitive) => [primitive.label, byPrimitive[primitive.kind]] as const),
    ['unattributed', byPrimitive.unattributed] as const,
  ].filter(([, value]) => value > 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-0">
        {found === 0 ? (
          <Tile label="Triples found" first>
            <div className="text-[27px]">0</div>
            <Note>
              The detector marks no sandwich triple in these {number.format(report.blocks)} blocks,
              so there is nothing here for the policy to separate.
            </Note>
          </Tile>
        ) : (
          <>
            <Tile label="Separated" first>
              <div className="text-[27px]">
                {number.format(broken)} of {number.format(found)} ·{' '}
                {percent(Math.floor((broken * 1000) / found))} %
              </div>
            </Tile>
            <Tile label="Still possible">
              <div className={`text-[27px] ${possible > 0 ? 'text-extracted' : ''}`}>
                {number.format(possible)}
              </div>
            </Tile>
          </>
        )}
        <Tile label="Blocks where nothing changed">
          <div className="text-[27px]">{number.format(report.unchangedBlocks)}</div>
        </Tile>
      </div>

      {credited.length === 0 ? null : (
        <div className="text-[12px] text-muted">
          Separated by:{' '}
          {credited.map(([label, value]) => `${label} ${number.format(value)}`).join(' · ')}
        </div>
      )}
    </div>
  )
}

function Tile({
  label,
  first = false,
  children,
}: { label: string; first?: boolean; children: ReactNode }) {
  return (
    <div
      className={`flex flex-1 flex-col gap-1.5 ${first ? 'sm:pr-10' : 'border-hairline sm:border-l sm:px-10'}`}
    >
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</div>
      {children}
    </div>
  )
}

/** The same figures as the strips, as a table — for reading values off rather than shapes. */
function PercentileTable({ strips }: { strips: Strip[] }) {
  return (
    <details className="text-[12px]">
      <summary className="cursor-pointer text-muted hover:text-ink">All percentiles</summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr className="border-b border-hairline text-left text-[11px] text-muted">
              <th className="py-1.5 pr-4 font-normal">Measure</th>
              {['p10', 'p50', 'p90', 'p95', 'max'].map((label) => (
                <th key={label} className="py-1.5 pr-4 text-right font-normal">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {strips.map(({ key, name, unit, values }) => (
              <tr key={key} className="border-b border-hairline">
                <td className="py-1.5 pr-4">{name}</td>
                {values === null ? (
                  <td colSpan={5} className="py-1.5 pr-4 text-right text-muted">
                    nothing to measure
                  </td>
                ) : (
                  [values.p10, values.p50, values.p90, values.p95, values.max].map(
                    (value, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: five fixed columns
                      <td key={index} className="py-1.5 pr-4 text-right">
                        {formatValue(value, unit)}
                      </td>
                    ),
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function Headline({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
      <div className="text-[21px]">{left}</div>
      <div className="text-[12px] text-muted">{right}</div>
    </div>
  )
}

function Count({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="max-w-[620px] text-[12px] text-muted">{children}</p>
}

/** The policy's name when the tab holds that policy; otherwise the screen goes by its hash. */
function policyName(session: PolicySession, hash: string): string | null {
  return session.parsed.ok && session.draftHash === hash ? session.parsed.policy.name : null
}

function subtitleOf(view: BatchView): string {
  return `batch ${view.id.slice(0, 8)} · started ${view.createdAt.slice(0, 16).replace('T', ' ')} UTC`
}

function shortHash(hash: string): string {
  return `policy · ${hash.slice(0, 8)}…${hash.slice(-4)}`
}

function clampCount(value: number, available: number): number | null {
  if (!Number.isFinite(value)) return null

  return Math.max(1, Math.min(Math.floor(value), available))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
