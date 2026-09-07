import { PRIMITIVES } from '@ordercraft/core'
import { Pending, Screen } from '../components/Screen.tsx'

/**
 * Artboard 1. The policy list is T022; what the skeleton can already show honestly is
 * the primitive catalogue, because it is not screen copy — it is
 * `PRIMITIVES` out of `packages/core`, ranges included. If a range moves in the
 * schema it moves here, and nobody has to remember to edit a second list.
 */
export function Builder() {
  return (
    <Screen title="Policy">
      <div className="flex flex-col gap-8">
        <Pending task="T022">
          The ordered list of steps, the content hash, and the out-of-range state go here, built on
          the policy schema rather than on mock data.
        </Pending>

        <div className="flex max-w-[720px] flex-col">
          <div className="border-b border-hairline pb-2 text-[11px] uppercase tracking-[0.16em] text-muted">
            Primitives
          </div>
          {PRIMITIVES.map((primitive) => (
            <div
              key={primitive.kind}
              className="flex items-baseline justify-between gap-8 border-b border-hairline py-3"
            >
              <div className="flex flex-col gap-1">
                <div className="text-[13px]">{primitive.label}</div>
                <div className="text-[12px] text-muted">{primitive.description}</div>
              </div>
              <div className="whitespace-nowrap text-[12px] text-muted">
                {primitive.parameter.field} · {primitive.parameter.min}–{primitive.parameter.max}{' '}
                {primitive.parameter.unit}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  )
}
