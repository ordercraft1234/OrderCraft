import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { policyHash } from '../src/policy/compile.ts'
import {
  POLICY_FILE_FORMAT,
  POLICY_FILE_NOTICE,
  POLICY_FILE_VERSION,
  exportPolicy,
  importPolicy,
} from '../src/policy/export.ts'
import { POLICY_SCHEMA_VERSION, type Policy } from '../src/policy/schema.ts'
import type { PolicyStep, Selector } from '../src/policy/schema.ts'
import { POLICY_STUB_FILE_NAME, POLICY_STUB_SOURCE } from '../src/policy/stub-source.ts'
import * as stub from '../src/policy/stub.ts'
import { PRESETS } from '../src/presets/library.ts'
import { PROGRAMS, WSOL_MINT } from '../src/presets/programs.ts'
import { EDGES, SPEED_BUMP, generatedPolicies, reverseKeys } from './helpers/policies.ts'

const STUB_PATH = fileURLToPath(new URL('../src/policy/stub.ts', import.meta.url))

/**
 * The stub reads a file the way `importPolicy` does, or a developer who trusts it is
 * holding a different contract from the one the product enforces. Accepted files must
 * come back identical; refused ones with the same code — the wording is the stub's own.
 */
async function expectAgreement(text: string): Promise<void> {
  const expected = importPolicy(text)
  const actual = await stub.readPolicyFile(text)

  if (expected.ok) {
    expect(actual).toStrictEqual(expected)
  } else {
    expect(actual.ok ? 'accepted' : actual.error.code, text).toBe(expected.error.code)
    expect(actual.ok || actual.error.message.length > 0).toBe(true)
  }
}

function fileText(policy: Policy, presetId?: string): string {
  return exportPolicy(policy, presetId === undefined ? {} : { presetId })
}

/** A key set as an own property, `__proto__` included, as `JSON.parse` would set it. */
function withKey(target: Record<string, unknown>, key: string, value: unknown) {
  const copy = { ...target }
  Object.defineProperty(copy, key, { value, enumerable: true, writable: true, configurable: true })
  return copy
}

const REPLACEMENTS: unknown[] = [
  null,
  true,
  0,
  -1,
  1.5,
  2,
  49,
  50,
  400,
  401,
  1e21,
  '',
  'x',
  '0',
  '007',
  '120',
  '18446744073709551616',
  '-5',
  'all',
  'program',
  'deny',
  'prioritise',
  'speedBump',
  'Anti Snipe',
  'a'.repeat(81),
  'a'.repeat(65),
  '1'.repeat(31),
  WSOL_MINT,
  `${WSOL_MINT}0`,
  'f'.repeat(64),
  [],
  [WSOL_MINT],
  {},
  { match: 'all' },
]

const EXTRA_KEYS = ['note', 'toString', 'constructor', '__proto__']

/**
 * Every single-point damage to a file: each value replaced from a pool of near-misses,
 * each key removed, each object given a key the schema does not know. Where the damage
 * is inside the policy, the hash is offered both as written and recomputed to match, so
 * damage that the hash alone would catch is also seen without it.
 */
function damaged(file: Record<string, unknown>): string[] {
  const texts: string[] = []

  const visit = (value: unknown, rebuild: (next: unknown) => Record<string, unknown>) => {
    for (const replacement of REPLACEMENTS) texts.push(...variants(rebuild(replacement)))
    if (value === null || typeof value !== 'object') return

    if (Array.isArray(value)) {
      value.forEach((item, position) => {
        visit(item, (next) => rebuild(value.map((old, at) => (at === position ? next : old))))
        texts.push(...variants(rebuild(value.filter((_, at) => at !== position))))
      })
      texts.push(...variants(rebuild([...value, value[0]])))
      return
    }

    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      visit(record[key], (next) => rebuild(withKey(record, key, next)))
      const { [key]: _, ...rest } = record
      texts.push(...variants(rebuild(rest)))
    }
    for (const key of EXTRA_KEYS) texts.push(...variants(rebuild(withKey(record, key, 'x'))))
  }

  const variants = (next: Record<string, unknown>): string[] => {
    const written = JSON.stringify(next)
    try {
      return [written, JSON.stringify({ ...next, hash: policyHash(next.policy) })]
    } catch {
      return [written]
    }
  }

  visit(file, (next) => next as Record<string, unknown>)
  return texts
}

describe('policy stub (FR-019, FR-030)', () => {
  it('names the same format, versions and notice as the files it reads', () => {
    expect(stub.POLICY_FILE_FORMAT).toBe(POLICY_FILE_FORMAT)
    expect(stub.POLICY_FILE_VERSION).toBe(POLICY_FILE_VERSION)
    expect(stub.POLICY_SCHEMA_VERSION).toBe(POLICY_SCHEMA_VERSION)
    expect(stub.POLICY_FILE_NOTICE).toBe(POLICY_FILE_NOTICE)
  })

  it('declares the same policy types as the product', () => {
    expectTypeOf<stub.Policy>().toEqualTypeOf<Policy>()
    expectTypeOf<stub.PolicyStep>().toEqualTypeOf<PolicyStep>()
    expectTypeOf<stub.Selector>().toEqualTypeOf<Selector>()
  })

  it('says at the top that it is not a Jito BAM config and that the integrator implements it', () => {
    const header = POLICY_STUB_SOURCE.slice(0, POLICY_STUB_SOURCE.indexOf('*/'))
    expect(header).toMatch(/not a Jito BAM config/)
    expect(header).toMatch(/integrator/)
  })

  it('hashes a policy to the address the product gives it', async () => {
    for (const policy of [SPEED_BUMP, ...EDGES.map(([, edge]) => edge), ...generatedPolicies(50)]) {
      expect(await stub.policyHash(policy)).toBe(policyHash(policy))
    }
  })
})

describe('readPolicyFile agrees with importPolicy', () => {
  it.each(PRESETS.map((preset) => [preset.id, preset] as const))(
    'accepts preset %s with its origin',
    async (_, preset) => {
      await expectAgreement(fileText(preset.policy, preset.id))
    },
  )

  it.each(EDGES)('accepts %s', async (_, policy) => {
    const text = fileText(policy)
    await expectAgreement(text)
    expect(await stub.readPolicyFile(text)).toMatchObject({ ok: true, hash: policyHash(policy) })
  })

  it('accepts 200 generated policies', async () => {
    for (const policy of generatedPolicies(200)) {
      const text = fileText(policy)
      await expectAgreement(text)
      expect((await stub.readPolicyFile(text)).ok).toBe(true)
    }
  })

  it('accepts a file another tool reformatted or re-ordered', async () => {
    const text = fileText(SPEED_BUMP, 'anti-snipe-launch')
    const parsed = JSON.parse(text)
    for (const rewritten of [
      JSON.stringify(parsed),
      JSON.stringify(reverseKeys(parsed), null, 4),
      text.replaceAll('\n', '\r\n'),
    ]) {
      await expectAgreement(rewritten)
    }
  })

  it.each([
    ['not JSON', '{"format": '],
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"ordercraft.policy"'],
    ['a bare policy', JSON.stringify(SPEED_BUMP)],
    ['an empty object', '{}'],
  ])('refuses %s the same way', async (_, text) => {
    await expectAgreement(text)
  })

  it.each([
    ...EDGES,
    ...generatedPolicies(6).map((policy): [string, Policy] => [policy.name, policy]),
  ])(
    'refuses every single-point damage to %s the same way',
    async (_, policy) => {
      const texts = damaged(JSON.parse(fileText(policy, 'batched-swaps')))
      // Guards the sweep: an empty or tiny list would make the agreement vacuous.
      expect(texts.length).toBeGreaterThan(500)

      let refused = 0
      for (const text of texts) {
        await expectAgreement(text)
        if (!importPolicy(text).ok) refused += 1
      }
      // Both verdicts occur: some damage is a different valid policy under a recomputed hash.
      expect(refused).toBeGreaterThan(0)
      expect(refused).toBeLessThan(texts.length)
      // Thousands of files per case: a sweep, not a budget, so a loaded machine must not fail it.
    },
    30_000,
  )
})

describe('the ordering contract', () => {
  const block: stub.Block = {
    slot: 445_553_238,
    transactions: ['sigA', 'sigB', 'sigC'].map((signature, index) => ({
      index,
      signature,
      arrivalMs: index * 100,
      signers: [PROGRAMS.humidiFi],
      programs: [PROGRAMS.pumpFun],
      accounts: [WSOL_MINT],
      tokenDelta: [{ owner: PROGRAMS.humidiFi, mint: WSOL_MINT, amount: -5n }],
    })),
  }

  it('leaves the ordering itself to the integrator', () => {
    expect(() => stub.orderBlock(SPEED_BUMP, block)).toThrow(/integrator/)
  })

  it('accepts an ordering that places every transaction exactly once', () => {
    expect(
      stub.checkOrdering(block, { included: ['sigC', 'sigA'], deferred: ['sigB'], dropped: [] }),
    ).toStrictEqual({ ok: true })
  })

  it.each([
    ['one is missing', { included: ['sigA'], deferred: ['sigB'], dropped: [] }, /sigC/],
    [
      'one appears twice',
      { included: ['sigA', 'sigB'], deferred: ['sigB', 'sigC'], dropped: [] },
      /sigB/,
    ],
    [
      'one is not in the block',
      { included: ['sigA', 'sigB', 'sigC', 'sigD'], deferred: [], dropped: [] },
      /sigD/,
    ],
  ])('refuses an ordering where %s', (_, ordering, named) => {
    const result = stub.checkOrdering(block, ordering)
    expect(result.ok).toBe(false)
    expect(result.ok || result.problem).toMatch(named)
  })
})

describe('the stub as a file a developer takes away', () => {
  it(`is shipped as ${POLICY_STUB_FILE_NAME}, byte for byte the checked source`, () => {
    expect(POLICY_STUB_FILE_NAME).toBe('ordercraft-policy.v1.ts')
    expect(POLICY_STUB_SOURCE).toBe(readFileSync(STUB_PATH, 'utf8'))
    expect(POLICY_STUB_SOURCE).not.toContain('\r')
  })

  it('imports nothing, so it can be copied into any repository', () => {
    expect(POLICY_STUB_SOURCE).not.toMatch(/^\s*import\s/m)
    expect(POLICY_STUB_SOURCE).not.toMatch(/\brequire\(/)
  })

  it('type-checks alone under strict settings, with no Node or DOM types', () => {
    const program = ts.createProgram([STUB_PATH], {
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      erasableSyntaxOnly: true,
      isolatedModules: true,
      verbatimModuleSyntax: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      lib: ['lib.es2022.d.ts'],
      types: [],
      noEmit: true,
    })
    const problems = ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    expect(problems).toStrictEqual([])
  })

  it('runs in plain Node once its types are stripped, and reads a real file', async () => {
    const javascript = stripTypeScriptTypes(POLICY_STUB_SOURCE)
    const url = `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
    const loaded = (await import(/* @vite-ignore */ url)) as typeof stub

    const [preset] = PRESETS
    if (preset === undefined) throw new Error('the library ships no preset')
    const result = await loaded.readPolicyFile(fileText(preset.policy, preset.id))

    expect(result).toStrictEqual(importPolicy(fileText(preset.policy, preset.id)))
  })
})
