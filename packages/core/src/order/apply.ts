import { policyHash } from '../policy/compile.ts'
import type { Policy, PolicyStep } from '../policy/schema.ts'
import { validatePolicy } from '../policy/validate.ts'
import { allowDeny } from '../primitives/allowDeny.ts'
import { batchAuction } from '../primitives/batchAuction.ts'
import { type Placement, initialPlacements } from '../primitives/placement.ts'
import { speedBump } from '../primitives/speedBump.ts'
import type { SlotBundle } from '../slot/schema.ts'

export interface Ordering {
  slot: number
  /** Content address of the policy that produced this. A run is `(policyHash, slot)`. */
  policyHash: string
  /** What the block would have held, in policy order. */
  included: Placement[]
  /** Everything the policy left out — deferred and dropped — in recorded order. */
  excluded: Placement[]
}

/**
 * Applies a policy to one slot and returns the ordering it produces (FR-007).
 *
 * Steps run in the order the author wrote them, each seeing the output of the last, and
 * none of them sorts. Sorting happens once, here, so that no primitive has to hold an
 * opinion about tie-breaking and the total order is defined in exactly one place.
 */
export function apply(policy: Policy, bundle: SlotBundle): Ordering {
  const validation = validatePolicy(policy)
  if (!validation.runnable) {
    const reasons = validation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.message)
      .join('; ')

    throw new Error(`policy cannot be run: ${reasons}`)
  }

  let placements: readonly Placement[] = initialPlacements(bundle)
  for (const step of policy.steps) {
    placements = runStep(bundle, placements, step)
  }

  return {
    slot: bundle.slot,
    policyHash: policyHash(policy),
    included: placements.filter((placement) => placement.status === 'kept').sort(byPolicyOrder),
    excluded: placements
      .filter((placement) => placement.status !== 'kept')
      .sort((left, right) => left.index - right.index),
  }
}

function runStep(
  bundle: SlotBundle,
  placements: readonly Placement[],
  step: PolicyStep,
): Placement[] {
  switch (step.kind) {
    case 'speedBump':
      return speedBump(bundle, placements, step)
    case 'batchAuction':
      return batchAuction(bundle, placements, step)
    case 'allowDeny':
      return allowDeny(bundle, placements, step)
  }
}

/**
 * The total order (FR-008). Priority first, then the clock, then the position the block
 * recorded, then the signature.
 *
 * The last two are what make it total: `index` is unique within a slot, so a tie is
 * already impossible by the third key. `signature` is kept anyway — it costs one
 * comparison that never runs in practice, and it means an ordering assembled from two
 * sources still cannot come out differently on two machines.
 */
function byPolicyOrder(left: Placement, right: Placement): number {
  if (left.prioritised !== right.prioritised) return left.prioritised ? -1 : 1
  if (left.timeMs !== right.timeMs) return left.timeMs - right.timeMs
  if (left.index !== right.index) return left.index - right.index
  if (left.signature === right.signature) return 0

  return left.signature < right.signature ? -1 : 1
}
