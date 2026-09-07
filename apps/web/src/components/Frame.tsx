import type { ReactNode } from 'react'
import { NAVIGATION, type Route, isCurrent, toHash } from '../lib/router.ts'

interface FrameProps {
  current: Route
  children: ReactNode
}

/**
 * The chrome every screen sits in: a name, the four screens, hairlines, and the one
 * sentence about what this product is that must never leave the page.
 *
 * Hairlines and rows, no cards — a panel with a border and a shadow would compete
 * with the ribbon field, and the ribbon field is the only thing on the page worth
 * looking at.
 */
export function Frame({ current, children }: FrameProps) {
  return (
    <div className="flex min-h-screen flex-col bg-ground text-ink">
      <header className="flex flex-col gap-3 border-b border-hairline px-6 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:px-10">
        <div className="text-[13px] tracking-[0.02em]">OrderCraft</div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          {NAVIGATION.map((entry) => (
            <a
              key={entry.label}
              href={toHash(entry.route)}
              className={
                isCurrent(current, entry.route)
                  ? 'text-[11px] uppercase tracking-[0.16em] text-ink'
                  : 'text-[11px] uppercase tracking-[0.16em] text-muted hover:text-ink'
              }
            >
              {entry.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="flex-1 px-6 py-8 sm:px-10">{children}</main>

      <footer className="border-t border-hairline px-6 py-4 text-[11px] text-muted sm:px-10">
        Replayed against a recorded block. Not an ordering engine and not connected to any block
        builder.
      </footer>
    </div>
  )
}
