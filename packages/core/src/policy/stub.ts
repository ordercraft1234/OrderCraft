/**
 * OrderCraft policy — TypeScript stub for policy files of format `ordercraft.policy` v1.
 *
 * This is not a Jito BAM config. It does not plug into production block ordering; the
 * integrator supplies the implementation. OrderCraft only simulates what the policy
 * would do to recorded slots.
 *
 * What the file gives you:
 *
 * - the types of a policy and of the file it travels in;
 * - `readPolicyFile`, which accepts exactly the files OrderCraft's own import accepts
 *   and checks the content hash;
 * - `OrderBlock`, the signature of the function that orders one block by a policy. Its
 *   body is yours to write: `orderBlock` below only throws. `checkOrdering` tells you
 *   whether what your function returned accounts for every transaction exactly once.
 *
 * The file imports nothing. It needs `crypto.subtle` and `TextEncoder`, which Node 19+,
 * Deno, Bun and browsers all provide.
 */

export const POLICY_FILE_FORMAT = 'ordercraft.policy'
export const POLICY_FILE_VERSION = 1
export const POLICY_SCHEMA_VERSION = 1

/** The sentence every policy file carries in its `notice` field. */
export const POLICY_FILE_NOTICE =
  'This is not a Jito BAM config. It does not plug into production block ordering; the integrator supplies the implementation. OrderCraft only simulates what the policy would do to recorded slots.'

// ── The policy ──────────────────────────────────────────────────────────────────────

/**
 * Which transactions a step applies to. Every branch is answerable from the
 * transaction alone. Addresses are base58, 1 to 20 per list.
 *
 * - `all` — every transaction still in the block.
 * - `program` / `signer` / `account` — any listed address appears among the
 *   transaction's programs, signers or accounts.
 * - `tokenDeltaAbove` — some owner's balance of `mint` moved by more than `amount` base
 *   units, in either direction. `amount` is an unsigned integer written as a string.
 */
export type Selector =
  | { match: 'all' }
  | { match: 'program'; programs: string[] }
  | { match: 'signer'; signers: string[] }
  | { match: 'account'; accounts: string[] }
  | { match: 'tokenDeltaAbove'; mint: string; amount: string }

/**
 * One step. Steps run in the order written, each on what the previous one left in the
 * block; a transaction already deferred or dropped is not touched again.
 *
 * - `speedBump` — adds `delayMs` (0–400) to the time of every matching transaction.
 * - `batchAuction` — moves every matching transaction to the close of the window it
 *   falls in; windows are `windowMs` (50–400) long and counted from the start of the
 *   slot, and a transaction exactly on a boundary opens the next window. Everything
 *   that settles at one close is one batch.
 * - `allowDeny` — 1 to 20 rules. A transaction matched by any `deny` rule is dropped;
 *   otherwise one matched by a `prioritise` rule goes ahead of every unprioritised
 *   transaction. Deny wins regardless of rule order.
 *
 * A transaction whose time reaches the end of the slot is deferred, not dropped: the
 * policy did not refuse it, it would just not make this block. OrderCraft's simulator
 * measures time on a nominal 400 ms slot; a scheduler uses the slot it actually has.
 */
export type PolicyStep =
  | { kind: 'speedBump'; delayMs: number; appliesTo: Selector }
  | { kind: 'batchAuction'; windowMs: number; appliesTo: Selector }
  | {
      kind: 'allowDeny'
      rules: { effect: 'prioritise' | 'deny'; match: Selector }[]
    }

/** A policy: a name (1–80 characters) and 1 to 12 steps. */
export type Policy = {
  schemaVersion: 1
  name: string
  steps: PolicyStep[]
}

/**
 * A policy file as written. `hash` is the SHA-256 of the policy's canonical JSON — keys
 * sorted, no whitespace — in lower-case hex; `presetId` names the preset it started
 * from and is not covered by the hash.
 */
export type PolicyFile = {
  format: typeof POLICY_FILE_FORMAT
  formatVersion: typeof POLICY_FILE_VERSION
  hash: string
  notice: string
  policy: Policy
  presetId?: string
}

export type PolicyFileErrorCode =
  | 'not-json'
  | 'not-a-policy-file'
  | 'newer-version'
  | 'invalid-file'
  | 'invalid-policy'
  | 'not-canonical'
  | 'hash-mismatch'

export type PolicyFileRead =
  | { ok: true; policy: Policy; hash: string; presetId?: string }
  | { ok: false; error: { code: PolicyFileErrorCode; message: string } }

// ── Reading a file ──────────────────────────────────────────────────────────────────

/**
 * Reads a policy file. It accepts what OrderCraft's export writes, up to formatting and
 * key order, and refuses everything else with a reason: a key a policy does not carry
 * is refused rather than ignored, and a hash that does not match the policy is refused
 * rather than recomputed.
 */
export async function readPolicyFile(text: string): Promise<PolicyFileRead> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return refuse('not-json', 'the file is not JSON')
  }

  if (!isRecord(raw) || raw.format !== POLICY_FILE_FORMAT) {
    return refuse(
      'not-a-policy-file',
      `the file is not an OrderCraft policy file (no "format": "${POLICY_FILE_FORMAT}")`,
    )
  }
  if (isNewer(raw.formatVersion, POLICY_FILE_VERSION)) {
    return refuse('newer-version', `the file has format version ${raw.formatVersion}`)
  }

  const envelope = attempt(() => readEnvelope(raw))
  if (typeof envelope === 'string')
    return refuse('invalid-file', `the file is malformed: ${envelope}`)

  const rawPolicy = envelope.policy
  if (isNewer(rawPolicy.schemaVersion, POLICY_SCHEMA_VERSION)) {
    return refuse('newer-version', `the policy has schema version ${rawPolicy.schemaVersion}`)
  }

  const policy = attempt(() => readPolicy(rawPolicy))
  if (typeof policy === 'string')
    return refuse('invalid-policy', `the policy is invalid: ${policy}`)

  const dropped = droppedKey(rawPolicy, policy, 'policy')
  if (dropped !== null) {
    return refuse('not-canonical', `the file has ${dropped}, which a policy does not carry`)
  }

  const hash = await policyHash(policy)
  if (hash !== envelope.hash) {
    return refuse(
      'hash-mismatch',
      `the policy hashes to ${hash}, but the file claims ${envelope.hash}`,
    )
  }

  return {
    ok: true,
    policy,
    hash,
    ...(envelope.presetId === undefined ? {} : { presetId: envelope.presetId }),
  }
}

/** The content address of a policy: SHA-256 of its canonical JSON, lower-case hex. */
export async function policyHash(policy: Policy): Promise<string> {
  const host = globalThis as unknown as Sha256Host
  const bytes = new host.TextEncoder().encode(canonicalize(policy))
  const digest = new Uint8Array(await host.crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// ── Ordering a block: yours to implement ────────────────────────────────────────────

export type TokenDelta = { owner: string; mint: string; amount: bigint }

export type BlockTransaction = {
  /** Position in the block as received, from 0. The last tie-breaker. */
  index: number
  signature: string
  /**
   * When the transaction reached the scheduler, in whole milliseconds from the start
   * of the slot. Yours to supply: OrderCraft's simulator models it as
   * `floor(index × 400 / N)`, a scheduler knows it.
   */
  arrivalMs: number
  signers: string[]
  programs: string[]
  accounts: string[]
  /** Balance changes by owner and mint, in base units; negative means spent. */
  tokenDelta: TokenDelta[]
}

export type Block = { slot: number; transactions: BlockTransaction[] }

/**
 * What a policy did to a block, by signature. `included` is in the order the block
 * would hold them; `deferred` and `dropped` in the order received. In OrderCraft's
 * simulator the order of `included` is: prioritised first, then time, then `index`.
 */
export type BlockOrdering = { included: string[]; deferred: string[]; dropped: string[] }

export type OrderBlock = (policy: Policy, block: Block) => BlockOrdering

/** Replace this body with your implementation. */
export const orderBlock: OrderBlock = () => {
  throw new Error(
    'orderBlock is not implemented: OrderCraft does not order production blocks — the integrator supplies the implementation',
  )
}

/** Whether an ordering places every transaction of the block exactly once. */
export function checkOrdering(
  block: Block,
  ordering: BlockOrdering,
): { ok: true } | { ok: false; problem: string } {
  const expected = new Set(block.transactions.map((transaction) => transaction.signature))
  const seen = new Set<string>()

  for (const signature of [...ordering.included, ...ordering.deferred, ...ordering.dropped]) {
    if (!expected.has(signature)) {
      return { ok: false, problem: `${signature} is not in slot ${block.slot}` }
    }
    if (seen.has(signature)) return { ok: false, problem: `${signature} is placed twice` }
    seen.add(signature)
  }
  for (const signature of expected) {
    if (!seen.has(signature)) return { ok: false, problem: `${signature} is not placed` }
  }
  return { ok: true }
}

// ── Internals ───────────────────────────────────────────────────────────────────────

type Sha256Host = {
  crypto: { subtle: { digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer> } }
  TextEncoder: new () => { encode(input: string): Uint8Array }
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/
const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/
const HASH = /^[0-9a-f]{64}$/
const PRESET_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ENVELOPE_KEYS = ['format', 'formatVersion', 'hash', 'notice', 'policy', 'presetId']

class Invalid extends Error {}

function refuse(code: PolicyFileErrorCode, message: string): PolicyFileRead {
  return { ok: false, error: { code, message } }
}

/** The value, or the reason it is invalid. */
function attempt<T>(read: () => T): T | string {
  try {
    return read()
  } catch (error) {
    if (error instanceof Invalid) return error.message
    throw error
  }
}

function fail(path: string, message: string): never {
  throw new Invalid(path === '' ? message : `${path}: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNewer(version: unknown, known: number): boolean {
  return typeof version === 'number' && Number.isInteger(version) && version > known
}

function readEnvelope(raw: Record<string, unknown>) {
  const extra = Object.keys(raw).find((key) => !ENVELOPE_KEYS.includes(key))
  if (extra !== undefined) fail('', `unrecognised key "${extra}"`)
  if (raw.formatVersion !== POLICY_FILE_VERSION) fail('formatVersion', 'expected 1')
  const hash = text(raw.hash, 'hash', 0, Number.POSITIVE_INFINITY)
  if (!HASH.test(hash)) fail('hash', 'expected 64 lower-case hex characters')
  text(raw.notice, 'notice', 0, Number.POSITIVE_INFINITY)
  if (!isRecord(raw.policy)) fail('policy', 'expected an object')
  let presetId: string | undefined
  if (raw.presetId !== undefined) {
    presetId = text(raw.presetId, 'presetId', 1, 64)
    if (!PRESET_ID.test(presetId)) fail('presetId', 'expected lower-case words joined by dashes')
  }
  return { hash, policy: raw.policy, presetId }
}

function readPolicy(raw: Record<string, unknown>): Policy {
  if (raw.schemaVersion !== POLICY_SCHEMA_VERSION) fail('schemaVersion', 'expected 1')
  return {
    schemaVersion: POLICY_SCHEMA_VERSION,
    name: text(raw.name, 'name', 1, 80),
    steps: list(raw.steps, 'steps', 1, 12, readStep),
  }
}

function readStep(value: unknown, path: string): PolicyStep {
  const step = record(value, path)
  switch (step.kind) {
    case 'speedBump':
      return {
        kind: 'speedBump',
        delayMs: milliseconds(step.delayMs, `${path}.delayMs`, 0, 400),
        appliesTo: readSelector(step.appliesTo, `${path}.appliesTo`),
      }
    case 'batchAuction':
      return {
        kind: 'batchAuction',
        windowMs: milliseconds(step.windowMs, `${path}.windowMs`, 50, 400),
        appliesTo: readSelector(step.appliesTo, `${path}.appliesTo`),
      }
    case 'allowDeny':
      return { kind: 'allowDeny', rules: list(step.rules, `${path}.rules`, 1, 20, readRule) }
    default:
      return fail(`${path}.kind`, 'expected speedBump, batchAuction or allowDeny')
  }
}

type Rule = Extract<PolicyStep, { kind: 'allowDeny' }>['rules'][number]

function readRule(value: unknown, path: string): Rule {
  const rule = record(value, path)
  if (rule.effect !== 'prioritise' && rule.effect !== 'deny') {
    fail(`${path}.effect`, 'expected prioritise or deny')
  }
  return { effect: rule.effect, match: readSelector(rule.match, `${path}.match`) }
}

function readSelector(value: unknown, path: string): Selector {
  const selector = record(value, path)
  switch (selector.match) {
    case 'all':
      return { match: 'all' }
    case 'program':
      return { match: 'program', programs: addresses(selector.programs, `${path}.programs`) }
    case 'signer':
      return { match: 'signer', signers: addresses(selector.signers, `${path}.signers`) }
    case 'account':
      return { match: 'account', accounts: addresses(selector.accounts, `${path}.accounts`) }
    case 'tokenDeltaAbove': {
      const amount = text(selector.amount, `${path}.amount`, 0, Number.POSITIVE_INFINITY)
      if (!UNSIGNED_INTEGER.test(amount)) fail(`${path}.amount`, 'expected an unsigned integer')
      return { match: 'tokenDeltaAbove', mint: address(selector.mint, `${path}.mint`), amount }
    }
    default:
      return fail(`${path}.match`, 'expected all, program, signer, account or tokenDeltaAbove')
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'expected an object')
  return value
}

function list<T>(
  value: unknown,
  path: string,
  min: number,
  max: number,
  read: (item: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) fail(path, 'expected an array')
  if (value.length < min || value.length > max) fail(path, `expected ${min} to ${max} entries`)
  return value.map((item, position) => read(item, `${path}.${position}`))
}

function text(value: unknown, path: string, min: number, max: number): string {
  if (typeof value !== 'string') fail(path, 'expected a string')
  if (value.length < min || value.length > max) fail(path, `expected ${min} to ${max} characters`)
  return value
}

function address(value: unknown, path: string): string {
  const written = text(value, path, 32, 88)
  if (!BASE58.test(written)) fail(path, 'expected base58 (no 0, O, I or l)')
  return written
}

function addresses(value: unknown, path: string): string[] {
  return list(value, path, 1, 20, address)
}

function milliseconds(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(path, 'expected whole ms')
  if (value < min || value > max) fail(path, `expected ${min} to ${max} ms`)
  return value
}

/** The first key of `raw` that reading left out of `read`, as a path. */
function droppedKey(raw: unknown, read: unknown, path: string): string | null {
  if (raw === null || typeof raw !== 'object' || read === null || typeof read !== 'object') {
    return null
  }
  for (const [key, item] of Object.entries(raw)) {
    const at = `${path}.${key}`
    if (!Object.hasOwn(read, key)) return at
    const found = droppedKey(item, (read as Record<string, unknown>)[key], at)
    if (found !== null) return found
  }
  return null
}

/** Keys sorted by UTF-16 code unit, no whitespace — the text the hash is taken over. */
function canonicalize(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`${value} has no canonical form`)
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value !== 'object') throw new Error(`a ${typeof value} has no canonical form`)

  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`
}
