// SimVehicle: "밸류링크의 하루", a scripted day in the life of a 2025 IONIQ 5 Long Range, used by the web demo,
// the judges' console and the demo video. Physics is deliberately simple (speed profile, kWh in/out);
// what matters is that every signal arrives with the same keys the APK's SignalCollector sends, so the
// engine runs identically on the simulator and on the vehicle.

import { SIM_CAPS, type BusEvent, type VehicleBus } from './bus'
import type { ChargeSession } from './battery'
import type { LedgerEntry } from './guard'
import type { Block } from './passport'
import { Passport } from './passport'
import { dayKey } from './runtime'
import type { VehicleAction, VehicleSignals } from './types'

const PACK_KWH = 77.4
const KM_PER_KWH = 5.6
export const SIM_DELIVERED = new Date(2025, 2, 14).getTime()

interface Leg {
  name: string
  km: number
  cruiseKph: number
}

interface Step {
  /** minutes after the scenario start */
  at: number
  label: string
  run: (s: SimVehicle) => void
}

export interface ScenarioMark {
  at: number
  label: string
}

export class SimVehicle implements VehicleBus {
  readonly kind = 'sim' as const
  sig: VehicleSignals
  private start: number
  private leg: (Leg & { done: number }) | null = null
  private steps: Step[]
  private nextStep = 0
  private listeners = new Set<(e: BusEvent) => void>()
  private chargerKw = 0
  private harshQueue = 0
  marks: ScenarioMark[]
  /** Actions the engine asked for, for the console's SDK panel. */
  applied: { t: number; action: VehicleAction }[] = []

  constructor(startAt = dayAt(7, 50)) {
    this.start = startAt
    this.sig = {
      t: startAt,
      speedKph: 0,
      gear: 'P',
      parkingBrake: true,
      make: 'Hyundai',
      model: 'IONIQ 5',
      modelYear: 2025,
      fuelType: 'ev',
      vin: 'KMHKN81AFSU******',
      odometerKm: 24_812,
      wheelTickKm: 0,
      socPct: 81,
      rangeKm: 81 * (PACK_KWH / 100) * KM_PER_KWH,
      batteryCapWh: 75_900,
      batteryDesignWh: PACK_KWH * 1000,
      chargeState: 'idle',
      chargeKw: 0,
      plugged: false,
      chargeLimitPct: 80,
      chargeCurrentA: 32,
      warnings: [],
      airbagDeployed: false,
      adasWarnings: 41,
      overSpeedWarnings: 3,
      harshAccel: 0,
      harshBrake: 0,
      brakeEvents: 0,
      windowsOpen: 0,
      raining: false,
      headlightsOn: true,
      outsideTempC: 21,
      blindClosed: false,
      doorsLocked: true,
      position: [127.0276, 37.4979],
      driveMode: 'normal',
    }
    this.steps = DAY
    this.marks = DAY.map((s) => ({ at: s.at, label: s.label }))
  }

  capabilities() {
    return SIM_CAPS
  }

  read(): VehicleSignals {
    return { ...this.sig, warnings: [...(this.sig.warnings ?? [])] }
  }

  minutes() {
    return (this.sig.t - this.start) / 60_000
  }

  onEvent(fn: (e: BusEvent) => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  emit(e: BusEvent) {
    this.listeners.forEach((l) => l(e))
  }

  async apply(a: VehicleAction) {
    this.applied.unshift({ t: this.sig.t, action: a })
    const s = this.sig
    switch (a.kind) {
      case 'chargeLimit':
        s.chargeLimitPct = Number(a.value)
        break
      case 'chargeCurrent':
        s.chargeCurrentA = Number(a.value)
        break
      case 'closeWindows':
        s.windowsOpen = 0
        break
      case 'lightsAuto':
        s.headlightsOn = false
        break
      case 'lockDoors':
        s.doorsLocked = true
        break
      case 'blind':
        s.blindClosed = a.value === 'close'
        break
      case 'ambient':
        s.ambientColor = (a.value as { color?: string })?.color
        break
      case 'searchPlace':
        s.navScreen = `검색: ${a.value}`
        break
      case 'showChargers':
        s.navScreen = '주변 충전소'
        break
      case 'routeOption':
        s.navScreen = `경로 옵션: ${a.value}`
        break
    }
    return true
  }

  // ---- scenario controls (console) ----------------------------------------------------------------------

  drive(leg: Leg) {
    this.leg = { ...leg, done: 0 }
    this.sig.gear = 'D'
    this.sig.parkingBrake = false
    this.sig.doorsLocked = true
    this.sig.navScreen = undefined
  }

  park(place: string) {
    this.leg = null
    this.sig.speedKph = 0
    this.sig.gear = 'P'
    this.sig.parkingBrake = true
    this.sig.placeName = place
    this.sig.routeRemainingKm = undefined
    this.sig.routeEtaMin = undefined
    this.sig.navStatus = undefined
  }

  plugIn(kw: number) {
    this.sig.plugged = true
    this.chargerKw = kw
  }

  unplug() {
    this.sig.plugged = false
    this.sig.chargeState = 'idle'
    this.sig.chargeKw = 0
    this.chargerKw = 0
  }

  harsh(n = 1) {
    this.harshQueue += n
  }

  setWarning(type: string, on: boolean) {
    const w = (this.sig.warnings ?? []).filter((x) => x.type !== type)
    if (on) w.push({ type, state: 'ON', count: 1 })
    this.sig.warnings = w
  }

  /** Jump the clock to a scripted step (console "skip to"). */
  jumpTo(at: number) {
    while (this.nextStep < this.steps.length && this.steps[this.nextStep].at <= at) {
      const st = this.steps[this.nextStep++]
      this.sig.t = this.start + st.at * 60_000
      st.run(this)
    }
    if (this.leg) {
      // finish an in-progress leg instantly
      this.sig.odometerKm! += this.leg.km - this.leg.done
      this.sig.wheelTickKm! += (this.leg.km - this.leg.done) * 1.004
      this.park(this.leg.name)
    }
    this.sig.t = Math.max(this.sig.t, this.start + at * 60_000)
  }

  advance(dtMs: number) {
    const s = this.sig
    const dtH = dtMs / 3.6e6
    s.t += dtMs
    while (this.nextStep < this.steps.length && this.minutes() >= this.steps[this.nextStep].at) this.steps[this.nextStep++].run(this)

    // driving
    if (this.leg) {
      const leg = this.leg
      const left = leg.km - leg.done
      const target = left < 0.4 ? 18 : leg.cruiseKph * (0.92 + 0.08 * Math.sin(s.t / 9e4))
      const accel = this.harshQueue > 0 ? 14 : 6 // km/h per second
      const prev = s.speedKph
      const maxStep = (accel * dtMs) / 1000
      s.speedKph = Math.max(0, prev + Math.max(-maxStep * 1.4, Math.min(maxStep, target - prev)))
      if (this.harshQueue > 0 && s.speedKph - prev > 9 * (dtMs / 1000)) {
        s.harshAccel = (s.harshAccel ?? 0) + 1
        this.harshQueue--
      }
      const km = s.speedKph * dtH
      leg.done += km
      s.odometerKm! += km
      s.wheelTickKm! += km * 1.004
      s.tripKm = (s.tripKm ?? 0) + km
      s.socPct = Math.max(0, s.socPct! - (km / KM_PER_KWH / PACK_KWH) * 100)
      s.routeRemainingKm = Math.max(0, leg.km - leg.done)
      s.routeEtaMin = (s.routeRemainingKm / Math.max(20, leg.cruiseKph)) * 60
      s.navStatus = 'ROUTE_DRIVE'
      if (leg.done >= leg.km) this.park(leg.name)
    }

    // charging
    if (s.plugged) {
      const limit = s.chargeLimitPct ?? 100
      const acKw = Math.min(this.chargerKw, ((s.chargeCurrentA ?? 32) * 220) / 1000)
      const kw = this.chargerKw >= 50 ? this.chargerKw * (s.socPct! > 80 ? 0.35 : 1) : acKw
      if (s.socPct! < limit - 0.05) {
        s.chargeState = 'charging'
        s.chargeKw = kw
        s.socPct = Math.min(limit, s.socPct! + ((kw * dtH) / PACK_KWH) * 100)
        s.chargeMinLeft = (((limit - s.socPct) / 100) * PACK_KWH * 60) / Math.max(1, kw)
      } else {
        s.chargeState = 'full'
        s.chargeKw = 0
        s.chargeMinLeft = 0
      }
    }
    s.rangeKm = (s.socPct! / 100) * PACK_KWH * KM_PER_KWH
  }
}

// ---- the scripted day -------------------------------------------------------------------------------------

const DAY: Step[] = [
  { at: 0, label: '07:50 출근 준비 (아침 안개, 전조등 켜짐)', run: () => {} },
  {
    at: 10,
    label: '08:00 출근 주행 18km',
    run: (s) => {
      s.drive({ name: '회사 주차장', km: 18, cruiseKph: 52 })
      s.sig.routeRemainingKm = 18
    },
  },
  { at: 13, label: '08:03 급출발 2회', run: (s) => s.harsh(2) },
  {
    at: 34,
    label: '08:24 회사 도착, 전조등 켜진 채 주차',
    run: (s) => {
      s.park('회사 주차장')
      s.sig.headlightsOn = true
      s.sig.windowsOpen = 1
    },
  },
  {
    at: 220,
    label: '11:30 한낮 29℃ 땡볕',
    run: (s) => {
      s.sig.outsideTempC = 29
      s.sig.headlightsOn = false
    },
  },
  {
    at: 430,
    label: '15:00 소나기, 창문 하나 열림',
    run: (s) => {
      s.sig.raining = true
      s.sig.outsideTempC = 23
    },
  },
  { at: 520, label: '16:30 비 그침', run: (s) => (s.sig.raining = false) },
  {
    at: 640,
    label: '18:30 퇴근 주행',
    run: (s) => {
      s.sig.blindClosed = false
      s.drive({ name: '블루핸즈 강남점', km: 9, cruiseKph: 38 })
      s.sig.routeRemainingKm = 9
    },
  },
  { at: 648, label: '18:38 타이어 공기압 경고등', run: (s) => s.setWarning('TPMS', true) },
  {
    at: 690,
    label: '19:20 블루핸즈 점검 완료',
    run: (s) => {
      s.setWarning('TPMS', false)
      s.drive({ name: '집', km: 11, cruiseKph: 42 })
      s.sig.routeRemainingKm = 11
    },
  },
  {
    at: 720,
    label: '19:50 집 도착, 완속 충전 시작 (상한 100%)',
    run: (s) => {
      s.park('집')
      s.sig.chargeLimitPct = 100
      s.plugIn(7)
    },
  },
  {
    at: 820,
    label: '21:30 내일 부산 일정, 내비 목적지 395km',
    run: (s) => {
      s.sig.routeRemainingKm = 395
      s.sig.routeEtaMin = 290
      s.sig.navStatus = 'ROUTE_READY'
    },
  },
  { at: 1080, label: '01:50 충전 완료', run: () => {} },
]

/** Today at hh:mm local time. */
export function dayAt(h: number, m: number) {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

function mulberry(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- history since delivery (deterministic) ---------------------------------------------------------------

export interface SimHistory {
  blocks: Block[]
  ledger: LedgerEntry[]
  sessions: ChargeSession[]
}

/** About 20 months of daily passport blocks, last month's charge sessions and the guard's past work. */
export function simHistory(until: number, odometerKm: number, sohNow: number): SimHistory {
  const rnd = mulberry(42)
  const p = new Passport()
  const days = Math.floor((until - SIM_DELIVERED) / 864e5)
  const kmPerDay = odometerKm / Math.max(1, days)
  let odo = 0
  let wheel = 0
  for (let d = 0; d < days; d++) {
    const t = SIM_DELIVERED + d * 864e5
    const km = Math.max(0, kmPerDay * (0.4 + 1.2 * rnd()) * (new Date(t).getDay() % 6 === 0 ? 0.5 : 1))
    odo += km
    wheel += km * (1 + (rnd() - 0.5) * 0.004)
    const soh = 100 - ((100 - sohNow) * d) / days
    p.append({
      day: dayKey(t),
      odometerKm: odo,
      wheelKm: wheel,
      sohPct: soh,
      warnings: d === 211 ? ['LOW_VOLT_BATTERY'] : [],
      charges: d % 3 === 0 ? 1 : 0,
      fastCharges: d % 17 === 0 ? 1 : 0,
      guards: d % 3 === 0 ? 1 : 0,
      harsh: Math.round(rnd() * 2),
    })
  }
  // rescale so the last block meets today's odometer exactly
  const k = odometerKm / Math.max(1, odo)
  for (const b of p.blocks) {
    b.odometerKm *= k
    b.wheelKm *= k
  }
  const blocks = new Passport()
  for (const b of p.blocks) {
    const { i: _i, prev: _p, hash: _h, ...rec } = b
    blocks.append(rec)
  }

  const sessions: ChargeSession[] = []
  for (let d = 30; d >= 1; d -= 2) {
    const end = until - d * 864e5 + 6 * 3.6e6
    const fast = d % 9 === 0
    sessions.push({ start: end - 5 * 3.6e6, end, startSoc: 30 + Math.round(rnd() * 30), endSoc: fast ? 80 : d % 13 === 0 ? 100 : 80, maxKw: fast ? 180 : 7, fast, hot: false, limitPct: 80 })
  }

  const ledger: LedgerEntry[] = []
  let id = 0
  const month0 = new Date(until)
  month0.setDate(1)
  month0.setHours(0, 0, 0, 0)
  for (let t = until - 300 * 864e5; t < until - 864e5; t += 864e5 * (2 + Math.floor(rnd() * 3))) {
    ledger.unshift({
      id: `h${id++}`,
      t: t + 20 * 3.6e6,
      kind: 'chargeCap',
      title: '충전 상한 100% → 80%',
      detail: '완충 상태로 밤새 두지 않도록 차가 직접 맞췄어요.',
      won: 2_380,
      basis: '완충 1회 회피 ≈ SOH +0.0060%p × 1%p당 차량가 1.2%',
      sdk: ['EvBattery.setEvChargePercentLimit(80) ✓'],
      say: '',
      auto: true,
    })
  }
  ledger.unshift({ id: `h${id++}`, t: until - 96 * 864e5, kind: 'rainWindows', title: '비 오는데 창문 열림 → 자동으로 닫음', detail: '실내 침수를 막았어요.', won: 150_000, basis: '실내 습기 제거·시트 클리닝 평균 비용 [가정 15만원]', sdk: ['Window.setWindowPosition ✓'], say: '', auto: true })
  ledger.unshift({ id: `h${id++}`, t: until - 41 * 864e5, kind: 'lightsLeftOn', title: '주차 후 전조등 켜짐 → 자동 모드로 전환', detail: '12V 배터리 방전을 막았어요.', won: 30_000, basis: '12V 배터리 교체·긴급출동 비용의 기대값 [가정 3만원]', sdk: ['Light.setLowBeamLightSwitch(AUTOMATIC) ✓'], say: '', auto: true })
  ledger.sort((a, b) => b.t - a.t)
  return { blocks: blocks.blocks, ledger, sessions }
}
