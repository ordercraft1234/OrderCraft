import { POLICY_SCHEMA_VERSION, type Policy, type Selector, policySchema } from '@ordercraft/core'

/**
 * What the builder holds while a person is typing, and why it is not a `Policy`.
 *
 * A `Policy` cannot represent `delayMs: '12a'` or a half-typed address, but those are
 * exactly the states an editor lives in. So the draft keeps every field as the text it
 * was typed as, and `toPolicy` is the single place where text becomes a policy or a
 * list of complaints. Nothing downstream ever sees a half-parsed policy.
 */
export interface PolicyDraft {
  name: string
  steps: DraftStep[]
}

export type DraftStep =
  | { kind: 'speedBump'; delayMs: string; appliesTo: DraftSelector }
  | { kind: 'batchAuction'; windowMs: string; appliesTo: DraftSelector }
  | { kind: 'allowDeny'; rules: DraftRule[] }

export interface DraftRule {
  effect: 'prioritise' | 'deny'
  match: DraftSelector
}

/**
 * Every branch's fields at once, rather than a union.
 *
 * Switching a selector from `program` to `signer` and back would otherwise throw away
 * what was typed. Only the fields the current `match` needs are read.
 */
export interface DraftSelector {
  match: Selector['match']
  /** One address per line, for `program`, `signer` and `account`. */
  addresses: string
  mint: string
  amount: string
}

/**
 * The shape of one schema complaint, matched structurally rather than imported.
 *
 * `zod` is `packages/core`'s dependency, not this package's — the app never calls it
 * directly, it only reads what the policy schema reports. Naming the shape here keeps
 * the two from drifting to different zod versions over a type alias.
 */
interface SchemaIssue {
  path: ReadonlyArray<string | number>
  message: string
}

export interface FieldError {
  /** `name`, `steps`, `steps.0.delayMs`, `steps.0.appliesTo`, `steps.0.rules.1` … */
  field: string
  message: string
}

export type DraftResult = { ok: true; policy: Policy } | { ok: false; errors: FieldError[] }

export function emptySelector(match: Selector['match'] = 'all'): DraftSelector {
  return { match, addresses: '', mint: '', amount: '' }
}

/**
 * A new policy is one speed bump on the whole block: valid, runnable, and inventing
 * nothing. Starting empty would open the screen on an error message, and starting on
 * the demo policy would put addresses on screen that nobody chose.
 */
export function newDraft(): PolicyDraft {
  return {
    name: 'Untitled policy',
    steps: [{ kind: 'speedBump', delayMs: '120', appliesTo: emptySelector('all') }],
  }
}

export function newStep(kind: DraftStep['kind']): DraftStep {
  switch (kind) {
    case 'speedBump':
      return { kind, delayMs: '120', appliesTo: emptySelector('all') }
    case 'batchAuction':
      return { kind, windowMs: '250', appliesTo: emptySelector('all') }
    case 'allowDeny':
      return { kind, rules: [{ effect: 'deny', match: emptySelector('signer') }] }
  }
}

export function addStep(draft: PolicyDraft, kind: DraftStep['kind']): PolicyDraft {
  return { ...draft, steps: [...draft.steps, newStep(kind)] }
}

export function removeStep(draft: PolicyDraft, index: number): PolicyDraft {
  return { ...draft, steps: draft.steps.filter((_, position) => position !== index) }
}

/**
 * Order is part of the policy — steps run one after another — so moving a step is an
 * edit like any other, not a display concern.
 */
export function moveStep(draft: PolicyDraft, index: number, by: -1 | 1): PolicyDraft {
  const target = index + by
  const step = draft.steps[index]
  const other = draft.steps[target]
  if (step === undefined || other === undefined) return draft

  const steps = [...draft.steps]
  steps[index] = other
  steps[target] = step

  return { ...draft, steps }
}

export function updateStep(draft: PolicyDraft, index: number, step: DraftStep): PolicyDraft {
  if (draft.steps[index] === undefined) return draft

  return {
    ...draft,
    steps: draft.steps.map((current, position) => (position === index ? step : current)),
  }
}

/**
 * Draft text to a policy, or the reasons it is not one yet.
 *
 * Integers are checked here rather than left to Zod: `Number('')` is 0 and
 * `Number('1e2')` is 100, so a field that went through `Number` unguarded would accept
 * a parameter nobody typed. Everything else — ranges, base58, list lengths, the step
 * count — is the schema's own judgement, so there is exactly one copy of it.
 */
export function toPolicy(draft: PolicyDraft): DraftResult {
  const errors: FieldError[] = []
  const steps: unknown[] = draft.steps.map((step, index) => draftStepToInput(step, index, errors))

  if (errors.length > 0) return { ok: false, errors }

  const parsed = policySchema.safeParse({
    schemaVersion: POLICY_SCHEMA_VERSION,
    name: draft.name,
    steps,
  })

  if (parsed.success) return { ok: true, policy: parsed.data }

  return { ok: false, errors: parsed.error.issues.map(issueToFieldError) }
}

function draftStepToInput(step: DraftStep, index: number, errors: FieldError[]): unknown {
  switch (step.kind) {
    case 'speedBump':
      return {
        kind: step.kind,
        delayMs: integerOr(step.delayMs, `steps.${index}.delayMs`, errors),
        appliesTo: selectorToInput(step.appliesTo),
      }
    case 'batchAuction':
      return {
        kind: step.kind,
        windowMs: integerOr(step.windowMs, `steps.${index}.windowMs`, errors),
        appliesTo: selectorToInput(step.appliesTo),
      }
    case 'allowDeny':
      return {
        kind: step.kind,
        rules: step.rules.map((rule) => ({
          effect: rule.effect,
          match: selectorToInput(rule.match),
        })),
      }
  }
}

function selectorToInput(selector: DraftSelector): unknown {
  switch (selector.match) {
    case 'all':
      return { match: 'all' }
    case 'program':
      return { match: 'program', programs: addressList(selector.addresses) }
    case 'signer':
      return { match: 'signer', signers: addressList(selector.addresses) }
    case 'account':
      return { match: 'account', accounts: addressList(selector.addresses) }
    case 'tokenDeltaAbove':
      return {
        match: 'tokenDeltaAbove',
        mint: selector.mint.trim(),
        amount: selector.amount.trim(),
      }
  }
}

/** One address per line; blank lines are not addresses and are not errors either. */
export function addressList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * Digits only, and it must survive the round trip. A parameter is a whole number of
 * milliseconds; anything else has to be said out loud rather than rounded silently.
 */
function integerOr(text: string, field: string, errors: FieldError[]): number | undefined {
  const trimmed = text.trim()
  if (!/^[0-9]+$/.test(trimmed)) {
    errors.push({ field, message: 'whole milliseconds, digits only' })
    return undefined
  }

  const value = Number(trimmed)
  if (!Number.isSafeInteger(value)) {
    errors.push({ field, message: 'too large to be a whole number of milliseconds' })
    return undefined
  }

  return value
}

/**
 * A Zod path to the field the screen can underline.
 *
 * A complaint about `steps.0.appliesTo.programs.2` belongs on the selector the person
 * is editing, not on an address input that may not exist — the editor holds addresses
 * in one box. So paths are cut at the selector, and at the rule inside allow/deny.
 */
function issueToFieldError(issue: SchemaIssue): FieldError {
  const path = issue.path
  const cut = cutIndex(path)

  return { field: path.slice(0, cut).join('.'), message: issue.message }
}

function cutIndex(path: SchemaIssue['path']): number {
  const appliesTo = path.indexOf('appliesTo')
  if (appliesTo !== -1) return appliesTo + 1

  const rules = path.indexOf('rules')
  // `rules` alone (a bad list length) stays on the step; `rules.1.match.signers`
  // becomes `rules.1`, which is the row the screen draws.
  if (rules !== -1) return path.length > rules + 1 ? rules + 2 : rules + 1

  return path.length
}

/** The errors on one field, in the order the schema reported them. */
export function errorsFor(errors: FieldError[], field: string): FieldError[] {
  return errors.filter((error) => error.field === field)
}
