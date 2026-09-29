import {
  PRIMITIVES,
  type Policy,
  type StepChange,
  diffFromPreset,
  presetById,
} from '@ordercraft/core'
import { type ReactNode, useMemo } from 'react'
import type { DraftResult } from '../lib/policyDraft.ts'
import { fieldChangeLine } from '../lib/presetChoice.ts'

interface PresetDiffProps {
  /** The preset the policy started from, as the session holds it. */
  origin: string | null
  parsed: DraftResult
}

/**
 * Where the policy came from and how far it has moved (FR-015).
 *
 * The comparison is between two policies, not two drafts — `0120` and `120` are one
 * value — so it waits until the draft is a policy. An origin the library does not ship
 * is printed as the stored id rather than hidden: the version says it came from
 * somewhere, and this build simply has nothing to hold it against.
 */
export function PresetDiff({ origin, parsed }: PresetDiffProps) {
  const preset = origin === null ? undefined : presetById(origin)
  const policy = parsed.ok ? parsed.policy : null
  const diff = useMemo(
    () => (preset !== undefined && policy !== null ? diffFromPreset(policy, preset.policy) : null),
    [preset, policy],
  )

  if (origin === null) return null

  if (preset === undefined) {
    return (
      <Line>
        from preset {origin}, which this build does not ship — there is nothing to compare against
      </Line>
    )
  }

  if (diff === null || policy === null) {
    return (
      <Line>from preset {preset.name} · the differences show once the policy is valid again</Line>
    )
  }

  if (diff.identical) return <Line>from preset {preset.name} · unchanged</Line>

  return (
    <div className="flex flex-col gap-1 text-[12px]">
      <Line>
        from preset {preset.name} ·{' '}
        {diff.deviations === 0
          ? 'no parameter changed'
          : `${diff.deviations} ${diff.deviations === 1 ? 'deviation' : 'deviations'}`}
        {diff.renamed === null ? '' : ` · renamed from “${diff.renamed.preset}”`}
      </Line>
      {diff.deviations > 0 ? (
        <ul className="flex flex-col gap-0.5 pl-3 text-[12px]">
          {diff.steps.flatMap((step) => linesFor(step, policy, preset.policy))}
        </ul>
      ) : null}
    </div>
  )
}

function linesFor(step: StepChange, policy: Policy, preset: Policy) {
  switch (step.status) {
    case 'same':
      return []
    case 'changed':
      return step.fields.map((field) => (
        <li key={`${step.policyIndex}-${fieldChangeLine(field)}`}>
          step {step.policyIndex + 1} {labelOf(policy, step.policyIndex)}: {fieldChangeLine(field)}
        </li>
      ))
    case 'added':
      return [
        <li key={`added-${step.policyIndex}`}>
          step {step.policyIndex + 1} {labelOf(policy, step.policyIndex)}: not in the preset
        </li>,
      ]
    case 'removed':
      return [
        <li key={`removed-${step.presetIndex}`}>
          {labelOf(preset, step.presetIndex)} from the preset's step {step.presetIndex + 1}: removed
        </li>,
      ]
  }
}

function labelOf(policy: Policy, index: number): string {
  const kind = policy.steps[index]?.kind
  return PRIMITIVES.find((primitive) => primitive.kind === kind)?.label.toLowerCase() ?? 'step'
}

function Line({ children }: { children: ReactNode }) {
  return <div className="text-[12px] text-muted">{children}</div>
}
