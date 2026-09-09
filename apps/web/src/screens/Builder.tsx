import { POLICY_SCHEMA_VERSION, PRIMITIVES, policyHash, validatePolicy } from '@ordercraft/core'
import { DEMO_SLOT } from '@ordercraft/fixtures'
import { useMemo } from 'react'
import { Screen } from '../components/Screen.tsx'
import { fieldClass } from '../components/SelectorEditor.tsx'
import { StepRow } from '../components/StepRow.tsx'
import {
  type DraftStep,
  type PolicyDraft,
  addStep,
  errorsFor,
  moveStep,
  removeStep,
  toPolicy,
  updateStep,
} from '../lib/policyDraft.ts'
import { toHash } from '../lib/router.ts'
import { navigate } from '../lib/useRoute.ts'

/**
 * Artboard 1, on the real schema.
 *
 * Two validators run here and they answer different questions. The schema says whether
 * this is a policy at all — ranges, base58, list lengths. `validatePolicy` says whether
 * a well-formed policy means anything: a second batch auction, a rule that denies the
 * whole block, two speed bumps on one class. Only the first can stop the text from
 * becoming a policy, so the second only runs once the first has passed.
 *
 * The draft belongs to `App`, not to this screen: the comparison replays the same one,
 * and a copy kept here would let the two screens disagree about what the policy is.
 */
interface BuilderProps {
  draft: PolicyDraft
  onChange: (draft: PolicyDraft) => void
}

export function Builder({ draft, onChange }: BuilderProps) {
  const setDraft = onChange

  const parsed = useMemo(() => toPolicy(draft), [draft])
  const validation = useMemo(() => (parsed.ok ? validatePolicy(parsed.policy) : null), [parsed])
  const hash = useMemo(() => (parsed.ok ? policyHash(parsed.policy) : null), [parsed])

  const errors = parsed.ok ? [] : parsed.errors
  const blockingIssues = validation?.issues.filter((issue) => issue.severity === 'error') ?? []
  const warnings = validation?.issues.filter((issue) => issue.severity === 'warning') ?? []

  return (
    <Screen title="Policy">
      <div className="flex flex-col gap-10 lg:flex-row lg:gap-16">
        <div className="flex flex-1 flex-col gap-6">
          <label className="flex max-w-[320px] flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">Name</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className={fieldClass(errorsFor(errors, 'name').length > 0)}
            />
            {errorsFor(errors, 'name').map((error) => (
              <span key={error.message} className="text-[11px] text-extracted">
                {error.message}
              </span>
            ))}
          </label>

          <div className="flex flex-col">
            <div className="border-b border-hairline pb-2 text-[11px] uppercase tracking-[0.16em] text-muted">
              Steps
            </div>
            {draft.steps.map((step, index) => (
              <StepRow
                // Steps are positional and carry no id; two identical steps are a
                // legitimate draft state, so the index is the only key that exists.
                // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional
                key={index}
                index={index}
                step={step}
                count={draft.steps.length}
                errors={errors}
                onChange={(next: DraftStep) => setDraft(updateStep(draft, index, next))}
                onMove={(by) => setDraft(moveStep(draft, index, by))}
                onRemove={() => setDraft(removeStep(draft, index))}
              />
            ))}

            {errorsFor(errors, 'steps').map((error) => (
              <div key={error.message} className="pt-3 text-[11px] text-extracted">
                {error.message}
              </div>
            ))}

            <div className="pt-3 text-[12px] text-muted">
              Steps run in the order listed. A speed bump before a batch auction is not the same
              policy as the reverse.
            </div>
          </div>

          <Issues blocking={blockingIssues} warnings={warnings} />

          <div className="flex flex-col gap-1 border-t border-hairline pt-4 text-[12px] text-muted">
            <div>
              {hash === null ? 'content hash — · ' : `content hash ${hash.slice(0, 12)} · `}
              schema v{POLICY_SCHEMA_VERSION}
            </div>
            <RunState blocked={reasonNotRunnable(errors.length, blockingIssues.length)} />
          </div>
        </div>

        <div className="flex w-full flex-col gap-6 lg:w-[340px]">
          <div className="flex flex-col">
            <div className="border-b border-hairline pb-2 text-[11px] uppercase tracking-[0.16em] text-muted">
              Primitives
            </div>
            {PRIMITIVES.map((primitive) => (
              <div
                key={primitive.kind}
                className="flex flex-col gap-1 border-b border-hairline py-3"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[13px]">{primitive.label}</span>
                  <button
                    type="button"
                    className="text-[11px] text-muted underline underline-offset-4 hover:text-ink"
                    onClick={() => setDraft(addStep(draft, primitive.kind))}
                  >
                    add
                  </button>
                </div>
                <div className="text-[12px] text-muted">{primitive.description}</div>
                <div className="text-[11px] text-muted">
                  {primitive.parameter.field} · {primitive.parameter.min}–{primitive.parameter.max}{' '}
                  {primitive.parameter.unit}
                </div>
              </div>
            ))}
          </div>

          <div className="text-[12px] text-muted">
            Presets are not built yet — T036. Until then a policy starts from one step and is edited
            by hand.
          </div>
        </div>
      </div>
    </Screen>
  )
}

function Issues({
  blocking,
  warnings,
}: {
  blocking: ReadonlyArray<{ message: string }>
  warnings: ReadonlyArray<{ message: string }>
}) {
  if (blocking.length === 0 && warnings.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {blocking.map((issue) => (
        <div key={issue.message} className="max-w-[640px] text-[12px] text-extracted">
          {issue.message}
        </div>
      ))}
      {warnings.map((issue) => (
        <div key={issue.message} className="max-w-[640px] text-[12px] text-muted">
          {issue.message}
        </div>
      ))}
    </div>
  )
}

/**
 * Why the run cannot start, or `null` when it can. Printing the reason beats a button
 * that does nothing when pressed — and now that a slot ships with the app, the reason
 * is about the policy rather than about what has not been built.
 */
function reasonNotRunnable(schemaErrors: number, blockingIssues: number): string | null {
  if (schemaErrors > 0) return 'the policy is not valid yet'
  if (blockingIssues > 0) return 'the policy is valid but would not order anything meaningful'

  return null
}

function RunState({ blocked }: { blocked: string | null }) {
  return (
    <div className="flex items-baseline gap-3">
      <button
        type="button"
        disabled={blocked !== null}
        onClick={() => navigate(toHash({ name: 'compare' }))}
        className="text-[12px] underline underline-offset-4 disabled:text-muted disabled:no-underline disabled:opacity-40"
      >
        Run on slot
      </button>
      <span className="text-[11px] text-muted">
        {blocked ?? `slot ${DEMO_SLOT.toLocaleString('en-US')}, the one the repository ships`}
      </span>
    </div>
  )
}
