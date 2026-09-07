import { Screen } from '../components/Screen.tsx'

interface NotFoundProps {
  path: string
}

/**
 * Prints what was asked for instead of redirecting. A silent redirect to the first
 * screen would hide a broken link in exactly the case where someone shared one.
 */
export function NotFound({ path }: NotFoundProps) {
  return (
    <Screen title="No such screen">
      <div className="max-w-[620px] text-[12px] text-muted">
        Nothing is routed at <span className="text-ink">{path}</span>.
      </div>
    </Screen>
  )
}
