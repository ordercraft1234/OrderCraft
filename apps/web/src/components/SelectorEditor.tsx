import type { Selector } from '@ordercraft/core'
import type { DraftSelector, FieldError } from '../lib/policyDraft.ts'

/**
 * The class a step applies to, in the words the brief uses on screen.
 *
 * There is deliberately no "pools younger than a day": pool age is not derivable from
 * a slot, and the slot is all the evidence a run has. Someone who means that lists the
 * pool addresses and gets `account` — which also catches the victim trading against
 * the same pool, and the attack screen has to say so.
 */
const MATCH_LABELS: ReadonlyArray<{ match: Selector['match']; label: string }> = [
  { match: 'all', label: 'Whole block' },
  { match: 'tokenDeltaAbove', label: 'Swaps above an amount of one token' },
  { match: 'signer', label: 'Any transaction by listed signers' },
  { match: 'program', label: 'Any transaction touching listed programs' },
  { match: 'account', label: 'Any transaction touching listed accounts' },
]

const ADDRESS_MATCHES: ReadonlyArray<Selector['match']> = ['signer', 'program', 'account']

interface SelectorEditorProps {
  value: DraftSelector
  errors: FieldError[]
  onChange: (next: DraftSelector) => void
}

export function SelectorEditor({ value, errors, onChange }: SelectorEditorProps) {
  const invalid = errors.length > 0

  return (
    <div className="flex flex-col gap-2">
      <select
        value={value.match}
        onChange={(event) => onChange({ ...value, match: event.target.value as Selector['match'] })}
        className={fieldClass(invalid)}
      >
        {MATCH_LABELS.map((entry) => (
          <option key={entry.match} value={entry.match}>
            {entry.label}
          </option>
        ))}
      </select>

      {ADDRESS_MATCHES.includes(value.match) ? (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">One address per line, up to 20</span>
          <textarea
            rows={2}
            value={value.addresses}
            onChange={(event) => onChange({ ...value, addresses: event.target.value })}
            className={`${fieldClass(invalid)} resize-y`}
          />
        </label>
      ) : null}

      {value.match === 'tokenDeltaAbove' ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[11px] text-muted">Mint</span>
            <input
              value={value.mint}
              onChange={(event) => onChange({ ...value, mint: event.target.value })}
              className={fieldClass(invalid)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            {/* Base units, and said so on screen: a token amount written as a decimal
                would need the mint's decimals, which the slot does not carry. */}
            <span className="text-[11px] text-muted">Amount, base units</span>
            <input
              value={value.amount}
              onChange={(event) => onChange({ ...value, amount: event.target.value })}
              className={fieldClass(invalid)}
            />
          </label>
        </div>
      ) : null}

      {errors.map((error) => (
        <div key={error.message} className="text-[11px] text-extracted">
          {error.message}
        </div>
      ))}
    </div>
  )
}

/** A hairline under every field; cinnabar when the schema refused it. */
export function fieldClass(invalid: boolean): string {
  return `w-full bg-panel px-2 py-1 text-[12px] text-ink outline-none border-b ${
    invalid ? 'border-extracted' : 'border-hairline'
  }`
}
