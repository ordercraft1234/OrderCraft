import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeBlock } from '@ordercraft/core'
import { fill } from './fill.ts'
import { renderCandidate } from './review.ts'
import { fetchBlock } from './rpc.ts'
import { type Candidate, findCandidates, sampleSlots } from './scan.ts'
import { readSlot, slotPath, writeSlot } from './store.ts'

const CACHE_DIR = '.cache/slots'
const FIXTURE_DIR = 'packages/fixtures/slots'

const usage = `slotctl fetch <slot> [--fixture] [--out <dir>]
slotctl fill <from> --count <n> [--every <k>] [--pause <ms>] [--out <dir>]
slotctl scan <dir> [--window <n>] [--random <k>] [--seed <n>]
             [--include-failed] [--include-inert] [--out <file>]
slotctl review <shortlist> [--index <n>] [--slots <dir>]

  fetch  Fetches one slot, normalises it and writes <slot>.json.gz.
         Default target is ${CACHE_DIR}; --fixture writes to ${FIXTURE_DIR}.
         Needs SOLANA_RPC_URL in the environment.

  fill   Walks <n> slots from <from>, stepping by --every, into ${CACHE_DIR}.
         Slots already on disk are not asked for again, so an interrupted run
         continues where it stopped. Slots that hold no block are counted, not
         retried. Needs SOLANA_RPC_URL. Budget roughly 420 KB per slot.

  scan   Reads every slot in <dir> and prints candidate triples for manual
         review. The filter is wider than the detector on purpose; --random
         also draws <k> slots that no filter chose, so recall can be measured
         against something the detector did not select. The draw is seeded, so
         the same --seed over the same directory yields the same shortlist.
         Two kinds of row are left out because there is nothing in them to
         judge: triples where one of the three transactions failed, and those
         whose outer pair moved no value to anybody. --include-failed and
         --include-inert put them back, so both exclusions stay measurable.

  review Prints one candidate from a shortlist written by scan --out, with the
         three transactions, what each moved and the outer pair's net position
         per mint. Evidence only — it does not run the detector, because labels
         that agree with the detector cannot measure it.`

function flag(rest: string[], name: string): string | undefined {
  const at = rest.indexOf(name)
  return at === -1 ? undefined : rest[at + 1]
}

async function fetchCommand(slotArgument: string, rest: string[]): Promise<number> {
  const slot = Number(slotArgument)
  if (!Number.isSafeInteger(slot) || slot < 0) {
    process.stderr.write(`not a slot number: ${slotArgument}\n`)
    return 2
  }

  const url = process.env.SOLANA_RPC_URL
  if (url === undefined || url === '') {
    process.stderr.write(
      'SOLANA_RPC_URL is not set — live fetching is off, and the curated set in packages/fixtures is all that is available.\n',
    )
    return 1
  }

  const directory = flag(rest, '--out') ?? (rest.includes('--fixture') ? FIXTURE_DIR : CACHE_DIR)
  const bundle = normalizeBlock(slot, await fetchBlock(slot, { url }))
  const path = writeSlot(directory, bundle)

  process.stdout.write(`${path} — ${bundle.transactions.length} transactions\n`)
  return 0
}

async function fillCommand(fromArgument: string, rest: string[]): Promise<number> {
  const from = Number(fromArgument)
  const count = Number(flag(rest, '--count') ?? 0)
  const every = Number(flag(rest, '--every') ?? 1)
  const pauseMs = Number(flag(rest, '--pause') ?? 200)
  const numbers = [from, count, every, pauseMs]
  if (!numbers.every((value) => Number.isSafeInteger(value) && value >= 0) || count === 0) {
    process.stderr.write('fill takes a slot, --count above zero, and whole --every/--pause\n')
    return 2
  }

  const url = process.env.SOLANA_RPC_URL
  if (url === undefined || url === '') {
    process.stderr.write('SOLANA_RPC_URL is not set — there is nothing to fill from.\n')
    return 1
  }

  const directory = flag(rest, '--out') ?? CACHE_DIR
  const report = await fill(
    {
      has: (slot) => existsSync(slotPath(directory, slot)),
      fetch: (slot) => fetchBlock(slot, { url }),
      store: (slot, block) => {
        writeSlot(directory, normalizeBlock(slot, block))
      },
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      note: (line) => process.stdout.write(`${line}\n`),
    },
    { from, count, every, pauseMs },
  )

  process.stdout.write(
    `${directory} — ${report.fetched.length} fetched, ${report.held.length} already held, ${report.missing.length} without a block, ${report.failed.length} failed\n`,
  )
  for (const { slot, reason } of report.failed) process.stdout.write(`  ${slot}: ${reason}\n`)

  return report.failed.length === 0 ? 0 : 1
}

function scanCommand(directory: string, rest: string[]): number {
  const files = readdirSync(directory).filter((name) => name.endsWith('.json.gz'))
  if (files.length === 0) {
    process.stderr.write(`no slots in ${directory}\n`)
    return 1
  }

  const windowArgument = flag(rest, '--window')
  const window = windowArgument === undefined ? undefined : Number(windowArgument)

  const randomCount = Number(flag(rest, '--random') ?? 0)
  const seed = Number(flag(rest, '--seed') ?? 0)
  if (!Number.isSafeInteger(randomCount) || !Number.isSafeInteger(seed)) {
    process.stderr.write('--random and --seed take whole numbers\n')
    return 2
  }

  const candidates: Candidate[] = []
  const scanned: number[] = []

  for (const file of files) {
    const bundle = readSlot(join(directory, file))
    scanned.push(bundle.slot)
    candidates.push(
      ...findCandidates(bundle, {
        ...(window === undefined ? {} : { window }),
        includeFailed: rest.includes('--include-failed'),
        includeInert: rest.includes('--include-inert'),
      }),
    )
  }

  // Slots drawn without looking at the filter. Attacks the filter cannot see exist
  // only here, and without them recall is measured against our own imagination.
  const withoutCandidates = scanned.filter(
    (slot) => !candidates.some((candidate) => candidate.slot === slot),
  )
  const randomSlots = sampleSlots(withoutCandidates, randomCount, seed)

  // The seed travels with the shortlist: labels are worth nothing if the set they
  // describe cannot be drawn again.
  const shortlist = { seed, scanned, candidates, randomSlots }
  const out = flag(rest, '--out')
  if (out === undefined) {
    process.stdout.write(
      `${scanned.length} slots, ${candidates.length} candidates, ${randomSlots.length} random slots\n`,
    )
  } else {
    writeFileSync(out, `${JSON.stringify(shortlist, null, 1)}\n`, 'utf8')
    process.stdout.write(`${out} — ${candidates.length} candidates from ${scanned.length} slots\n`)
  }

  return 0
}

/**
 * Prints one candidate, or the index of the shortlist when none is named.
 *
 * A shortlist runs to thousands of entries, and the reviewer works through it one row
 * at a time over hours — so the command takes an index and prints exactly one, rather
 * than a report that has to be scrolled to the place work stopped.
 */
function reviewCommand(shortlistPath: string, rest: string[]): number {
  if (!existsSync(shortlistPath)) {
    process.stderr.write(`no shortlist at ${shortlistPath}\n`)
    return 1
  }

  const shortlist = JSON.parse(readFileSync(shortlistPath, 'utf8')) as {
    seed?: number
    candidates?: Candidate[]
  }
  const candidates = shortlist.candidates ?? []
  if (candidates.length === 0) {
    process.stderr.write(`${shortlistPath} holds no candidates\n`)
    return 1
  }

  const directory = flag(rest, '--slots') ?? CACHE_DIR
  const indexArgument = flag(rest, '--index')
  if (indexArgument === undefined) {
    process.stdout.write(
      `${candidates.length} candidates over ${
        new Set(candidates.map((candidate) => candidate.slot)).size
      } slots, seed ${shortlist.seed ?? 0}\nPick one with --index 0..${candidates.length - 1}\n`,
    )
    return 0
  }

  const index = Number(indexArgument)
  if (!Number.isSafeInteger(index) || index < 0 || index >= candidates.length) {
    process.stderr.write(`--index takes 0..${candidates.length - 1}\n`)
    return 2
  }

  const candidate = candidates[index] as Candidate
  const path = slotPath(directory, candidate.slot)
  if (!existsSync(path)) {
    process.stderr.write(`slot ${candidate.slot} is not in ${directory}\n`)
    return 1
  }

  process.stdout.write(
    `[${index}/${candidates.length - 1}]\n${renderCandidate(readSlot(path), candidate)}`,
  )
  return 0
}

async function main(argv: string[]): Promise<number> {
  const [command, target, ...rest] = argv

  if (command === 'fetch' && target !== undefined) return fetchCommand(target, rest)
  if (command === 'fill' && target !== undefined) return fillCommand(target, rest)
  if (command === 'scan' && target !== undefined) return scanCommand(target, rest)
  if (command === 'review' && target !== undefined) return reviewCommand(target, rest)

  process.stderr.write(`${usage}\n`)
  return 2
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
