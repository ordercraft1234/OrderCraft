import { describe, expect, it } from 'vitest'
import { canonicalize, policyHash } from '../src/policy/compile.ts'
import {
  POLICY_FILE_FORMAT,
  POLICY_FILE_NOTICE,
  exportPolicy,
  importPolicy,
} from '../src/policy/export.ts'
import type { Policy } from '../src/policy/schema.ts'
import { PRESETS } from '../src/presets/library.ts'
import { EDGES, SPEED_BUMP, generatedPolicies, reverseKeys } from './helpers/policies.ts'

function fileOf(policy: Policy, presetId?: string): Record<string, unknown> {
  return JSON.parse(exportPolicy(policy, presetId === undefined ? {} : { presetId }))
}

function importObject(file: unknown) {
  return importPolicy(JSON.stringify(file))
}

function errorOf(result: ReturnType<typeof importPolicy>) {
  if (result.ok) throw new Error('expected the import to be refused')
  return result.error
}

describe('exportPolicy (FR-018)', () => {
  it('writes the schema version, the steps with their parameters, and the content hash', () => {
    const file = fileOf(SPEED_BUMP)

    expect(file.format).toBe(POLICY_FILE_FORMAT)
    expect(file.formatVersion).toBe(1)
    expect(file.policy).toStrictEqual(SPEED_BUMP)
    expect(file.hash).toBe(policyHash(SPEED_BUMP))
  })

  it('carries the notice that this is not a Jito BAM config (FR-030)', () => {
    expect(fileOf(SPEED_BUMP).notice).toBe(POLICY_FILE_NOTICE)
    expect(POLICY_FILE_NOTICE).toMatch(/not a Jito BAM config/)
    expect(POLICY_FILE_NOTICE).toMatch(/integrator/)
  })

  it('writes this exact text, so a change to the format is a decision and not a side effect', () => {
    expect(exportPolicy(SPEED_BUMP, { presetId: 'anti-snipe-launch' })).toBe(
      `{
  "format": "ordercraft.policy",
  "formatVersion": 1,
  "hash": "${policyHash(SPEED_BUMP)}",
  "notice": ${JSON.stringify(POLICY_FILE_NOTICE)},
  "policy": {
    "name": "One speed bump",
    "schemaVersion": 1,
    "steps": [
      {
        "appliesTo": {
          "match": "all"
        },
        "delayMs": 120,
        "kind": "speedBump"
      }
    ]
  },
  "presetId": "anti-snipe-launch"
}
`,
    )
  })

  it('is byte-identical across calls and across the key order of its input', () => {
    for (const [, policy] of EDGES) {
      const first = exportPolicy(policy)
      expect(exportPolicy(policy)).toBe(first)
      expect(exportPolicy(reverseKeys(policy) as Policy)).toBe(first)
    }
  })

  it('leaves the origin out entirely when the policy has none', () => {
    expect(Object.keys(fileOf(SPEED_BUMP))).not.toContain('presetId')
  })

  it('keeps the origin out of the hash, as a stored version does', () => {
    expect(fileOf(SPEED_BUMP, 'batched-swaps').hash).toBe(fileOf(SPEED_BUMP).hash)
  })

  it('refuses a policy the schema refuses, rather than writing a file nobody can import', () => {
    const outOfRange = { ...SPEED_BUMP, steps: [{ ...SPEED_BUMP.steps[0], delayMs: 401 }] }
    expect(() => exportPolicy(outOfRange as Policy)).toThrow(/no more than 400 ms/)
  })

  it('refuses an origin that is not a preset id', () => {
    expect(() => exportPolicy(SPEED_BUMP, { presetId: 'Anti Snipe' })).toThrow(/preset id/)
  })
})

describe('importPolicy round-trip (SC-008)', () => {
  const cases: Array<[string, Policy, string | undefined]> = [
    ...PRESETS.map((preset): [string, Policy, string] => [preset.id, preset.policy, preset.id]),
    ...EDGES.map(([label, policy]): [string, Policy, undefined] => [label, policy, undefined]),
  ]

  it.each(cases)('%s comes back one-to-one with the same hash', (_, policy, presetId) => {
    const result = importPolicy(exportPolicy(policy, presetId === undefined ? {} : { presetId }))

    expect(result).toStrictEqual({
      ok: true,
      policy,
      hash: policyHash(policy),
      ...(presetId === undefined ? {} : { presetId }),
    })
  })

  it('reads a file another tool reformatted or re-ordered', () => {
    const [preset] = PRESETS
    if (preset === undefined) throw new Error('the library ships no preset')
    const text = exportPolicy(preset.policy, { presetId: preset.id })
    const parsed = JSON.parse(text)

    for (const rewritten of [
      JSON.stringify(parsed),
      JSON.stringify(reverseKeys(parsed), null, 4),
      text.replaceAll('\n', '\r\n'),
    ]) {
      const result = importPolicy(rewritten)
      expect(result.ok && result.hash).toBe(policyHash(preset.policy))
    }
  })

  it('round-trips a deterministic sweep of generated policies', () => {
    for (const policy of generatedPolicies(200)) {
      const result = importPolicy(exportPolicy(policy))
      expect(result.ok && result.hash).toBe(policyHash(policy))
      expect(result.ok && canonicalize(result.policy)).toBe(canonicalize(policy))
    }
  })
})

describe('importPolicy refusals', () => {
  it('refuses text that is not JSON', () => {
    expect(errorOf(importPolicy('{"format": '))).toMatchObject({ code: 'not-json' })
  })

  it.each([['[]'], ['null'], ['"ordercraft.policy"'], ['{"name":"x","steps":[]}']])(
    'refuses %s as not a policy file',
    (text) => {
      expect(errorOf(importPolicy(text))).toMatchObject({ code: 'not-a-policy-file' })
    },
  )

  it('refuses a file from a newer format version, and says so', () => {
    const error = errorOf(importObject({ ...fileOf(SPEED_BUMP), formatVersion: 2 }))
    expect(error).toMatchObject({ code: 'newer-version' })
    expect(error.message).toMatch(/newer/)
  })

  it('refuses a policy from a newer schema version, and says so', () => {
    const file = fileOf(SPEED_BUMP)
    const error = errorOf(importObject({ ...file, policy: { ...SPEED_BUMP, schemaVersion: 2 } }))
    expect(error).toMatchObject({ code: 'newer-version' })
  })

  it('refuses an envelope with a key export never writes', () => {
    expect(errorOf(importObject({ ...fileOf(SPEED_BUMP), comment: 'mine' }))).toMatchObject({
      code: 'invalid-file',
    })
  })

  it.each(['hash', 'notice', 'policy'])('refuses a file without %s', (key) => {
    const file = Object.fromEntries(Object.entries(fileOf(SPEED_BUMP)).filter(([k]) => k !== key))
    expect(errorOf(importObject(file))).toMatchObject({ code: 'invalid-file' })
  })

  it('refuses a hash that is not lower-case hex', () => {
    const file = fileOf(SPEED_BUMP)
    const error = errorOf(importObject({ ...file, hash: String(file.hash).toUpperCase() }))
    expect(error).toMatchObject({ code: 'invalid-file' })
  })

  it('refuses a policy the schema refuses, naming the field', () => {
    const file = fileOf(SPEED_BUMP)
    const steps = [{ ...SPEED_BUMP.steps[0], delayMs: 999 }]
    const error = errorOf(importObject({ ...file, policy: { ...SPEED_BUMP, steps } }))

    expect(error).toMatchObject({ code: 'invalid-policy' })
    expect(error.message).toMatch(/steps\.0\.delayMs/)
    expect(error.message).toMatch(/no more than 400 ms/)
  })

  it('refuses a parameter edited by hand, naming both hashes', () => {
    const file = fileOf(SPEED_BUMP)
    const edited = { ...SPEED_BUMP, steps: [{ ...SPEED_BUMP.steps[0], delayMs: 200 }] }
    const error = errorOf(importObject({ ...file, policy: edited }))

    expect(error).toMatchObject({ code: 'hash-mismatch' })
    expect(error.message).toContain(String(file.hash))
    expect(error.message).toContain(policyHash(edited))
  })

  it('refuses a key the schema would drop, even when the hash was recomputed to cover it', () => {
    const withNote = {
      ...SPEED_BUMP,
      steps: [{ ...SPEED_BUMP.steps[0], note: 'tuned by hand' }],
    }
    const file = { ...fileOf(SPEED_BUMP), policy: withNote, hash: policyHash(withNote) }
    const error = errorOf(importObject(file))

    expect(error).toMatchObject({ code: 'not-canonical' })
    expect(error.message).toMatch(/note/)
  })

  it.each(['toString', 'constructor', '__proto__'])(
    'refuses a dropped key named %s, which every parsed object already inherits',
    (key) => {
      // Built from text: an object literal would set the prototype instead of a key.
      const policy = JSON.parse(
        JSON.stringify(SPEED_BUMP).replace('"delayMs"', `"${key}":"x","delayMs"`),
      )
      // The hash as exported, and the hash recomputed to cover the key: in the first the
      // key would vanish silently, since the rest of the policy still matches.
      for (const hash of [policyHash(SPEED_BUMP), policyHash(policy)]) {
        const error = errorOf(importObject({ ...fileOf(SPEED_BUMP), policy, hash }))

        expect(error).toMatchObject({ code: 'not-canonical' })
        expect(error.message).toContain(`policy.steps.0.${key}`)
      }
    },
  )

  it('refuses __proto__ at the top of the policy, and never reads a field through it', () => {
    const { name, ...nameless } = SPEED_BUMP
    const cases: Array<[string, string]> = [
      [JSON.stringify(SPEED_BUMP).replace('{', '{"__proto__":"x",'), 'not-canonical'],
      [
        JSON.stringify(nameless).replace('{', `{"__proto__":{"name":${JSON.stringify(name)}},`),
        'invalid-policy',
      ],
    ]
    for (const [text, code] of cases) {
      const policy = JSON.parse(text)
      expect(errorOf(importObject({ ...fileOf(SPEED_BUMP), policy })).code).toBe(code)
    }
  })

  it('refuses a dropped key whose value has no canonical form, instead of throwing', () => {
    const withFraction = { ...SPEED_BUMP, extra: 0.5 }
    const error = errorOf(importObject({ ...fileOf(SPEED_BUMP), policy: withFraction }))
    expect(error).toMatchObject({ code: 'not-canonical' })
  })

  it('refuses an origin that is not a preset id', () => {
    const error = errorOf(importObject({ ...fileOf(SPEED_BUMP), presetId: 'Anti Snipe' }))
    expect(error).toMatchObject({ code: 'invalid-file' })
  })

  it('keeps an origin the library does not ship, as reading a stored version does', () => {
    const result = importObject({ ...fileOf(SPEED_BUMP), presetId: 'retired-preset' })
    expect(result.ok && result.presetId).toBe('retired-preset')
  })
})
