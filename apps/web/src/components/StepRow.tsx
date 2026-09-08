import { PRIMITIVES } from '@ordercraft/core'
import {
  type DraftRule,
  type DraftStep,
  type FieldError,
  emptySelector,
  errorsFor,
} from '../lib/policyDraft.ts'
import { SelectorEditor, fieldClass } from './SelectorEditor.tsx'

const MAX_RULES = 20

interface StepRowProps {
  index: number
  step: DraftStep
  count: number
  errors: FieldError[]
  onChange: (step: DraftStep) => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
}

/** One step of the policy: its number, its parameter, and the class it applies to. */
export function StepRow({ index, step, count, errors, onChange, onMove, onRemove }: StepRowProps) {
  const primitive = PRIMITIVES.find((entry) => entry.kind === step.kind)
  if (primitive === undefined) throw new Error(`no primitive named ${step.kind}`)

  return (
    <div className="flex flex-col gap-3 border-b border-hairline py-4">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="text-[12px] text-muted">{index + 1}</span>
          <span className="text-[13px]">{primitive.label}</span>
        </div>
        <div className="flex gap-3 text-[11px] text-muted">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className={buttonClass}
          >
            up
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            className={buttonClass}
          >
            down
          </button>
          <button type="button" onClick={onRemove} className={buttonClass}>
            remove
          </button>
        </div>
      </div>

      <div className="text-[12px] text-muted">{primitive.description}</div>

      {step.kind === 'allowDeny' ? (
        <RuleList step={step} index={index} errors={errors} onChange={onChange} />
      ) : (
        <ParameterAndClass step={step} index={index} errors={errors} onChange={onChange} />
      )}
    </div>
  )
}

interface PartProps {
  step: DraftStep
  index: number
  errors: FieldError[]
  onChange: (step: DraftStep) => void
}

function ParameterAndClass({ step, index, errors, onChange }: PartProps) {
  if (step.kind === 'allowDeny') return null

  const field = step.kind === 'speedBump' ? 'delayMs' : 'windowMs'
  const value = step.kind === 'speedBump' ? step.delayMs : step.windowMs
  const primitive = PRIMITIVES.find((entry) => entry.kind === step.kind)
  const range = primitive?.parameter
  const fieldErrors = errorsFor(errors, `steps.${index}.${field}`)

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:gap-8">
      <label className="flex w-full flex-col gap-1 sm:w-48">
        <span className="text-[11px] text-muted">
          {/* The allowed range is printed whether or not the field is in error: the
              brief asks for it beside the input, not only after a mistake. */}
          {field} · {range?.min}–{range?.max} {range?.unit}
        </span>
        <input
          inputMode="numeric"
          value={value}
          onChange={(event) =>
            onChange(
              step.kind === 'speedBump'
                ? { ...step, delayMs: event.target.value }
                : { ...step, windowMs: event.target.value },
            )
          }
          className={fieldClass(fieldErrors.length > 0)}
        />
        {fieldErrors.map((error) => (
          <span key={error.message} className="text-[11px] text-extracted">
            {error.message}
          </span>
        ))}
      </label>

      <div className="flex flex-1 flex-col gap-1">
        <span className="text-[11px] text-muted">Applies to</span>
        <SelectorEditor
          value={step.appliesTo}
          errors={errorsFor(errors, `steps.${index}.appliesTo`)}
          onChange={(appliesTo) => onChange({ ...step, appliesTo })}
        />
      </div>
    </div>
  )
}

function RuleList({ step, index, errors, onChange }: PartProps) {
  if (step.kind !== 'allowDeny') return null

  const setRule = (position: number, rule: DraftRule) =>
    onChange({
      ...step,
      rules: step.rules.map((current, at) => (at === position ? rule : current)),
    })

  return (
    <div className="flex flex-col gap-3">
      {step.rules.map((rule, position) => (
        <div
          // Rules have no identity of their own, and two rules can hold the same
          // selector while being typed, so position is the only honest key here.
          // biome-ignore lint/suspicious/noArrayIndexKey: rules are positional
          key={position}
          className="flex flex-col gap-2 border-l border-hairline pl-3 sm:flex-row sm:gap-4"
        >
          <select
            value={rule.effect}
            onChange={(event) =>
              setRule(position, { ...rule, effect: event.target.value as DraftRule['effect'] })
            }
            className={`${fieldClass(false)} self-start sm:w-40`}
          >
            <option value="deny">deny</option>
            <option value="prioritise">prioritise</option>
          </select>
          <div className="flex-1">
            <SelectorEditor
              value={rule.match}
              errors={errorsFor(errors, `steps.${index}.rules.${position}`)}
              onChange={(match) => setRule(position, { ...rule, match })}
            />
          </div>
          <button
            type="button"
            className={`${buttonClass} self-start text-[11px] text-muted`}
            onClick={() =>
              onChange({ ...step, rules: step.rules.filter((_, at) => at !== position) })
            }
            disabled={step.rules.length === 1}
          >
            remove
          </button>
        </div>
      ))}

      {errorsFor(errors, `steps.${index}.rules`).map((error) => (
        <div key={error.message} className="text-[11px] text-extracted">
          {error.message}
        </div>
      ))}

      <button
        type="button"
        className={`${buttonClass} self-start text-[11px] text-muted`}
        disabled={step.rules.length >= MAX_RULES}
        onClick={() =>
          onChange({
            ...step,
            rules: [...step.rules, { effect: 'deny', match: emptySelector('signer') }],
          })
        }
      >
        add rule
      </button>
    </div>
  )
}

const buttonClass =
  'underline underline-offset-4 hover:text-ink disabled:no-underline disabled:opacity-40'
