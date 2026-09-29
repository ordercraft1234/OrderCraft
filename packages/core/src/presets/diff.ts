import { canonicalize } from '../policy/compile.ts'
import type { Policy, PolicyStep, Selector } from '../policy/schema.ts'

type Rule = Extract<PolicyStep, { kind: 'allowDeny' }>['rules'][number]

/** One parameter of a paired step that differs, with the value on each side. */
export type FieldChange =
  | { field: 'delayMs' | 'windowMs'; preset: number; policy: number }
  | { field: 'appliesTo'; preset: Selector; policy: Selector }
  /** A rule by position; `null` on the side that has no rule there. */
  | { field: 'rule'; rule: number; preset: Rule | null; policy: Rule | null }

export type StepChange =
  | { status: 'same'; policyIndex: number; presetIndex: number }
  | { status: 'changed'; policyIndex: number; presetIndex: number; fields: FieldChange[] }
  | { status: 'added'; policyIndex: number }
  | { status: 'removed'; presetIndex: number }

export interface PresetDiff {
  /** Same content, so the same hash: nothing to report. */
  identical: boolean
  /** The name is part of the hash but orders nothing, so it is reported on its own. */
  renamed: { preset: string; policy: string } | null
  /** Both step lists merged in order, each step with what became of it. */
  steps: StepChange[]
  /** Changed parameters plus added and removed steps. A rename does not count. */
  deviations: number
}

/** A paired step outweighs any number of identical ones: pairs first, then sameness. */
const PAIRED = 1000
const IDENTICAL = 1

/**
 * How a policy differs from the preset it started from (FR-015).
 *
 * Steps are aligned, not compared by position: the longest run of same-kind steps that
 * keeps both orders, and among equally long runs the one with most steps left untouched.
 * A step put in front is then one addition rather than a change to everything after it,
 * and two swapped steps show as a change of order — which they are, since steps run one
 * after another. Ties are broken the same way every time, so the answer is a function
 * of the two policies alone.
 */
export function diffFromPreset(policy: Policy, preset: Policy): PresetDiff {
  const theirs = preset.steps
  const ours = policy.steps
  const best = scoreTable(theirs, ours)

  const steps: StepChange[] = []
  let i = 0
  let j = 0

  while (i < theirs.length || j < ours.length) {
    const change = nextChange(theirs, ours, best, i, j)
    steps.push(change)
    if (change.status !== 'added') i += 1
    if (change.status !== 'removed') j += 1
  }

  return {
    identical: canonicalize(policy) === canonicalize(preset),
    renamed: policy.name === preset.name ? null : { preset: preset.name, policy: policy.name },
    steps,
    deviations: steps.reduce((total, step) => total + weightOf(step), 0),
  }
}

function weightOf(step: StepChange): number {
  if (step.status === 'changed') return step.fields.length
  return step.status === 'same' ? 0 : 1
}

/**
 * The step at `(i, j)` on a best path: a pair when pairing is optimal, else dropping the
 * preset's step when that is, else the policy's step as an addition. Checking in that
 * order is the tie-break.
 */
function nextChange(
  theirs: readonly PolicyStep[],
  ours: readonly PolicyStep[],
  best: number[][],
  i: number,
  j: number,
): StepChange {
  const presetStep = theirs[i]
  const policyStep = ours[j]
  const here = score(best, i, j)

  if (presetStep !== undefined && policyStep !== undefined) {
    const pair = pairScore(presetStep, policyStep)
    if (pair > 0 && pair + score(best, i + 1, j + 1) === here) {
      const fields = fieldChanges(presetStep, policyStep)
      return fields.length === 0
        ? { status: 'same', policyIndex: j, presetIndex: i }
        : { status: 'changed', policyIndex: j, presetIndex: i, fields }
    }
  }

  if (presetStep !== undefined && score(best, i + 1, j) === here) {
    return { status: 'removed', presetIndex: i }
  }
  return { status: 'added', policyIndex: j }
}

function score(best: number[][], i: number, j: number): number {
  return best[i]?.[j] ?? 0
}

/** `best[i][j]`: the highest score aligning `theirs` from `i` with `ours` from `j`. */
function scoreTable(theirs: readonly PolicyStep[], ours: readonly PolicyStep[]): number[][] {
  const best = Array.from({ length: theirs.length + 1 }, () =>
    new Array<number>(ours.length + 1).fill(0),
  )

  for (let i = theirs.length - 1; i >= 0; i -= 1) {
    const row = best[i] as number[]
    for (let j = ours.length - 1; j >= 0; j -= 1) {
      const pair = pairScore(theirs[i] as PolicyStep, ours[j] as PolicyStep)
      const candidates = [score(best, i + 1, j), score(best, i, j + 1)]
      if (pair > 0) candidates.push(pair + score(best, i + 1, j + 1))
      row[j] = candidates.reduce((top, value) => (value > top ? value : top), 0)
    }
  }

  return best
}

function pairScore(presetStep: PolicyStep, policyStep: PolicyStep): number {
  if (presetStep.kind !== policyStep.kind) return 0
  return canonicalize(presetStep) === canonicalize(policyStep) ? PAIRED + IDENTICAL : PAIRED
}

function fieldChanges(presetStep: PolicyStep, policyStep: PolicyStep): FieldChange[] {
  if (presetStep.kind === 'allowDeny' && policyStep.kind === 'allowDeny') {
    return ruleChanges(presetStep.rules, policyStep.rules)
  }

  const changes: FieldChange[] = []
  if (presetStep.kind === 'speedBump' && policyStep.kind === 'speedBump') {
    if (presetStep.delayMs !== policyStep.delayMs) {
      changes.push({ field: 'delayMs', preset: presetStep.delayMs, policy: policyStep.delayMs })
    }
    pushSelector(changes, presetStep.appliesTo, policyStep.appliesTo)
  }
  if (presetStep.kind === 'batchAuction' && policyStep.kind === 'batchAuction') {
    if (presetStep.windowMs !== policyStep.windowMs) {
      changes.push({ field: 'windowMs', preset: presetStep.windowMs, policy: policyStep.windowMs })
    }
    pushSelector(changes, presetStep.appliesTo, policyStep.appliesTo)
  }
  return changes
}

/** Rules by position; the side that runs out first shows `null`. */
function ruleChanges(preset: readonly Rule[], policy: readonly Rule[]): FieldChange[] {
  const count = preset.length > policy.length ? preset.length : policy.length
  const changes: FieldChange[] = []

  for (let rule = 0; rule < count; rule += 1) {
    const before = preset[rule] ?? null
    const after = policy[rule] ?? null
    const same = before !== null && after !== null && canonicalize(before) === canonicalize(after)
    if (!same) changes.push({ field: 'rule', rule, preset: before, policy: after })
  }

  return changes
}

/** A class is reported whole: half of a selector means nothing on its own. */
function pushSelector(changes: FieldChange[], preset: Selector, policy: Selector): void {
  if (canonicalize(preset) !== canonicalize(policy)) {
    changes.push({ field: 'appliesTo', preset, policy })
  }
}
