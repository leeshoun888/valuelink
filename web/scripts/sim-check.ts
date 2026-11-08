import { Runtime } from '../src/engine/runtime'
import { SimVehicle, SCENARIOS, scenarioStart } from '../src/engine/sim'
import { ROUTE, pointAtKm } from '../src/engine/route'
import type { RestStop } from '../src/engine/types'
(globalThis as any).performance ??= { now: () => Date.now() }
import { REST_STOPS as stops } from '../src/data/stops'
for (const sc of SCENARIOS) {
  const { start, wake } = scenarioStart(sc, new Date('2026-09-25T00:00:00+09:00'))
  const sim = new SimVehicle(sc, start)
  const rt = new Runtime(sim, { name: 'd', wakeTime: wake, sleepHours: sc.sleepHours, chronotype: 0 }, stops)
  rt.fleetMode = !!sc.fleet
  ;(rt as any).autoPilot = true
  console.log('\n=== ' + sc.title)
  let lastPrint = 0
  for (let i = 0; i < 6 * 60 * 6; i++) { // up to 6h in 10s steps
    rt.frame(10_000, 1)
    const s = rt.snapshot()
    if (rt.proposal) rt.acceptProposal()
    if (s.sig.t - lastPrint >= 20 * 60_000) {
      lastPrint = s.sig.t
      const d = new Date(s.sig.t)
      console.log(`${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')} km=${s.sig.routeProgressKm!.toFixed(0).padStart(3)} v=${s.sig.speedKph.toFixed(0).padStart(3)} co2=${s.co2.toFixed(0).padStart(4)} recirc=${s.sig.recirculation?1:0} kss=${s.est.kss.toFixed(2)} L${s.est.level} toDanger=${s.est.minutesToDanger} mode=${s.mode} plan=${s.plan?.stop.name ?? '-'}@${s.plan?.etaMin.toFixed(0)}`)
    }
    if (s.sig.routeRemainingKm! < 0.5) break
  }
  for (const e of rt.timeline) { const d = new Date(e.t); console.log(`  ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')} [L${e.level}] ${e.title}`) }
}
