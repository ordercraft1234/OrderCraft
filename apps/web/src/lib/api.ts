import type { Policy } from '@ordercraft/core'
import {
  type CreatePolicyResponse,
  type ErrorCode,
  type PolicyVersionView,
  type Run,
  apiErrorSchema,
  createPolicyResponseSchema,
  policyVersionViewSchema,
  runSchema,
} from '@ordercraft/shared'

/**
 * The web app's one door to `apps/api`.
 *
 * Every answer is parsed back through the schemas the server answered in — the same
 * objects, from `@ordercraft/shared`, so a field that drifted on one side cannot be
 * read on the other. Nothing here formats a message for a screen: a failure carries the
 * server's own code and text, and the screens decide what that means in their context.
 *
 * The address is a build-time variable, and being unset is a supported state rather
 * than a misconfiguration: with no API the app computes runs in this tab on the slot
 * the repository ships, which is what a clean clone does (SC-009) and what the static
 * deployment does while the API is asleep.
 */

/** Everything that can go wrong, including the two the server never gets to answer. */
export type FailureCode = ErrorCode | 'UNREACHABLE' | 'MALFORMED'

/**
 * What this module needs of a schema, named structurally.
 *
 * `zod` is `@ordercraft/shared`'s dependency, not this package's — the app never builds
 * a schema, it only runs the ones the contract exports. Naming the shape here keeps the
 * two from drifting to different zod versions over a type import.
 */
interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false }
}

export class ApiFailure extends Error {
  readonly code: FailureCode

  constructor(code: FailureCode, message: string) {
    super(message)
    this.name = 'ApiFailure'
    this.code = code
  }
}

export interface ApiClient {
  /** The base address, for printing in a message about it. */
  readonly url: string
  /** Idempotent on the body's content: a hash already stored comes back `created: false`. */
  savePolicy(body: Policy): Promise<CreatePolicyResponse>
  readPolicyVersion(hash: string): Promise<PolicyVersionView>
  /** Idempotent on `(hash, slot)`: the second call returns the first run. */
  requestRun(hash: string, slot: number): Promise<Run>
}

/**
 * Trailing slashes off, blank means absent.
 *
 * An address ending in `/` would build `//api/policies`, which some proxies route and
 * others do not, so the difference is removed here rather than discovered in a
 * deployment.
 */
export function readApiUrl(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '')

  return trimmed === '' ? null : trimmed
}

/** The client, with its transport injected so the tests need no network and no DOM. */
export function createClient(url: string, send: typeof fetch = fetch): ApiClient {
  const call = async <T>(path: string, schema: Parser<T>, init?: RequestInit): Promise<T> => {
    let response: Response
    try {
      response = await send(`${url}/api${path}`, init)
    } catch (cause) {
      throw new ApiFailure('UNREACHABLE', `${url} did not answer: ${messageOf(cause)}`)
    }

    const payload: unknown = await readJson(response)
    if (!response.ok) throw failureOf(response, payload)

    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      throw new ApiFailure(
        'MALFORMED',
        `${url} answered ${path} in a shape this build does not understand`,
      )
    }

    return parsed.data
  }

  return {
    url,
    savePolicy: (body) =>
      call('/policies', createPolicyResponseSchema, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      }),
    readPolicyVersion: (hash) => call(`/policies/hash/${hash}`, policyVersionViewSchema),
    requestRun: (hash, slot) =>
      call('/runs', runSchema, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hash, slot }),
      }),
  }
}

/**
 * The client this build talks to, or `null` when it was built without an address.
 *
 * One `null` check is the whole difference between the two modes, and it is a constant:
 * the app cannot acquire an API halfway through a session, so no screen has to handle
 * that transition.
 */
export const api: ApiClient | null = apiFromEnv()

function apiFromEnv(): ApiClient | null {
  const url = readApiUrl(import.meta.env.VITE_API_URL)

  return url === null ? null : createClient(url)
}

/**
 * The server's own words when it sent them, and a plain sentence when it did not —
 * a proxy, a cold start or a CORS refusal can all produce a non-2xx with no envelope.
 */
function failureOf(response: Response, payload: unknown): ApiFailure {
  const envelope = apiErrorSchema.safeParse(payload)
  if (envelope.success) {
    return new ApiFailure(envelope.data.error.code, envelope.data.error.message)
  }

  return new ApiFailure('MALFORMED', `the API answered HTTP ${response.status} with no reason`)
}

/** A body that is not JSON is not a reason to throw here — `failureOf` handles it. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
