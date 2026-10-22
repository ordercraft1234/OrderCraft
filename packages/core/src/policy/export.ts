import { z } from 'zod'
import { policyHashHex, presetId } from '../common/scalars.ts'
import { canonicalize, policyHash } from './compile.ts'
import { POLICY_SCHEMA_VERSION, type Policy, policySchema } from './schema.ts'

export const POLICY_FILE_FORMAT = 'ordercraft.policy'
export const POLICY_FILE_VERSION = 1

/**
 * Written into every file (FR-030). The file is the artifact a developer carries out of
 * the product, so the boundary has to travel with it rather than stay on a screen.
 */
export const POLICY_FILE_NOTICE =
  'This is not a Jito BAM config. It does not plug into production block ordering; the integrator supplies the implementation. OrderCraft only simulates what the policy would do to recorded slots.'

/**
 * The envelope, strict. The notice is read as any string: its wording belongs to the
 * version of the product that wrote the file, and a file is not wrong for carrying an
 * older sentence.
 */
const policyFileSchema = z
  .object({
    format: z.literal(POLICY_FILE_FORMAT),
    formatVersion: z.literal(POLICY_FILE_VERSION),
    hash: policyHashHex,
    notice: z.string(),
    // A record, not `z.unknown()`: unknown lets an absent key through.
    policy: z.record(z.unknown()),
    presetId: presetId.optional(),
  })
  .strict()

export type PolicyImportErrorCode =
  | 'not-json'
  | 'not-a-policy-file'
  | 'newer-version'
  | 'invalid-file'
  | 'invalid-policy'
  | 'not-canonical'
  | 'hash-mismatch'

export interface PolicyImportError {
  code: PolicyImportErrorCode
  message: string
}

export type PolicyImport =
  | { ok: true; policy: Policy; hash: string; presetId?: string }
  | { ok: false; error: PolicyImportError }

/**
 * The policy file a developer takes away (FR-018). Keys are sorted at every depth and
 * the text is indented, so the same policy always gives the same bytes and a diff of
 * two versions in someone's repository shows what changed.
 *
 * The hash is `policyHash` of the policy alone — the address a stored version and a
 * `#/p/<hash>` link already use. The origin travels beside it and stays outside, as
 * it does in the database.
 */
export function exportPolicy(policy: Policy, origin: { presetId?: string } = {}): string {
  const body = policySchema.parse(policy)
  const file = {
    format: POLICY_FILE_FORMAT,
    formatVersion: POLICY_FILE_VERSION,
    hash: policyHash(body),
    notice: POLICY_FILE_NOTICE,
    policy: body,
    ...(origin.presetId === undefined ? {} : { presetId: presetId.parse(origin.presetId) }),
  }

  // The canonical text has every key sorted; parsing it back keeps that order, since no
  // key in a policy file looks like an array index.
  return `${JSON.stringify(JSON.parse(canonicalize(file)), null, 2)}\n`
}

/**
 * Reads a policy file back. It accepts exactly what `exportPolicy` could have written,
 * up to formatting and key order: a key the schema would drop is refused rather than
 * lost, and a hash that does not match the content is refused rather than recomputed —
 * the hash is the claim the file is shown with, and a file that edits its policy has to
 * be exported again to make it.
 */
export function importPolicy(text: string): PolicyImport {
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
    return refuse(
      'newer-version',
      `the file was written by a newer OrderCraft (format version ${raw.formatVersion}; this one reads ${POLICY_FILE_VERSION})`,
    )
  }

  const file = policyFileSchema.safeParse(raw)
  if (!file.success) return refuse('invalid-file', `the file is malformed: ${describe(file.error)}`)

  const rawPolicy = file.data.policy
  if (isNewer(rawPolicy.schemaVersion, POLICY_SCHEMA_VERSION)) {
    return refuse(
      'newer-version',
      `the policy uses a newer schema (version ${rawPolicy.schemaVersion}; this one reads ${POLICY_SCHEMA_VERSION})`,
    )
  }

  const policy = policySchema.safeParse(rawPolicy)
  if (!policy.success)
    return refuse('invalid-policy', `the policy is invalid: ${describe(policy.error)}`)

  const dropped = droppedKey(rawPolicy, policy.data, 'policy')
  if (dropped !== null) {
    return refuse(
      'not-canonical',
      `the file has ${dropped}, which a policy does not carry; it would be lost on import`,
    )
  }

  const hash = policyHash(policy.data)
  if (hash !== file.data.hash) {
    return refuse(
      'hash-mismatch',
      `the policy hashes to ${hash}, but the file claims ${file.data.hash}; it was changed after export — import the original, edit it in the builder and export again`,
    )
  }

  return {
    ok: true,
    policy: policy.data,
    hash,
    ...(file.data.presetId === undefined ? {} : { presetId: file.data.presetId }),
  }
}

function refuse(code: PolicyImportErrorCode, message: string): PolicyImport {
  return { ok: false, error: { code, message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNewer(version: unknown, known: number): boolean {
  return typeof version === 'number' && Number.isInteger(version) && version > known
}

/** Objects and arrays alike: an array's indices are its keys. */
function isContainer(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function describe(error: z.ZodError): string {
  const [issue] = error.issues
  if (issue === undefined) return error.message
  return issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`
}

/**
 * The first key in `raw` that parsing left out of `parsed`, as a path. The policy schema
 * transforms nothing, so a dropped key is the only way the two can differ.
 */
function droppedKey(raw: unknown, parsed: unknown, path: string): string | null {
  if (!isContainer(raw) || !isContainer(parsed)) return null

  for (const [key, item] of Object.entries(raw)) {
    const at = `${path}.${key}`
    if (!(key in parsed)) return at
    const found = droppedKey(item, parsed[key], at)
    if (found !== null) return found
  }
  return null
}
