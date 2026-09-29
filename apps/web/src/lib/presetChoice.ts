import {
  type FieldChange,
  type PolicyStep,
  type Selector,
  WSOL_MINT,
  presetById,
} from '@ordercraft/core'

/**
 * One step of a preset in words, for the library list (FR-014 asks each preset to show
 * what it is made of). The words follow the builder's labels, lower-cased, so that what
 * a person reads in the list is what they then find in the steps.
 */
export function stepSummary(step: PolicyStep): string {
  switch (step.kind) {
    case 'speedBump':
      return `speed bump ${step.delayMs} ms on ${selectorPhrase(step.appliesTo)}`
    case 'batchAuction':
      return `batch auction ${step.windowMs} ms on ${selectorPhrase(step.appliesTo)}`
    case 'allowDeny':
      return step.rules.map((rule) => `${rule.effect} ${selectorPhrase(rule.match)}`).join(' · ')
  }
}

export function selectorPhrase(selector: Selector): string {
  switch (selector.match) {
    case 'all':
      return 'the whole block'
    case 'program':
      return counted(selector.programs.length, 'program')
    case 'signer':
      return counted(selector.signers.length, 'signer')
    case 'account':
      return counted(selector.accounts.length, 'account')
    case 'tokenDeltaAbove':
      return `moves above ${amountPhrase(selector.mint, selector.amount)}`
  }
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

const WSOL_DECIMALS = 9

/**
 * A slot records amounts in base units and carries no decimals, so only wSOL — whose
 * nine decimals are a protocol constant — is scaled. Guessing another mint's decimals
 * would print a number nobody measured.
 */
function amountPhrase(mint: string, amount: string): string {
  if (mint !== WSOL_MINT) return `${amount} base units of ${mint.slice(0, 4)}…${mint.slice(-4)}`

  const digits = amount.padStart(WSOL_DECIMALS + 1, '0')
  const whole = digits.slice(0, -WSOL_DECIMALS)
  const fraction = digits.slice(-WSOL_DECIMALS).replace(/0+$/, '')
  return `${fraction === '' ? whole : `${whole}.${fraction}`} wSOL`
}

/**
 * One changed parameter as a line: what the preset had, and what this policy has.
 * Classes are printed the way the library prints them, so the two can be read side by
 * side.
 */
export function fieldChangeLine(change: FieldChange): string {
  switch (change.field) {
    case 'delayMs':
    case 'windowMs':
      return `${change.field} ${change.preset} → ${change.policy} ms`
    case 'appliesTo':
      return `class ${selectorPhrase(change.preset)} → ${selectorPhrase(change.policy)}`
    case 'rule': {
      const side = (rule: typeof change.preset) =>
        rule === null ? 'none' : `${rule.effect} ${selectorPhrase(rule.match)}`
      return `rule ${change.rule + 1}: ${side(change.preset)} → ${side(change.policy)}`
    }
  }
}

/**
 * The origin to send with a save, or `null`.
 *
 * An origin read back from a stored version can name a preset this build does not ship,
 * and the API refuses to record such an id on a new version. Sending it would turn a
 * save — and the run that saves first — into a failure over a label; the version is
 * stored without an origin instead, which is what it honestly has in this build.
 */
export function recordable(origin: string | null): string | null {
  return origin !== null && presetById(origin) !== undefined ? origin : null
}

/**
 * Whether replacing the draft would lose something a person wrote.
 *
 * `baselineHash` is the content last put on screen by the app — the demo, a preset, a
 * link. A draft still equal to it holds nothing of anyone's; a draft stored under its
 * own hash can be reopened from its link. Everything else, including a draft too
 * half-typed to hash, exists only in this tab.
 */
export function isUnsaved(state: {
  draftHash: string | null
  baselineHash: string | null
  stored: boolean
}): boolean {
  if (state.stored) return false
  return state.draftHash === null || state.draftHash !== state.baselineHash
}
