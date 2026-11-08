import { lazy, Suspense, useEffect, useState } from 'react'
import { CarFrame } from './car/CarApp'
import { useStore } from './state/store'
import { isNative } from './engine/native'
import { Logo } from './ui/icons'

const Landing = lazy(() => import('./pages/Landing'))
const Console = lazy(() => import('./console/Console'))
const PassportPage = lazy(() => import('./pages/Passport'))
const Fleet = lazy(() => import('./pages/Fleet'))

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
  const boot = useStore((s) => s.boot)
  useEffect(() => {
    boot()
    if (!isNative()) useStore.getState().setPlaying(true)
  }, [boot])
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
      {route === '/console' ? <Console /> : route === '/passport' ? <PassportPage /> : route === '/fleet' ? <Fleet /> : <Landing />}
    </Suspense>
  )
}
