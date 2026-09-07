import type { ReactNode } from 'react'

interface ScreenProps {
  title: string
  /** Block identity or scope, printed under the title in muted ink. */
  subtitle?: string
  children: ReactNode
}

/** Title, optional identity line, hairline, content. Every screen opens this way. */
export function Screen({ title, subtitle, children }: ScreenProps) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 border-b border-hairline pb-4">
        <h1 className="text-[11px] uppercase tracking-[0.16em] text-muted">{title}</h1>
        {subtitle === undefined ? null : <div className="text-[12px] text-muted">{subtitle}</div>}
      </div>
      {children}
    </section>
  )
}

interface PendingProps {
  /** The task in `docs/TASKS.md` that fills this screen in. */
  task: string
  children: ReactNode
}

/**
 * A screen the skeleton reaches but does not yet draw.
 *
 * It says so in the same plain register the product uses everywhere else, and names
 * the task. A placeholder that showed invented numbers would be the one thing this
 * product is not allowed to do — put a figure on screen that nothing produced.
 */
export function Pending({ task, children }: PendingProps) {
  return (
    <div className="flex max-w-[620px] flex-col gap-2 text-muted">
      <div className="text-[12px]">Not built yet — {task}.</div>
      <div className="text-[12px]">{children}</div>
    </div>
  )
}
