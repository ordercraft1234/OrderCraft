/**
 * SC-005, measured from the outside: a batch over N slots finishes in under three
 * minutes and shows progress at least once every two seconds.
 *
 *   node apps/api/scripts/measure-batch.ts [--api <url>] [--count <n>] [--preset <id>]
 *                                          [--fill-from <slot>]
 *
 * It talks to a running API the way the web app does — HTTP and the event stream, no
 * imports from the server — so the number includes the database, the network and the
 * stream, not just the kernel. Each run saves a policy whose name carries the time, so
 * its hash is new and every run of the batch is computed, not read back: a batch over
 * runs that already exist computes nothing, and timing it would measure a cache.
 *
 * `--fill-from` loads the missing slots through `POST /slots/fetch`, walking up from
 * the given slot, when the server knows fewer than N; that needs the server to have an
 * RPC address, and keeps to its fetch limit by waiting out every 429.
 *
 * The gap is measured from the moment the batch is asked for, so a slow first slot
 * counts against it like any other.
 */
import { presetById } from '@ordercraft/core'
import {
  batchEventSchema,
  batchViewSchema,
  createBatchResponseSchema,
  createPolicyResponseSchema,
  listSlotsResponseSchema,
} from '@ordercraft/shared'

const BUDGET_MS = 180_000
const GAP_MS = 2_000

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index] ?? '', process.argv[index + 1] ?? '')
}

const api = `${(args.get('--api') ?? 'http://localhost:8787').replace(/\/$/, '')}/api`
const count = Number(args.get('--count') ?? '100')
const preset = presetById(args.get('--preset') ?? 'anti-snipe-launch')
if (preset === undefined) throw new Error(`no preset ${args.get('--preset')}`)

async function call(path: string, init: { method?: string; json?: unknown } = {}) {
  const request: RequestInit = { method: init.method ?? 'GET' }
  if (init.json !== undefined) {
    request.headers = { 'content-type': 'application/json' }
    request.body = JSON.stringify(init.json)
  }

  return fetch(`${api}${path}`, request)
}

async function known(): Promise<number[]> {
  const response = await call('/slots?source=all')
  if (!response.ok) throw new Error(`GET /slots: ${response.status}`)

  return listSlotsResponseSchema
    .parse(await response.json())
    .map((summary) => summary.slot)
    .sort((left, right) => left - right)
}

async function fill(from: number, have: number[]): Promise<void> {
  const present = new Set(have)
  let slot = from
  let loaded = have.length
  let retries = 0

  while (loaded < count) {
    if (present.has(slot)) {
      slot += 1
      continue
    }

    const response = await call('/slots/fetch', { method: 'POST', json: { slot } })
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 6_500))
      continue
    }
    if (response.status === 404) {
      console.log(`fill: ${slot} has no block, skipped`)
      slot += 1
      continue
    }
    // The upstream node fails a request now and then; the same slot loads on a retry.
    if (response.status === 502 && retries < 3) {
      retries += 1
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      continue
    }
    if (!response.ok) throw new Error(`POST /slots/fetch ${slot}: ${response.status}`)
    retries = 0

    loaded += 1
    console.log(`fill: ${slot} loaded (${loaded}/${count})`)
    slot += 1
  }
}

let slots = await known()
const fillFrom = args.get('--fill-from')
if (slots.length < count && fillFrom !== undefined) {
  await fill(Number(fillFrom), slots)
  slots = await known()
}
if (slots.length < count) {
  throw new Error(`the server knows ${slots.length} slots, ${count} asked for; pass --fill-from`)
}
const sample = slots.slice(0, count)

const stamp = new Date().toISOString()
const policy = { ...preset.policy, name: `SC-005 measurement ${stamp}` }
const saved = await call('/policies', { method: 'POST', json: { body: policy } })
if (!saved.ok) throw new Error(`POST /policies: ${saved.status} ${await saved.text()}`)
const { hash } = createPolicyResponseSchema.parse(await saved.json())

const started = performance.now()
const created = await call('/batches', { method: 'POST', json: { hash, slots: sample } })
if (created.status !== 201)
  throw new Error(`POST /batches: ${created.status} ${await created.text()}`)
const { batchId } = createBatchResponseSchema.parse(await created.json())

const stream = await call(`/batches/${batchId}/events`)
if (!stream.ok || stream.body === null) throw new Error(`events: ${stream.status}`)

const times: number[] = []
let ending = ''
let buffer = ''
const decoder = new TextDecoder()
for await (const chunk of stream.body) {
  buffer += decoder.decode(chunk, { stream: true })
  let boundary = buffer.indexOf('\n\n')
  while (boundary !== -1) {
    const message = buffer.slice(0, boundary)
    buffer = buffer.slice(boundary + 2)
    boundary = buffer.indexOf('\n\n')

    const data = message.split('\n').find((line) => line.startsWith('data:'))
    if (data === undefined) continue
    const event = batchEventSchema.parse(JSON.parse(data.slice(5)))
    times.push(performance.now())
    if (event.event !== 'progress') ending = event.event
  }
}

const totalMs = Math.round((times.at(-1) ?? started) - started)
const gaps = times.map(
  (time, position) => time - (position === 0 ? started : (times[position - 1] ?? 0)),
)
const maxGapMs = Math.round(Math.max(...gaps))

const view = batchViewSchema.parse(await (await call(`/batches/${batchId}`)).json())

console.log(`api           ${api}`)
console.log(`preset        ${preset.id}, hash ${hash.slice(0, 12)}`)
console.log(`batch         ${batchId}, ${view.status}, ${view.doneCount}/${sample.length} slots`)
console.log(`events        ${times.length} (ending: ${ending})`)
console.log(
  `total         ${totalMs} ms (budget ${BUDGET_MS} ms) — ${totalMs < BUDGET_MS ? 'within' : 'OVER'}`,
)
console.log(
  `longest gap   ${maxGapMs} ms (budget ${GAP_MS} ms) — ${maxGapMs <= GAP_MS ? 'within' : 'OVER'}`,
)
console.log(`per slot      ${Math.round(totalMs / Math.max(view.doneCount, 1))} ms on average`)
if (view.report !== null) {
  const { triples, addedDelayMs, heldDelayMs } = view.report
  console.log(
    `report        ${view.report.blocks} blocks, triples ${triples.broken}/${triples.found} broken, ` +
      `added p50/p95 ${addedDelayMs?.p50 ?? '-'}/${addedDelayMs?.p95 ?? '-'} ms, ` +
      `held p50/p95 ${heldDelayMs?.p50 ?? '-'}/${heldDelayMs?.p95 ?? '-'} ms`,
  )
}
