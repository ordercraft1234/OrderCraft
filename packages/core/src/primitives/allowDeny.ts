import type { PolicyStep } from '../policy/schema.ts'
import type { SlotBundle } from '../slot/schema.ts'
import { type Placement, refusedBy, transactionFor } from './placement.ts'
import { matchesSelector } from './select.ts'

export type AllowDenyStep = Extract<PolicyStep, { kind: 'allowDeny' }>

/**
 * Prioritises or refuses transactions by an explicit list of classes (FR-003).
 *
 * **Overlap is decided by effect, never by rule order.** `validatePolicy` already
 * refuses a step that gives one class both effects, on the grounds that letting rule
 * order settle it leaves the decision implicit. Two *different* selectors can still
 * catch the same transaction — deny a program, prioritise a signer, and someone is
 * both — so the rule here is fixed and order-free: **deny wins**. A refusal is a
 * stronger statement than a preference, and a policy author who reorders a list should
 * not thereby let something through.
 *
 * Priority is a class, not a time. A prioritised transaction sorts ahead of every
 * unprioritised one; it does not "arrive earlier", because that would make it
 * indistinguishable from one that genuinely did and would quietly change how much
 * delay the run reports.
 */
export function allowDeny(
  bundle: SlotBundle,
  placements: readonly Placement[],
  step: AllowDenyStep,
): Placement[] {
  return placements.map((placement) => {
    const transaction = transactionFor(bundle, placement)

    // Consistent with the other primitives: a step acts on what is still in the block.
    // Steps run in the order the author wrote them, so a deny placed after a speed bump
    // that already deferred something is visibly a no-op rather than a silent one.
    if (placement.status !== 'kept') return placement

    const effects = new Set(
      step.rules
        .filter((rule) => matchesSelector(rule.match, transaction))
        .map((rule) => rule.effect),
    )

    if (effects.has('deny')) return refusedBy(placement, 'allowDeny')
    if (effects.has('prioritise')) {
      return { ...placement, prioritised: true, changedBy: 'allowDeny' }
    }

    return placement
  })
}
