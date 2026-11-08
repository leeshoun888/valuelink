import { create } from 'zustand'
import { Runtime, type Snapshot } from '../engine/runtime'
import { SCENARIOS, SimVehicle, scenarioStart, type ScenarioConfig } from '../engine/sim'
import { ROUTE } from '../engine/route'
import { ALL_STOPS, REST_STOPS } from '../data/stops'
import { voice } from '../voice/voice'
import { NativeVehicle, isNative, setGleoHandler } from '../engine/native'

interface SimStore {
  runtime: Runtime | null
  snap: Snapshot | null
  scenario: ScenarioConfig
  playing: boolean
  timeScale: number
  autoPilot: boolean
  /** In-car UI theme outside the APK (in the APK the vehicle's day/night mode wins). auto = sim clock. */
  carTheme: 'auto' | 'day' | 'night'
  setCarTheme: (t: 'auto' | 'day' | 'night') => void
  load: (id: string) => void
  setPlaying: (p: boolean) => void
  setTimeScale: (s: number) => void
  setAutoPilot: (a: boolean) => void
}

let raf = 0
let last = 0
let nativeAcc = 0

export const useSim = create<SimStore>((set, get) => ({
  runtime: null,
  snap: null,
  scenario: SCENARIOS[0],
  playing: false,
  timeScale: 60,
  autoPilot: true,
  load: (id) => {
    const sc = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]
    cancelAnimationFrame(raf)
    let rt: Runtime
    if (isNative()) {
      const bus = new NativeVehicle()
      rt = new Runtime(bus, { name: '운전자', wakeTime: Date.now() - 9 * 3.6e6, sleepHours: 6.5, chronotype: 0 }, REST_STOPS)
      rt.freeRoamStops = ALL_STOPS
    } else {
      const { start, wake } = scenarioStart(sc)
      const sim = new SimVehicle(sc, start, ROUTE)
      rt = new Runtime(sim, { name: '운전자', wakeTime: wake, sleepHours: sc.sleepHours, chronotype: 0 }, REST_STOPS)
      rt.fleetMode = Boolean(sc.fleet)
    }
    // In the car the real driver answers proposals and starts naps; auto-pilot is a simulation aid only.
    rt.autoPilot = isNative() ? false : get().autoPilot
    rt.hooks = {
      speak: (key) => voice.say(key),
      engage: () => voice.engage(rt),
      probe: () => voice.probe(rt),
    }
    setGleoHandler((json) => {
      let fn = ''
      try {
        const p = JSON.parse(json)
        fn = String(p.functionName ?? p.function ?? p.name ?? "")
      } catch {
        /* keep empty */
      }
      const s = rt.snapshot()
      if (fn.includes('STATUS')) {
        const l = ['맑음', '주의', '졸음 신호', '휴식 필요', '위험'][s.est.level]
        return { status: 'success', message: `졸음지수 ${s.est.kss.toFixed(1)}, ${l} 상태예요.${s.plan ? ` 추천 휴식지는 ${s.plan.stop.name}, ${Math.round(s.plan.etaMin)}분 거리예요.` : ''}` }
      }
      if (fn.includes('CANCEL')) {
        if (!s.waypoint) return { status: 'fail', message: '추가된 휴식 경유지가 없어요.' }
        rt.cancelWaypoint()
        return { status: 'success', message: '휴식 경유지를 취소했어요.' }
      }
      if (fn.includes('REST')) {
        const stop = s.plan?.stop
        if (!stop) return { status: 'fail', message: '경로 위에 쉼터가 없어요.' }
        void rt.commitWaypoint(stop)
        return { status: 'success', message: `${stop.name}를 경유지로 추가했어요.` }
      }
      if (fn.includes('NAP')) {
        if (s.sig.speedKph > 1) return { status: 'fail', message: '정차 후 P단에서 시작할 수 있어요.' }
        rt.startNap(20)
        return { status: 'success', message: '20분 파워냅을 시작할게요.' }
      }
      return { status: 'fail', message: '지원하지 않는 요청이에요.' }
    })
    rt.subscribe((snap) => set({ snap }))
    set({ runtime: rt, scenario: sc })
    last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(250, now - last)
      last = now
      const { playing, timeScale } = get()
      if (isNative()) {
        nativeAcc += dt
        if (nativeAcc >= 1000) {
          rt.frame(nativeAcc, 1)
          nativeAcc = 0
        }
      } else if (playing) rt.frame(dt, timeScale)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
  },
  setPlaying: (playing) => set({ playing }),
  setTimeScale: (timeScale) => set({ timeScale }),
  carTheme: 'auto',
  setCarTheme: (carTheme) => set({ carTheme }),
  setAutoPilot: (autoPilot) => {
    const rt = get().runtime
    if (rt) rt.autoPilot = autoPilot
    set({ autoPilot })
  },
}))

// Read-only handle for on-device inspection (tools/emu/wv.cjs over WebView devtools in debug builds).
;(globalThis as { __cvStore?: typeof useSim }).__cvStore = useSim
