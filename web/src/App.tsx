import { lazy, Suspense, useEffect, useState } from 'react'
import { CarFrame } from './car/CarApp'
import { useSim } from './state/store'
import { SCENARIOS } from './engine/sim'
import { isNative } from './engine/native'
import { Logo } from './ui/icons'

const Landing = lazy(() => import('./pages/Landing').then((m) => ({ default: m.Landing })))
const Console = lazy(() => import('./console/Console').then((m) => ({ default: m.Console })))
const Fleet = lazy(() => import('./pages/Fleet').then((m) => ({ default: m.Fleet })))
const Report = lazy(() => import('./pages/Report').then((m) => ({ default: m.Report })))

function useHashRoute() {
  const get = () => window.location.hash.replace(/^#/, '').split('?')[0] || '/'
  const [r, setR] = useState(get)
  useEffect(() => {
    const on = () => {
      setR(get())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return r
}

/** Standalone in-vehicle app (this is the route the APK's WebView opens). */
function CarRoute() {
  const load = useSim((s) => s.load)
  useEffect(() => {
    if (!useSim.getState().runtime) {
      load(SCENARIOS[0].id)
      if (!isNative()) useSim.getState().setPlaying(true)
    }
  }, [load])
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <CarFrame />
    </div>
  )
}

const Splash = () => (
  <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
    <div style={{ animation: 'pulse 1.2s infinite' }}>
      <Logo size={56} />
    </div>
  </div>
)

export default function App() {
  const route = useHashRoute()
  if (isNative() || route === '/car') return <CarRoute />
  return (
    <Suspense fallback={<Splash />}>
      {route === '/console' ? <Console /> : route === '/fleet' ? <Fleet /> : route === '/report' ? <Report /> : <Landing />}
    </Suspense>
  )
}
