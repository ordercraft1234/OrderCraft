import { PRESETS, type Preset } from '@ordercraft/core'
import { useState } from 'react'
import { stepSummary } from '../lib/presetChoice.ts'

interface PresetLibraryProps {
  /** The preset the current policy started from, if any. */
  origin: string | null
  /** Whether replacing the draft would lose something that exists only in this tab. */
  unsaved: boolean
  onChoose: (preset: Preset) => void
}

/**
 * The preset library (FR-014): each preset with what it does, when to reach for it and
 * the steps it is made of, so that choosing one is reading it first.
 *
 * Choosing replaces the whole policy. Over a draft somebody edited and did not save,
 * that is asked first — the same rule the session keeps for the address bar: nothing on
 * this screen discards what a person wrote without saying so.
 */
export function PresetLibrary({ origin, unsaved, onChoose }: PresetLibraryProps) {
  const [pending, setPending] = useState<Preset | null>(null)

  const choose = (preset: Preset) => {
    if (unsaved) {
      setPending(preset)
      return
    }
    setPending(null)
    onChoose(preset)
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-hairline pb-2 text-[11px] uppercase tracking-[0.16em] text-muted">
        Presets
      </div>
      {PRESETS.map((preset) => (
        <div key={preset.id} className="flex flex-col gap-1 border-b border-hairline py-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[13px]">{preset.name}</span>
            <button
              type="button"
              className="text-[11px] text-muted underline underline-offset-4 hover:text-ink"
              onClick={() => choose(preset)}
            >
              {origin === preset.id ? 'start over' : 'use'}
            </button>
          </div>
          <div className="text-[12px]">{preset.scenario}</div>
          <div className="text-[12px] text-muted">{preset.description}</div>
          <ol className="flex flex-col text-[11px] text-muted">
            {preset.policy.steps.map((step, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional
              <li key={index}>
                {index + 1}. {stepSummary(step)}
              </li>
            ))}
          </ol>

          {pending?.id === preset.id ? (
            <div className="flex flex-wrap items-baseline gap-3 pt-1 text-[12px]">
              <span>Replace the current policy? It is not saved.</span>
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => {
                  setPending(null)
                  onChoose(preset)
                }}
              >
                replace
              </button>
              <button
                type="button"
                className="text-muted underline underline-offset-4 hover:text-ink"
                onClick={() => setPending(null)}
              >
                keep
              </button>
            </div>
          ) : null}
        </div>
      ))}
      <div className="pt-3 text-[12px] text-muted">
        A preset fills the steps above and is remembered as the policy's origin. No preset refuses
        anything: a deny list needs addresses of your own.
      </div>
    </div>
  )
}
