import { useState } from 'react'
import { Frame } from './components/Frame.tsx'
import { demoDraft } from './lib/demoPolicy.ts'
import type { PolicyDraft } from './lib/policyDraft.ts'
import type { Route } from './lib/router.ts'
import { useRoute } from './lib/useRoute.ts'
import { Attack } from './screens/Attack.tsx'
import { Builder } from './screens/Builder.tsx'
import { Compare } from './screens/Compare.tsx'
import { NotFound } from './screens/NotFound.tsx'
import { Report } from './screens/Report.tsx'

/**
 * The policy lives here rather than inside the builder, because two screens need the
 * same one: the builder edits it, the comparison replays it. At M1 that is the whole
 * of the app's state — it is held in the tab and lost on reload, which is what the
 * milestone says and what the screens have to admit.
 *
 * It opens on the demo policy, not on a blank one: the slot ships with the repository,
 * so a visitor who types nothing should still see a block reordered.
 */
export function App() {
  const route = useRoute()
  const [draft, setDraft] = useState<PolicyDraft>(demoDraft)

  return (
    <Frame current={route}>
      <ScreenFor route={route} draft={draft} onDraftChange={setDraft} />
    </Frame>
  )
}

interface ScreenForProps {
  route: Route
  draft: PolicyDraft
  onDraftChange: (draft: PolicyDraft) => void
}

function ScreenFor({ route, draft, onDraftChange }: ScreenForProps) {
  switch (route.name) {
    case 'builder':
      return <Builder draft={draft} onChange={onDraftChange} />
    case 'compare':
      return <Compare draft={draft} />
    case 'attack':
      return <Attack triple={route.triple} draft={draft} />
    case 'report':
      return <Report />
    case 'notFound':
      return <NotFound path={route.path} />
  }
}
