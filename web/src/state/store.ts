import { create } from 'zustand'
import { Runtime, type Snapshot } from '../engine/runtime'
import { SIM_DELIVERED, SimVehicle, simHistory } from '../engine/sim'
import { manwon, won } from '../engine/valuation'
import { voice } from '../voice/voice'
import { NativeVehicle, isNative, setGleoHandler } from '../engine/native'
import { LivePublicSource, ScenarioPublicSource } from '../engine/publicdata'

/** Public-data proxy (tools/publicdata-proxy); unset in the judging build, which uses the snapshot. */
const PROXY = (import.meta.env.VITE_PUBLIC_PROXY as string | undefined) ?? ''
const publicSource = (fallback?: ScenarioPublicSource) => (PROXY ? new LivePublicSource(PROXY, fallback) : fallback ?? new ScenarioPublicSource())

export type SheetKind = 'value' | 'trade' | 'tradeUp' | 'map'

interface Store {
  runtime: Runtime | null
  sim: SimVehicle | null
  snap: Snapshot | null
  playing: boolean
  /** Simulated seconds per real second. */
  timeScale: number
  /** In-car UI theme outside the APK (in the APK the vehicle's day/night mode wins). */
  carTheme: 'auto' | 'light' | 'dark'
  setCarTheme: (t: 'auto' | 'light' | 'dark') => void
  boot: () => void
  restart: () => void
  setPlaying: (p: boolean) => void
  setTimeScale: (s: number) => void
  /** APK: load the demo history (passport since delivery) so judges see a lived-in car. */
  loadDemoHistory: () => void
  /** Car-app sheet (value breakdown, asset report, trade-up offer). */
  sheet: SheetKind | null
  setSheet: (s: SheetKind | null) => void
  /** Demo: jump the car's age to five months before the certified-used-car window closes. */
  previewTradeUp: () => void
}

let raf = 0
let last = 0

export const useStore = create<Store>((set, get) => ({
  runtime: null,
  sim: null,
  snap: null,
  playing: false,
  timeScale: 60,
  carTheme: 'auto',
  setCarTheme: (carTheme) => set({ carTheme }),
  boot: () => {
    if (get().runtime) return
    get().restart()
  },
  restart: () => {
    cancelAnimationFrame(raf)
    let rt: Runtime
    let sim: SimVehicle | null = null
    if (isNative()) {
      rt = new Runtime(new NativeVehicle(), { persistKey: 'valuelink.v1', publicSource: publicSource() })
    } else {
      sim = new SimVehicle()
      rt = new Runtime(sim, { deliveredAt: SIM_DELIVERED, publicSource: publicSource(sim.pub) })
      const s = sim.read()
      const soh = (100 * s.batteryCapWh!) / s.batteryDesignWh!
      rt.seed(simHistory(s.t, s.odometerKm!, soh))
    }
    rt.hooks = { speak: (text) => void voice.say(text) }
    setGleoHandler((json) => gleo(rt, json))
    rt.subscribe((snap) => set({ snap }))
    rt.tick(0)
    set({ runtime: rt, sim, snap: rt.snapshot() })
    last = performance.now()
    let nativeAcc = 0
    const loop = (now: number) => {
      const dt = Math.min(250, now - last)
      last = now
      const { playing, timeScale } = get()
      if (isNative()) {
        nativeAcc += dt
        if (nativeAcc >= 1000) {
          rt.tick(nativeAcc)
          nativeAcc = 0
        }
      } else if (playing) {
        // sub-step so 1 s rule cadence holds at high time scales
        let left = dt * timeScale
        while (left > 0) {
          const step = Math.min(1000, left)
          rt.tick(step)
          left -= step
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
  },
  setPlaying: (playing) => set({ playing }),
  sheet: null,
  setSheet: (sheet) => set({ sheet }),
  previewTradeUp: () => {
    const rt = get().runtime
    if (!rt) return
    const s = rt.snapshot()
    if (!s) return
    rt.ageOffsetYears = 0
    const age = rt.ageYears(s.sig.t)
    rt.ageOffsetYears = Math.max(0, 5 - 5 / 12 - age)
    rt.tick(1000)
  },
  setTimeScale: (timeScale) => set({ timeScale }),
  loadDemoHistory: () => {
    const rt = get().runtime
    if (!rt) return
    const s = rt.bus.read()
    const soh = s.batteryCapWh && s.batteryDesignWh ? (100 * s.batteryCapWh) / s.batteryDesignWh : 98
    rt.seed(simHistory(s.t, Math.max(s.odometerKm ?? 0, 1), soh))
  },
}))

// Debug / automation handle (WebView devtools, console scripts).
;(globalThis as unknown as { __cvStore: typeof useStore }).__cvStore = useStore

/** Gleo Interface handler: answers synchronously from the latest snapshot. */
function gleo(rt: Runtime, json: string) {
  let fn = ''
  let params: Record<string, unknown> = {}
  try {
    const p = JSON.parse(json)
    fn = String(p.functionName ?? p.function ?? p.name ?? '')
    params = p.params ?? p.parameters ?? {}
  } catch {
    /* keep empty */
  }
  const s = rt.snapshot()
  if (!s) return { status: 'fail', message: '아직 차량 정보를 읽는 중이에요.' }
  switch (fn) {
    case 'GET_CAR_VALUE':
      return { status: 'success', message: `내 차의 자산 가치는 ${manwon(s.value.value)}이에요.${s.protectedMonth > 0 ? ` 이번 달에 ${won(s.protectedMonth)}을 지켜냈어요.` : ''} 관리 점수는 ${s.links.careScore}점이에요.` }
    case 'GET_BATTERY_HEALTH':
      return {
        status: 'success',
        message: `배터리 건강도는 ${s.battery.soh.toFixed(1)}%로, 같은 연식 평균보다 ${(s.battery.soh - s.battery.expected).toFixed(1)}%p ${s.battery.soh >= s.battery.expected ? '높아요' : '낮아요'}.`,
      }
    case 'SET_CHARGE_LIMIT': {
      const pct = Math.round(Math.min(100, Math.max(50, Number(params.percent ?? 80))))
      void rt.setChargeLimit(pct)
      return { status: 'success', message: `충전 상한을 ${pct}%로 맞출게요.` }
    }
    case 'FIND_SERVICE_CENTER':
      void rt.findService()
      return { status: 'success', message: '가까운 블루핸즈를 내비에서 찾아볼게요.' }
    case 'GET_PARKING_RISK': {
      const m = s.pub.map
      if (!m) return { status: 'fail', message: '위치를 확인하는 중이에요.' }
      const top = m.factors[0]
      const tail = m.best ? ` ${Math.round(m.best.distanceM)}미터 옆 ${m.best.name} ${m.best.level}이 더 안전해요.` : ''
      return { status: 'success', message: `여기 주차 안전 점수는 ${m.score}점, ${m.level}이에요.${top ? ` ${top.label} 때문이에요.` : ' 침수·범죄·날씨 위험이 없어요.'}${tail}` }
    }
    case 'GET_TRADE_IN_QUOTE':
      if (!s.tradeIn) return { status: 'fail', message: '보상판매 견적은 정차 중에 보여드릴게요.' }
      return { status: 'success', message: `차량 여권 기준 현대 인증중고차 예상 매입가는 ${manwon(s.tradeIn.price)}이에요.${s.links.cpo.eligible ? ` 매입 기준까지 ${Math.floor(s.links.cpo.monthsLeft / 12)}년 ${s.links.cpo.monthsLeft % 12}개월 남았어요.` : ''}` }
  }
  return { status: 'fail', message: '지원하지 않는 요청이에요.' }
}
