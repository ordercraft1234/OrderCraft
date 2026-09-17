import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type SlotLabels, normalizeBlock, slotLabelsSchema } from '@ordercraft/core'
import {
  type CrossSlot,
  corpusOf,
  crossSlot,
  renderHit as renderCrossHit,
  summarize as summarizeCross,
  toCandidates,
} from './cross.ts'
import { fill } from './fill.ts'
import { type Verdict, progressOf, recordVerdict } from './label.ts'
import { type LegPair, groupByLegs, renderPair } from './review.ts'
import { fetchBlock } from './rpc.ts'
import { type Candidate, findCandidates, sampleSlots } from './scan.ts'
import { renderHit, screenSlot, summarize } from './screen.ts'
import { readSlot, slotPath, writeSlot } from './store.ts'

const CACHE_DIR = '.cache/slots'
const FIXTURE_DIR = 'packages/fixtures/slots'
const LABEL_DIR = 'packages/fixtures/labels'

const usage = `slotctl fetch <slot> [--fixture] [--out <dir>]
slotctl fill <from> --count <n> [--every <k>] [--pause <ms>] [--out <dir>]
slotctl scan <dir> [--window <n>] [--random <k>] [--seed <n>]
             [--include-failed] [--include-inert] [--out <file>]
slotctl review <shortlist> [--index <n>] [--slot <n>] [--slots <dir>]
slotctl label  <shortlist> [--index <n>] [--slot <n>] [--labels <dir>]
               (--attack | --reject) --note <text> [--victims <a,b>]
slotctl screen <shortlist> [--slots <dir>] [--labels <dir>]
slotctl cross  <dir> [--max-program-signers <n>] [--seed <n>] [--out <file>]

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

  review Prints one pair of legs from a shortlist written by scan --out, with
         everything the shortlist found between them, what each transaction
         moved and the pair's net position per mint. Evidence only — it does not
         run the detector, because labels that agree with the detector cannot
         measure it. The index counts pairs, not rows: a label is written per
         pair, and scan emits a row per transaction in between. --slot narrows
         the run to one slot, which is how one label file gets filled.

  cross  Reads every slot in <dir> and prints the profitable round trips whose two
         legs were signed by **different** parties — the one assumption scan, the
         wider screen and the detector all share and none of them has tested. Each
         row carries whatever visibly relates the two signers: a third party that
         signs somewhere and moved value in both legs, a program almost nobody else
         invokes, or one signer's balance moving inside the other's transaction.
         The link chooses which slots are worth reviewing; it never chooses which
         pairs are labelled, so the set stays reproducible from this directory
         alone. --out writes a shortlist review and label read unchanged, and
         --seed travels into it so the draw that chose the slots is recorded
         beside the verdicts written against them.

  label  Writes the verdict for the pair review just printed into
         ${LABEL_DIR}/<slot>.json, indexed exactly as review
         indexes it. Without a verdict it reports where the slot stopped and
         which indices are still unjudged. coverage is derived, never typed:
         a file claims exhaustive only once every pair the shortlist proposes
         in that slot carries a verdict. Re-labelling a pair replaces its
         verdict rather than adding a second one. Like review, it does not run
         the detector.`

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
 * Prints one pair of legs, or the size of the shortlist when none is named.
 *
 * A shortlist runs to thousands of entries, and the reviewer works through it one at a
 * time over hours — so the command takes an index and prints exactly one, rather than a
 * report that has to be scrolled to the place work stopped.
 *
 * **The index counts pairs, not shortlist rows.** A label is written per pair of legs,
 * so a pair with three transactions between it is one decision, not three; over the
 * seven slots T047 labels that is 56 prompts instead of 82. `--slot` narrows the run to
 * one slot, which is how an exhaustively labelled file gets filled without walking the
 * whole cache.
 */
/**
 * The shortlist as the pairs both `review` and `label` work through.
 *
 * Shared on purpose rather than by coincidence: the reviewer reads a pair with one
 * command and records the verdict with the other, typing the same `--index` into both.
 * Were the two to group or filter rows differently, that index would name a different
 * pair in each, and the verdict would land on something nobody looked at.
 */
function loadPairs(
  shortlistPath: string,
  rest: string[],
): { pairs: LegPair[]; seed: number; rows: number } | number {
  if (!existsSync(shortlistPath)) {
    process.stderr.write(`no shortlist at ${shortlistPath}\n`)
    return 1
  }

  const shortlist = JSON.parse(readFileSync(shortlistPath, 'utf8')) as {
    seed?: number
    candidates?: Candidate[]
  }
  const all = shortlist.candidates ?? []
  if (all.length === 0) {
    process.stderr.write(`${shortlistPath} holds no candidates\n`)
    return 1
  }

  const slotArgument = flag(rest, '--slot')
  const only = slotArgument === undefined ? undefined : Number(slotArgument)
  if (only !== undefined && !Number.isSafeInteger(only)) {
    process.stderr.write('--slot takes a slot number\n')
    return 2
  }

  const candidates = only === undefined ? all : all.filter((one) => one.slot === only)
  if (candidates.length === 0) {
    process.stderr.write(`${shortlistPath} holds no candidates in slot ${String(only)}\n`)
    return 1
  }

  return { pairs: groupByLegs(candidates), seed: shortlist.seed ?? 0, rows: candidates.length }
}

function reviewCommand(shortlistPath: string, rest: string[]): number {
  const loaded = loadPairs(shortlistPath, rest)
  if (typeof loaded === 'number') return loaded

  const { pairs, seed, rows } = loaded
  const directory = flag(rest, '--slots') ?? CACHE_DIR
  const indexArgument = flag(rest, '--index')
  if (indexArgument === undefined) {
    process.stdout.write(
      `${pairs.length} pairs of legs over ${
        new Set(pairs.map((pair) => pair.slot)).size
      } slots, from ${rows} shortlist rows, seed ${seed}\nPick one with --index 0..${
        pairs.length - 1
      }\n`,
    )
    return 0
  }

  const index = Number(indexArgument)
  if (!Number.isSafeInteger(index) || index < 0 || index >= pairs.length) {
    process.stderr.write(`--index takes 0..${pairs.length - 1}\n`)
    return 2
  }

  const pair = pairs[index] as LegPair
  const path = slotPath(directory, pair.slot)
  if (!existsSync(path)) {
    process.stderr.write(`slot ${pair.slot} is not in ${directory}\n`)
    return 1
  }

  process.stdout.write(`[${index}/${pairs.length - 1}]\n${renderPair(readSlot(path), pair)}`)
  return 0
}

function labelPath(directory: string, slot: number): string {
  return join(directory, `${slot}.json`)
}

function readLabels(path: string): SlotLabels | undefined {
  return existsSync(path)
    ? slotLabelsSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    : undefined
}

/**
 * `--victims 441,443`, the transactions actually traded against.
 *
 * `#` is accepted in front of each because that is how `review` prints them, and a
 * reviewer copying a number off the screen should not have to strip it. Anything that
 * is not a whole number is dropped here and then caught by `recordVerdict`, which knows
 * which indices lie between the legs.
 */
function parseVictims(argument: string | undefined): number[] | undefined {
  return argument === undefined
    ? undefined
    : argument
        .split(',')
        .map((piece) => Number(piece.trim().replace(/^#/, '')))
        .filter((value) => Number.isSafeInteger(value))
}

/**
 * Where each slot's review stopped, and the index to resume at.
 *
 * The reviewer works through 56 pairs over hours and more than one sitting, so the
 * question "where was I?" is asked more often than any single verdict.
 */
function reportProgress(pairs: LegPair[], directory: string): number {
  for (const slot of [...new Set(pairs.map((pair) => pair.slot))]) {
    const inSlot = pairs.filter((pair) => pair.slot === slot)
    const progress = progressOf(readLabels(labelPath(directory, slot)), inSlot)
    // Reported as the index the reviewer would type, which is the one review prints:
    // positions inside the slot when --slot narrowed the run, positions across the
    // whole shortlist when it did not.
    const next = progress.remaining.map((at) => pairs.indexOf(inSlot[at] as LegPair))
    process.stdout.write(
      `slot ${slot}  ${progress.done}/${progress.total} judged  ${progress.coverage}${
        next.length === 0 ? '' : `  next --index ${next[0]}`
      }\n`,
    )
  }

  return 0
}

/**
 * Records the verdict for one pair, or reports where the slot's review stopped.
 *
 * The protocol asks for a verdict on **every** pair — 56 over the seven slots of T047 —
 * and the file those verdicts go into carries two claims that hand-editing gets wrong
 * quietly. A pair written twice is counted twice by `accuracyAgainst`; a file that says
 * `exhaustive` while pairs are missing inflates recall by exactly the rows nobody
 * looked at, and `unjudgedHits` only catches the subset the detector also fired on. Both
 * are settled here — the second by deriving `coverage` from the count rather than
 * accepting it as input.
 *
 * What is deliberately *not* automated is the judgement. Nothing on this path imports
 * the detector, for the reason `renderPair` does not print it: labels that agree with
 * the detector measure the reviewer's deference, not the rule.
 */
function labelCommand(shortlistPath: string, rest: string[]): number {
  const loaded = loadPairs(shortlistPath, rest)
  if (typeof loaded === 'number') return loaded

  const { pairs, seed } = loaded
  const directory = flag(rest, '--labels') ?? LABEL_DIR
  const indexArgument = flag(rest, '--index')
  const attack = rest.includes('--attack')
  const reject = rest.includes('--reject')

  if (attack && reject) {
    process.stderr.write('--attack and --reject are the two answers; pass one\n')
    return 2
  }

  // No verdict is not an error: it is how a session that stopped somewhere in a slot
  // finds the next index without re-reading pairs it already judged.
  if (!attack && !reject) return reportProgress(pairs, directory)

  const note = flag(rest, '--note')
  if (note === undefined || note.trim() === '') {
    process.stderr.write(
      'every verdict needs --note in your own words — a label without a reason cannot be argued with later\n',
    )
    return 2
  }

  if (indexArgument === undefined) {
    process.stderr.write(`--index takes 0..${pairs.length - 1}, the same index review prints\n`)
    return 2
  }

  const index = Number(indexArgument)
  if (!Number.isSafeInteger(index) || index < 0 || index >= pairs.length) {
    process.stderr.write(`--index takes 0..${pairs.length - 1}\n`)
    return 2
  }

  const victims = parseVictims(flag(rest, '--victims'))
  const pair = pairs[index] as LegPair
  const verdict: Verdict = attack ? 'attack' : 'reject'
  const path = labelPath(directory, pair.slot)
  const pairsInSlot = pairs.filter((one) => one.slot === pair.slot).length

  const { labels, replaced } = recordVerdict(
    readLabels(path),
    pair,
    { verdict, note, ...(victims === undefined ? {} : { victims }) },
    { seed, pairsInSlot, checkedOn: new Date().toISOString().slice(0, 10) },
  )

  mkdirSync(directory, { recursive: true })
  writeFileSync(path, `${JSON.stringify(slotLabelsSchema.parse(labels), null, 1)}\n`, 'utf8')

  const judged = labels.attacks.length + labels.rejected.length
  process.stdout.write(
    `${path} — #${pair.front}/${pair.back} ${verdict === 'attack' ? 'attack' : 'rejected'}${
      replaced ? ' (replaced)' : ''
    }, ${judged}/${pairsInSlot} judged in slot ${pair.slot}, ${labels.coverage}\n`,
  )
  return 0
}

/**
 * Prints the slots the wider screen chose, with what it found in each.
 *
 * Slots already carrying labels are marked rather than hidden: three of the seven the
 * previous set labelled turn up here too, and their verdicts still stand — a label
 * describes a block, not a rule.
 */
function screenCommand(shortlistPath: string, rest: string[]): number {
  const loaded = loadPairs(shortlistPath, rest)
  if (typeof loaded === 'number') return loaded

  const { pairs } = loaded
  const directory = flag(rest, '--slots') ?? CACHE_DIR
  const labelDirectory = flag(rest, '--labels') ?? LABEL_DIR
  const labelled = new Set(
    existsSync(labelDirectory)
      ? readdirSync(labelDirectory)
          .filter((name) => name.endsWith('.json'))
          .map((name) => Number(name.replace('.json', '')))
      : [],
  )

  const screened = []
  for (const slot of [...new Set(pairs.map((pair) => pair.slot))].sort(
    (left, right) => left - right,
  )) {
    const path = slotPath(directory, slot)
    if (!existsSync(path)) {
      process.stderr.write(`slot ${slot} is not in ${directory}
`)
      return 1
    }

    const result = screenSlot(readSlot(path), pairs)
    screened.push(result)
    if (result.hits.length === 0) continue

    process.stdout.write(
      `slot ${slot}  ${result.pairs} pairs${labelled.has(slot) ? '  (already labelled)' : ''}
`,
    )
    for (const hit of result.hits)
      process.stdout.write(`${renderHit(hit)}
`)
  }

  process.stdout.write(`
${summarize(screened, labelled)}
`)
  return 0
}

/**
 * Prints the cross-signer round trips a directory of slots holds (T058).
 *
 * **What is measured over what.** The pairs come from each slot on its own, so this
 * directory is all that is needed to rebuild the set somebody labelled. The *links*
 * between two signers are read against the whole directory as a corpus, and a program
 * that looks rare in thirty slots need not be rare on chain — which is why the link
 * picks slots to review and never picks pairs to label.
 */
function crossCommand(directory: string, rest: string[]): number {
  const files = readdirSync(directory).filter((name) => name.endsWith('.json.gz'))
  if (files.length === 0) {
    process.stderr.write(`no slots in ${directory}\n`)
    return 1
  }

  const maxArgument = flag(rest, '--max-program-signers')
  const maxProgramSigners = maxArgument === undefined ? undefined : Number(maxArgument)
  if (maxProgramSigners !== undefined && !Number.isSafeInteger(maxProgramSigners)) {
    process.stderr.write('--max-program-signers takes a whole number\n')
    return 2
  }

  const seed = Number(flag(rest, '--seed') ?? 0)
  if (!Number.isSafeInteger(seed)) {
    process.stderr.write('--seed takes a whole number\n')
    return 2
  }

  const bundles = files.map((name) => readSlot(join(directory, name)))
  const corpus = corpusOf(bundles, maxProgramSigners)
  const slots: CrossSlot[] = bundles
    .map((bundle) => crossSlot(bundle, corpus))
    .sort((left, right) => left.slot - right.slot)

  for (const slot of slots) {
    if (slot.hits.length === 0) continue
    process.stdout.write(`slot ${slot.slot}  ${slot.hits.length} pairs\n`)
    for (const hit of slot.hits) process.stdout.write(`${renderCrossHit(hit)}\n`)
  }

  const out = flag(rest, '--out')
  if (out !== undefined) {
    const candidates = toCandidates(slots)
    writeFileSync(
      out,
      `${JSON.stringify({ seed, scanned: slots.map((slot) => slot.slot), candidates, randomSlots: [] }, null, 1)}\n`,
      'utf8',
    )
    process.stdout.write(`${out} — ${candidates.length} rows\n`)
  }

  process.stdout.write(`
${summarizeCross(slots)}\n`)
  return 0
}

async function main(argv: string[]): Promise<number> {
  const [command, target, ...rest] = argv

  if (command === 'fetch' && target !== undefined) return fetchCommand(target, rest)
  if (command === 'fill' && target !== undefined) return fillCommand(target, rest)
  if (command === 'scan' && target !== undefined) return scanCommand(target, rest)
  if (command === 'review' && target !== undefined) return reviewCommand(target, rest)
  if (command === 'label' && target !== undefined) return labelCommand(target, rest)
  if (command === 'screen' && target !== undefined) return screenCommand(target, rest)
  if (command === 'cross' && target !== undefined) return crossCommand(target, rest)

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
