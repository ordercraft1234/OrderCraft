import { POLICY_SCHEMA_VERSION, type Policy, policyHash } from '@ordercraft/core'
import { apiError } from '@ordercraft/shared'
import { describe, expect, it } from 'vitest'
import { ApiFailure, createClient, readApiUrl } from '../src/lib/api.ts'

const POLICY: Policy = {
  schemaVersion: POLICY_SCHEMA_VERSION,
  name: 'Anti-snipe launch',
  steps: [{ kind: 'speedBump', delayMs: 120, appliesTo: { match: 'all' } }],
}

interface Call {
  url: string
  init: RequestInit | undefined
}

/**
 * A transport that records what was asked and answers what the test says.
 *
 * The client is built around `fetch` rather than around a bespoke transport precisely
 * so that a stub of four lines is the whole test harness — no server, no DOM, no
 * network, and the assertions are about the request the API will actually receive.
 */
function stub(answer: (call: Call) => Response | Promise<Response> | never) {
  const calls: Call[] = []
  const send = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init }
    calls.push(call)

    return answer(call)
  }) as typeof fetch

  return { calls, send }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('readApiUrl', () => {
  it('reads an address as an address', () => {
    expect(readApiUrl('https://api.example.com')).toBe('https://api.example.com')
    expect(readApiUrl('  https://api.example.com  ')).toBe('https://api.example.com')
  })

  /** `${url}/api/runs` on an address ending in a slash is a path some proxies drop. */
  it('takes trailing slashes off', () => {
    expect(readApiUrl('https://api.example.com/')).toBe('https://api.example.com')
    expect(readApiUrl('https://api.example.com///')).toBe('https://api.example.com')
  })

  it('treats unset and blank as no API at all', () => {
    expect(readApiUrl(undefined)).toBeNull()
    expect(readApiUrl('')).toBeNull()
    expect(readApiUrl('   ')).toBeNull()
  })
})

describe('savePolicy', () => {
  it('posts the body under /api/policies and reads the address back', async () => {
    const hash = policyHash(POLICY)
    const { calls, send } = stub(() => json({ policyId: crypto.randomUUID(), hash, created: true }))

    const saved = await createClient('https://api.example.com', send).savePolicy(POLICY)

    expect(saved).toEqual({ policyId: expect.any(String), hash, created: true })
    expect(calls[0]?.url).toBe('https://api.example.com/api/policies')
    expect(calls[0]?.init?.method).toBe('POST')
    // The contract takes `{ body }` and no second name: the policy's name is inside
    // the body and inside the hash (T030).
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ body: POLICY })
  })
})

describe('requestRun', () => {
  it('sends the pair the run is addressed by', async () => {
    const { calls, send } = stub(() => json(apiError('NOT_FOUND', 'no such policy'), 404))

    await expect(
      createClient('https://api.example.com', send).requestRun('a'.repeat(64), 445553238),
    ).rejects.toThrow(ApiFailure)

    expect(calls[0]?.url).toBe('https://api.example.com/api/runs')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      hash: 'a'.repeat(64),
      slot: 445553238,
    })
  })
})

describe('when the API says no', () => {
  it('carries the server’s own code and words', async () => {
    const { send } = stub(() => json(apiError('RATE_LIMITED', 'ten a minute, and no more'), 429))

    const failure = await createClient('https://api.example.com', send)
      .readPolicyVersion('a'.repeat(64))
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiFailure)
    expect((failure as ApiFailure).code).toBe('RATE_LIMITED')
    expect((failure as ApiFailure).message).toBe('ten a minute, and no more')
  })

  /**
   * A cold start, a proxy or a CORS refusal all produce a non-2xx with no envelope in
   * it. The screens still have to say something, and "the API answered HTTP 502" is
   * true where a parse error about `error.code` would be about the wrong thing.
   */
  it('does not pretend a proxy page is an error envelope', async () => {
    const { send } = stub(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }))

    const failure = await createClient('https://api.example.com', send)
      .savePolicy(POLICY)
      .catch((error: unknown) => error)

    expect((failure as ApiFailure).code).toBe('MALFORMED')
    expect((failure as ApiFailure).message).toContain('502')
  })

  it('reports an address that did not answer at all', async () => {
    const { send } = stub(() => {
      throw new TypeError('Failed to fetch')
    })

    const failure = await createClient('https://api.example.com', send)
      .savePolicy(POLICY)
      .catch((error: unknown) => error)

    expect((failure as ApiFailure).code).toBe('UNREACHABLE')
    expect((failure as ApiFailure).message).toContain('https://api.example.com')
  })

  /**
   * A 200 in the wrong shape is the failure that would otherwise reach a screen as
   * `undefined` three components later. The contract is parsed on the way in for the
   * same reason the server parses on the way out.
   */
  it('refuses a success in a shape the contract does not describe', async () => {
    const { send } = stub(() => json({ policyId: 'not-a-uuid', hash: 'short', created: 'yes' }))

    const failure = await createClient('https://api.example.com', send)
      .savePolicy(POLICY)
      .catch((error: unknown) => error)

    expect((failure as ApiFailure).code).toBe('MALFORMED')
  })
})
