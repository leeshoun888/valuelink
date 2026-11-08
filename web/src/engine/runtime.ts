// Runtime: wires a VehicleBus to the value engine (valuation, battery, habits, passport, guard),
// executes guard actions, and publishes immutable snapshots for the UI.

import type { BusEvent, Capabilities, VehicleBus } from './bus'
import { annualFade, AVG_HABITS, BatteryTracker, stateOfHealth, type BatteryHabits, type ChargeSession } from './battery'
import { RULES, warningName, type GuardKind, type LedgerEntry, type Suggestion } from './guard'
import { HabitTracker, type HabitStats } from './habits'
import { Passport, type PassportCheck } from './passport'
import type { Bookmark, VehicleAction, VehicleSignals } from './types'
import { ageCurve, expectedSoh, identify, KM_PER_YEAR, valuate, VALUE_PER_SOH_POINT, type CarModel, type Valuation } from './valuation'

export type Mode = 'driving' | 'parked' | 'charging'

export interface ProjectionPoint {
  month: number
  mine: number
  average: number
}

export interface Snapshot {
  sig: VehicleSignals
  caps: Capabilities
  mode: Mode
  model: CarModel
  ageYears: number
  value: Valuation
  /** 원 protected by the guard and habits this calendar month / since install. */
  protectedMonth: number
  protectedTotal: number
  projection: ProjectionPoint[]
  battery: {
    soh: number
    sohSource: 'car' | 'estimate'
    expected: number
    fadeMine: number
    fadeAverage: number
    habits: BatteryHabits
    charging: ChargeSession | null
    lastSession: ChargeSession | null
  }
  habits: HabitStats
  passport: PassportCheck & { odometerKm: number; wheelKm: number; since: string }
  ledger: LedgerEntry[]
  suggestion: Suggestion | null
  warnings: { type: string; name: string; count: number }[]
  tradeIn: { price: number; validDays: number; premium: number } | null
  speaking: string | null
}

export interface RuntimeHooks {
  speak?: (text: string) => void
}

export interface RuntimeOptions {
  /** Delivery date of the car; defaults to March of the reported model year. */
  deliveredAt?: number
  /** localStorage key; when set, passport / ledger / charge sessions survive restarts (APK). */
  persistKey?: string
}

const HORIZON_MONTHS = 36
const RULE_TICK_MS = 1_000

export class Runtime {
  bus: VehicleBus
  battery = new BatteryTracker()
  habitsTracker = new HabitTracker()
  passport = new Passport()
  ledger: LedgerEntry[] = []
  suggestion: Suggestion | null = null
  hooks: RuntimeHooks = {}
  speaking: string | null = null
  bookmarks: Bookmark[] = []
  /** Odometer-free distance when the car does not report one (integrated speed). */
  private drivenKm = 0
  private lastT = 0
  private parkedSince: number | null = null
  private lastFired = new Map<GuardKind, number>()
  private knownWarnings = new Set<string>()
  private lastHarsh = 0
  private ruleAcc = 0
  private seq = 0
  private opts: RuntimeOptions
  private listeners = new Set<(s: Snapshot) => void>()
  private snap: Snapshot | null = null
  private saveAcc = 0

  constructor(bus: VehicleBus, opts: RuntimeOptions = {}) {
    this.bus = bus
    this.opts = opts
    this.load()
    bus.onEvent?.((e) => this.onBusEvent(e))
    this.lastT = bus.read().t
  }

  private onBusEvent(e: BusEvent) {
    if (e.type === 'bookmarks') this.bookmarks = e.items
  }

  subscribe(fn: (s: Snapshot) => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  get deliveredAt() {
    if (this.opts.deliveredAt) return this.opts.deliveredAt
    const y = this.bus.read().modelYear ?? new Date().getFullYear() - 1
    return new Date(y, 2, 1).getTime()
  }

  /** Advance by dtMs of vehicle time (the simulator is advanced first; the APK reads live signals). */
  tick(dtMs: number) {
    this.bus.advance?.(dtMs)
    const sig = this.bus.read()
    const dt = Math.max(0, sig.t - this.lastT)
    this.lastT = sig.t
    this.drivenKm += (Math.max(0, sig.speedKph) * Math.min(dt, 60_000)) / 3.6e6

    const parked = sig.gear === 'P' && sig.speedKph < 1
    if (parked && this.parkedSince === null) this.parkedSince = sig.t
    if (!parked) this.parkedSince = null

    this.battery.update(sig)
    this.habitsTracker.update(sig, this.drivenKm)

    this.ruleAcc += dt
    if (this.ruleAcc >= RULE_TICK_MS) {
      this.ruleAcc = 0
      this.runGuard(sig)
    }
    this.sealPassport(sig)
    this.publish(sig)
    this.saveAcc += dt
    if (this.saveAcc > 30_000) {
      this.saveAcc = 0
      this.save()
    }
  }

  // ---- guard --------------------------------------------------------------------------------------------

  private runGuard(sig: VehicleSignals) {
    const current = (sig.warnings ?? []).map((w) => w.type)
    const newWarnings = current.filter((w) => !this.knownWarnings.has(w))
    for (const w of [...this.knownWarnings]) if (!current.includes(w)) this.onWarningCleared(w, sig)
    this.knownWarnings = new Set(current)
    const harsh = (sig.harshAccel ?? 0) + (sig.harshBrake ?? 0)
    const harshDelta = harsh - this.lastHarsh
    const value = this.snap?.value.value ?? this.valueNow(sig).value
    const ctx = {
      sig,
      valueManwon: value,
      rangeAtLimitKm: this.rangeAt(sig, 80),
      parkedForSec: this.parkedSince === null ? 0 : (sig.t - this.parkedSince) / 1000,
      newWarnings,
      harshDelta,
    }
    for (const rule of RULES) {
      const last = this.lastFired.get(rule.kind) ?? -Infinity
      if (sig.t - last < rule.cooldownMs) continue
      const r = rule.test(ctx)
      if (!r) continue
      this.lastFired.set(rule.kind, sig.t)
      if (rule.kind === 'harshDriving') this.lastHarsh = harsh
      void this.execute(r.actions, r.entry, sig.t)
      if (r.suggestion) this.suggestion = r.suggestion
    }
    if (harshDelta < 0) this.lastHarsh = harsh
  }

  private async execute(actions: VehicleAction[], entry: Omit<LedgerEntry, 'id' | 't' | 'sdk' | 'auto'>, t: number) {
    const sdk: string[] = []
    let auto = actions.length > 0
    for (const a of actions) {
      const ok = await this.bus.apply(a)
      sdk.push(`${SDK_CALL[a.kind]}${a.value !== undefined ? `(${a.value})` : ''} ${ok ? '✓' : '→ 미지원·미승인: 음성 안내로 대체'}`)
      if (!ok) auto = false
    }
    const say = auto || !actions.length ? entry.say : `${entry.title.split('→')[0].trim()}. 직접 확인해 주세요.`
    const e: LedgerEntry = { ...entry, say, id: `g${++this.seq}`, t, sdk, auto, won: auto || entry.kind === 'warningLamp' ? entry.won : 0 }
    // A lamp is only "protected" once it is fixed; until then the entry records the risk.
    if (entry.kind === 'warningLamp') e.won = 0
    this.ledger.unshift(e)
    this.ledger = this.ledger.slice(0, 200)
    this.say(say)
  }

  private onWarningCleared(type: string, sig: VehicleSignals) {
    const value = this.snap?.value.value ?? this.valueNow(sig).value
    if (this.suggestion?.kind === 'warningLamp') this.suggestion = null
    this.ledger.unshift({
      id: `g${++this.seq}`,
      t: sig.t,
      kind: 'warningLamp',
      title: `${warningName(type)} 경고등 해결`,
      detail: '점검 완료가 차량 여권에 기록됐어요. 감가 요인이 사라졌어요.',
      won: value * 10_000 * 0.02,
      basis: '경고등 1개 미해결 = 차량가 −2% [가정] 회복',
      sdk: ['Safety.getTelltalesInfo → OFF'],
      say: `${warningName(type)} 경고등이 꺼졌어요. 점검 기록을 여권에 남겼어요.`,
      auto: true,
    })
  }

  /** Accept the current suggestion's call to action (driver tapped, or said yes). */
  async accept() {
    const s = this.suggestion
    if (!s?.cta) return false
    this.suggestion = null
    const ok = await this.bus.apply(s.cta.action)
    this.say(ok ? `${s.cta.label}를 열었어요.` : '내비를 열 수 없어요.')
    return ok
  }

  dismiss() {
    this.suggestion = null
  }

  /** Driver-initiated charge limit (Gleo SET_CHARGE_LIMIT, card buttons). */
  async setChargeLimit(pct: number) {
    const ok = await this.bus.apply({ kind: 'chargeLimit', value: pct, reason: '운전자 요청' })
    this.say(ok ? `충전 상한을 ${pct}%로 맞췄어요.` : `충전 설정에서 ${pct}%로 맞춰 주세요.`)
    return ok
  }

  async lockDoors() {
    const ok = await this.bus.apply({ kind: 'lockDoors', reason: '운전자 요청' })
    this.say(ok ? '문을 잠갔어요.' : '문 잠금은 이 차에서 지원되지 않아요.')
    return ok
  }

  async findService() {
    return this.bus.apply({ kind: 'searchPlace', value: '블루핸즈', reason: '운전자 요청' })
  }

  private say(text: string) {
    this.speaking = text
    this.hooks.speak?.(text)
  }

  // ---- passport -----------------------------------------------------------------------------------------

  private sealPassport(sig: VehicleSignals) {
    const day = dayKey(sig.t)
    const last = this.passport.blocks.at(-1)
    if (last && last.day === day && sig.t % 60_000 > 2_000) return // refresh once a minute
    const odo = sig.odometerKm ?? this.drivenKm
    const soh = stateOfHealth(sig, this.ageYears(sig.t)).soh
    const todays = this.ledger.filter((e) => dayKey(e.t) === day)
    const sessions = this.battery.sessions.filter((s) => dayKey(s.end) === day)
    this.passport.upsertToday({
      day,
      odometerKm: odo,
      wheelKm: sig.wheelTickKm !== undefined ? this.wheelBase(odo, sig.wheelTickKm) : odo,
      sohPct: soh,
      warnings: (sig.warnings ?? []).map((w) => w.type),
      charges: sessions.length,
      fastCharges: sessions.filter((s) => s.fast).length,
      guards: todays.filter((e) => e.auto).length,
      harsh: (sig.harshAccel ?? 0) + (sig.harshBrake ?? 0),
    })
  }

  /** WHEEL_TICK is relative to app start; anchor it to the odometer at that moment. */
  private wheelAnchor: number | null = null
  private wheelBase(odo: number, tickKm: number) {
    if (this.wheelAnchor === null) this.wheelAnchor = odo - tickKm
    return this.wheelAnchor + tickKm
  }

  // ---- valuation ----------------------------------------------------------------------------------------

  ageYears(t: number) {
    return Math.max(0, (t - this.deliveredAt) / (365.25 * 864e5))
  }

  private valueNow(sig: VehicleSignals): Valuation {
    const model = identify(sig)
    const age = this.ageYears(sig.t)
    const check = this.passport.verify()
    return valuate({
      model,
      ageYears: age,
      odometerKm: sig.odometerKm ?? this.drivenKm,
      sohPct: model.ev ? stateOfHealth(sig, age).soh : undefined,
      activeWarnings: sig.warnings?.length ?? 0,
      airbagDeployed: sig.airbagDeployed === true,
      wearIndex: this.habitsTracker.stats().wearIndex,
      passportDays: check.chainOk && check.mileageOk ? check.days : 0,
    })
  }

  private rangeAt(sig: VehicleSignals, pct: number) {
    if (sig.rangeKm === undefined || !sig.socPct) return undefined
    return (sig.rangeKm / sig.socPct) * pct
  }

  /** Value over the next three years: the driver's habits vs the average driver's. */
  private project(sig: VehicleSignals, model: CarModel, soh: number, fadeMine: number, fadeAvg: number, wearIndex: number): ProjectionPoint[] {
    const age0 = this.ageYears(sig.t)
    const odo0 = sig.odometerKm ?? this.drivenKm
    const pts: ProjectionPoint[] = []
    for (let m = 0; m <= HORIZON_MONTHS; m += 3) {
      const age = age0 + m / 12
      const odo = odo0 + (KM_PER_YEAR * m) / 12
      const base = model.basePrice * ageCurve(age)
      const mileage = Math.max(-0.12, Math.min(0.08, (-(odo - KM_PER_YEAR * age) / 10_000) * 0.02))
      const sohAt = (fade: number) => (model.ev ? soh - (fade * m) / 12 : expectedSoh(age))
      const batt = (fade: number) => (model.ev ? Math.max(-0.15, Math.min(0.06, (sohAt(fade) - expectedSoh(age)) * VALUE_PER_SOH_POINT)) : 0)
      pts.push({
        month: m,
        mine: base * (1 + mileage) * (1 + batt(fadeMine)) * (1 - 0.03 * wearIndex) * 1.015,
        average: base * (1 + mileage) * (1 + batt(fadeAvg)) * (1 - 0.03 * 0.5),
      })
    }
    return pts
  }

  private publish(sig: VehicleSignals) {
    const caps = this.bus.capabilities()
    const model = identify(sig)
    const age = this.ageYears(sig.t)
    const value = this.valueNow(sig)
    const { soh, source } = stateOfHealth(sig, age)
    const habits = this.battery.habits(30 * 864e5, sig.t)
    const fadeMine = annualFade(habits)
    const fadeAverage = annualFade(AVG_HABITS)
    const hs = this.habitsTracker.stats()
    const check = this.passport.verify()
    const month = new Date(sig.t).getMonth()
    const protectedMonth = this.ledger.filter((e) => new Date(e.t).getMonth() === month).reduce((a, e) => a + e.won, 0)
    const protectedTotal = this.ledger.reduce((a, e) => a + e.won, 0)
    const charging = sig.chargeState === 'charging' || (sig.chargeKw ?? 0) > 0.5
    const mode: Mode = sig.speedKph > 1 || sig.gear !== 'P' ? 'driving' : charging || sig.plugged ? 'charging' : 'parked'
    const premium = check.chainOk && check.mileageOk && check.days >= 30 ? 0.02 : 0
    const first = this.passport.blocks[0]
    const last = this.passport.blocks.at(-1)
    this.snap = {
      sig,
      caps,
      mode,
      model,
      ageYears: age,
      value,
      protectedMonth,
      protectedTotal,
      projection: this.project(sig, model, soh, fadeMine, fadeAverage, hs.wearIndex),
      battery: {
        soh,
        sohSource: source,
        expected: expectedSoh(age),
        fadeMine,
        fadeAverage,
        habits,
        charging: this.battery.charging,
        lastSession: this.battery.sessions.at(-1) ?? null,
      },
      habits: hs,
      passport: { ...check, odometerKm: last?.odometerKm ?? 0, wheelKm: last?.wheelKm ?? 0, since: first?.day ?? dayKey(sig.t) },
      ledger: this.ledger.slice(0, 40),
      suggestion: this.suggestion,
      warnings: (sig.warnings ?? []).map((w) => ({ type: w.type, name: warningName(w.type), count: w.count })),
      tradeIn: mode === 'driving' ? null : { price: Math.round((value.value * (1 + premium)) / 10) * 10, validDays: 7, premium },
      speaking: this.speaking,
    }
    this.listeners.forEach((l) => l(this.snap!))
  }

  snapshot() {
    return this.snap
  }

  // ---- persistence (APK) --------------------------------------------------------------------------------

  private save() {
    const key = this.opts.persistKey
    if (!key) return
    try {
      localStorage.setItem(key, JSON.stringify({ blocks: this.passport.blocks, ledger: this.ledger, sessions: this.battery.sessions }))
    } catch {
      /* storage unavailable */
    }
  }

  private load() {
    const key = this.opts.persistKey
    if (!key) return
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return
      const d = JSON.parse(raw)
      this.passport.blocks = d.blocks ?? []
      this.ledger = d.ledger ?? []
      this.battery.sessions = d.sessions ?? []
    } catch {
      /* corrupt or unavailable */
    }
  }

  /** Seeds history (demo / judges): passport blocks, past charge sessions and ledger entries. */
  seed(history: { blocks?: Passport['blocks']; ledger?: LedgerEntry[]; sessions?: ChargeSession[] }) {
    if (history.blocks) this.passport.blocks = history.blocks
    if (history.ledger) this.ledger = history.ledger
    if (history.sessions) this.battery.sessions = history.sessions
    this.save()
  }
}

export const SDK_CALL: Record<VehicleAction['kind'], string> = {
  chargeLimit: 'EvBattery.setEvChargePercentLimit',
  chargeCurrent: 'EvBattery.setEvChargeCurrentDrawLimit',
  closeWindows: 'Window.setWindowPosition',
  lightsAuto: 'Light.setLowBeamLightSwitch',
  lockDoors: 'Door.setDoorLock',
  blind: 'Window.moveWindowBlind',
  ambient: 'Light.setAmbientLightBrightnessColor',
  searchPlace: 'NaviHelper.requestNavigationScreen(SearchPlace)',
  routeOption: 'NaviHelper.changeRouteOption',
  showChargers: 'NaviHelper.requestNavigationScreen(NearbyChargingStations)',
}

export function dayKey(t: number) {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
