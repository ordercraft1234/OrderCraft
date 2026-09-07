import { Frame } from './components/Frame.tsx'
import type { Route } from './lib/router.ts'
import { useRoute } from './lib/useRoute.ts'
import { Attack } from './screens/Attack.tsx'
import { Builder } from './screens/Builder.tsx'
import { Compare } from './screens/Compare.tsx'
import { NotFound } from './screens/NotFound.tsx'
import { Report } from './screens/Report.tsx'

export function App() {
  const route = useRoute()

  return (
    <Frame current={route}>
      <ScreenFor route={route} />
    </Frame>
  )
}

function ScreenFor({ route }: { route: Route }) {
  switch (route.name) {
    case 'builder':
      return <Builder />
    case 'compare':
      return <Compare />
    case 'attack':
      return <Attack triple={route.triple} />
    case 'report':
      return <Report />
    case 'notFound':
      return <NotFound path={route.path} />
  }
}
