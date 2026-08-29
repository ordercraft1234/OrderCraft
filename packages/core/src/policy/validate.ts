import { canonicalize } from './compile.ts'
import type { Policy, Selector } from './schema.ts'

export type PolicyIssueCode =
  | 'duplicate-batch-auction'
  | 'denies-everything'
  | 'contradictory-rules'
  | 'no-op-speed-bump'
  | 'overlapping-speed-bumps'
  | 'repeated-address'

export interface PolicyIssue {
  code: PolicyIssueCode
  severity: 'error' | 'warning'
  /** Index of the step the issue belongs to, as shown in the builder. */
  step: number
  message: string
}

export interface PolicyValidation {
  issues: PolicyIssue[]
  /** False when at least one issue is an error; the run must not start. */
  runnable: boolean
}

/**
 * Checks a policy that already satisfies the schema. Everything here is about
 * meaning rather than shape: a policy can be perfectly well-formed and still order
 * nothing, empty the block, or contradict itself.
 */
export function validatePolicy(policy: Policy): PolicyValidation {
  const issues: PolicyIssue[] = []
  const speedBumps = new Map<string, number>()
  let batchAuctionAt: number | null = null

  for (const [index, step] of policy.steps.entries()) {
    if (step.kind === 'batchAuction') {
      if (batchAuctionAt === null) {
        batchAuctionAt = index
      } else {
        issues.push({
          code: 'duplicate-batch-auction',
          severity: 'error',
          step: index,
          message: `step ${index + 1} is a second batch auction: it would regroup the output of step ${batchAuctionAt + 1}, and the settled price of the first window stops meaning anything. Combine them into one window.`,
        })
      }
    }

    if (step.kind === 'speedBump') {
      if (step.delayMs === 0) {
        issues.push({
          code: 'no-op-speed-bump',
          severity: 'warning',
          step: index,
          message: `step ${index + 1} holds its class for 0 ms, which changes no order at all.`,
        })
      }

      const key = selectorKey(step.appliesTo)
      const previous = speedBumps.get(key)
      if (previous === undefined) {
        speedBumps.set(key, index)
      } else {
        issues.push({
          code: 'overlapping-speed-bumps',
          severity: 'warning',
          step: index,
          message: `steps ${previous + 1} and ${index + 1} hold the same class; their delays add up, which is rarely what is meant.`,
        })
      }
    }

    for (const issue of selectorIssues(step, index)) issues.push(issue)
    for (const issue of ruleIssues(step, index)) issues.push(issue)
  }

  return { issues, runnable: !issues.some((issue) => issue.severity === 'error') }
}

function selectorIssues(step: Policy['steps'][number], index: number): PolicyIssue[] {
  const selectors = step.kind === 'allowDeny' ? step.rules.map((rule) => rule.match) : [step.appliesTo]

  return selectors.flatMap((selector) => {
    const addresses = selectorAddresses(selector)
    return new Set(addresses).size === addresses.length
      ? []
      : [
          {
            code: 'repeated-address' as const,
            severity: 'warning' as const,
            step: index,
            message: `step ${index + 1} lists the same address twice; the duplicate has no effect.`,
          },
        ]
  })
}

function ruleIssues(step: Policy['steps'][number], index: number): PolicyIssue[] {
  if (step.kind !== 'allowDeny') return []

  const issues: PolicyIssue[] = []
  const effects = new Map<string, 'prioritise' | 'deny'>()

  for (const rule of step.rules) {
    if (rule.effect === 'deny' && rule.match.match === 'all') {
      issues.push({
        code: 'denies-everything',
        severity: 'error',
        step: index,
        message: `step ${index + 1} denies every transaction, leaving an empty block to order.`,
      })
    }

    const key = selectorKey(rule.match)
    const seen = effects.get(key)
    if (seen !== undefined && seen !== rule.effect) {
      issues.push({
        code: 'contradictory-rules',
        severity: 'error',
        step: index,
        message: `step ${index + 1} both prioritises and denies the same class; which one wins would depend on rule order, and that is not a decision to leave implicit.`,
      })
    } else {
      effects.set(key, rule.effect)
    }
  }

  return issues
}

function selectorAddresses(selector: Selector): string[] {
  switch (selector.match) {
    case 'program':
      return selector.programs
    case 'signer':
      return selector.signers
    case 'account':
      return selector.accounts
    default:
      return []
  }
}

/** Two selectors are the same class when they list the same addresses, in any order. */
function selectorKey(selector: Selector): string {
  const addresses = selectorAddresses(selector)
  return addresses.length === 0
    ? canonicalize(selector)
    : canonicalize({ match: selector.match, addresses: [...addresses].sort() })
}
