import { PRESETS, type Policy, exportPolicy, importPolicy, policyHash } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { demoDraft } from '../src/lib/demoPolicy.ts'
import { policyToDraft, toPolicy } from '../src/lib/policyDraft.ts'
import { MAX_POLICY_FILE_BYTES, fileNameFor, readPolicyFile } from '../src/lib/policyFile.ts'

/**
 * US5's independent test, short of the click: export what the builder holds, import the
 * file, and the builder that comes back is the one that left — same draft, same hash.
 */
function builderPolicies(): Array<[string, Policy, string | null]> {
  const demo = toPolicy(demoDraft())
  if (!demo.ok) throw new Error('the demo draft is not a policy')

  return [
    ['the demo policy', demo.policy, null],
    ...PRESETS.map((preset): [string, Policy, string] => [preset.name, preset.policy, preset.id]),
  ]
}

function fileOf(text: string) {
  return { size: new TextEncoder().encode(text).length, text: async () => text }
}

describe('the builder through a policy file (US5)', () => {
  it.each(builderPolicies())('%s comes back as the same draft and hash', (_, policy, origin) => {
    const text = exportPolicy(policy, origin === null ? {} : { presetId: origin })
    const result = importPolicy(text)
    if (!result.ok) throw new Error(result.error.message)

    expect(policyToDraft(result.policy)).toStrictEqual(policyToDraft(policy))
    const back = toPolicy(policyToDraft(result.policy))
    expect(back.ok && policyHash(back.policy)).toBe(policyHash(policy))
    expect(result.presetId ?? null).toBe(origin)
  })
})

describe('readPolicyFile', () => {
  it('reads what export wrote', async () => {
    const [preset] = PRESETS
    if (preset === undefined) throw new Error('the library ships no preset')

    const result = await readPolicyFile(
      fileOf(exportPolicy(preset.policy, { presetId: preset.id })),
    )
    expect(result.ok && result.hash).toBe(policyHash(preset.policy))
  })

  it('refuses a file too large to be a policy without reading it', async () => {
    let read = false
    const result = await readPolicyFile({
      size: MAX_POLICY_FILE_BYTES + 1,
      text: async () => {
        read = true
        return '{}'
      },
    })

    expect(read).toBe(false)
    expect(result.ok ? null : result.error.code).toBe('not-a-policy-file')
  })

  it('passes the import refusal through in words', async () => {
    const result = await readPolicyFile(fileOf('not json'))
    expect(result.ok ? null : result.error.message).toMatch(/not JSON/)
  })
})

describe('fileNameFor', () => {
  it.each([
    ['Anti-snipe launch', 'anti-snipe-launch.ordercraft.json'],
    [
      'Demo: large wSOL swaps, slot 445553238',
      'demo-large-wsol-swaps-slot-445553238.ordercraft.json',
    ],
    ['  --Ціна «до»--  ', 'policy.ordercraft.json'],
    ['Maker   quotes__first', 'maker-quotes-first.ordercraft.json'],
  ])('names %j as %s', (name, expected) => {
    expect(fileNameFor(name)).toBe(expected)
  })

  it('keeps a long name to a length every file system takes', () => {
    expect(fileNameFor('a'.repeat(80))).toBe(`${'a'.repeat(60)}.ordercraft.json`)
  })
})
