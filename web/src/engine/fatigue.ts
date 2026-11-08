// Fatigue estimator built on the Three-Process Model of alertness
// (Åkerstedt & Folkard; Process S = homeostatic sleep pressure, Process C = circadian),
// mapped to the Karolinska Sleepiness Scale (KSS ≈ 10.6 − 0.6·(S + C)),
// then extended with driving-specific evidence:
//   time-on-task, highway monotony, cabin CO2, thermal load,
//   a voice reaction-time probe (PVT-style) and the vehicle's own attention warning.
// Every term is reported as an explainable KSS contribution.

import type { Contribution, DriverProfile, FatigueEstimate, ProbeResult, RiskLevel, VehicleSignals } from './types'

const LA = 2.4 // lower asymptote of S while awake
const HA = 14.3 // upper asymptote of S during sleep
const WAKE_DECAY = 0.0353 // 1/h
const SLEEP_RECOVERY = 0.381 // 1/h
const C_AMP = 2.5
const C_ACROPHASE = 16.8 // hour of day of circadian alertness peak

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const hourOfDay = (t: number) => {
  const d = new Date(t)
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}

export function circadian(t: number, chronotype = 0): number {
  const h = hourOfDay(t)
  return C_AMP * Math.cos((2 * Math.PI * (h - (C_ACROPHASE + chronotype * 1.5))) / 24)
}

/** S at wake-up after `sleepHours` of sleep, starting from a typical bedtime level. */
export function sAfterSleep(sleepHours: number): number {
  const sBed = 7.0
  return HA - (HA - sBed) * Math.exp(-SLEEP_RECOVERY * sleepHours)
}

export function kssFromAlertness(a: number): number {
  return clamp(10.6 - 0.6 * a, 1, 9)
}

export function levelFromKss(kss: number): RiskLevel {
  if (kss >= 8) return 4
  if (kss >= 7) return 3
  if (kss >= 6) return 2
  if (kss >= 5) return 1
  return 0
}

/** Probe reaction time → implied KSS (fitted to PVT literature: ~250 ms alert, lapses >500 ms). */
export function kssFromReaction(ms: number, lapse: boolean): number {
  const k = 1 + (ms - 200) / 45
  return clamp(lapse ? Math.max(k, 7.6) : k, 1, 9)
}

interface Transient {
  key: 'engage' | 'cool' | 'nap'
  amount: number // KSS reduction (positive number)
  t0: number
  halfLifeMin: number
  active?: boolean
}

export class FatigueModel {
  S: number
  timeOnTaskMin = 0
  restMin = 0
  monotony = 0
  probes: ProbeResult[] = []
  transients: Transient[] = []
  lastT: number
  napping = false
  private last?: VehicleSignals
  private readonly profile: DriverProfile

  constructor(profile: DriverProfile, now: number) {
    this.profile = profile
    const s0 = sAfterSleep(profile.sleepHours)
    const awakeH = Math.max(0, (now - profile.wakeTime) / 3.6e6)
    this.S = LA + (s0 - LA) * Math.exp(-WAKE_DECAY * awakeH)
    this.lastT = now
  }

  step(sig: VehicleSignals, co2Ppm: number) {
    const dtMin = Math.max(0, (sig.t - this.lastT) / 60000)
    this.lastT = sig.t
    if (dtMin === 0) {
      this.last = sig
      return
    }
    const dtH = dtMin / 60
    // Process S
    if (this.napping) this.S = HA - (HA - this.S) * Math.exp(-SLEEP_RECOVERY * 1.6 * dtH) // short naps: fast early recovery (slow-wave avoided)
    else this.S = LA + (this.S - LA) * Math.exp(-WAKE_DECAY * dtH)

    // Time on task: driving accumulates; a stop ≥15 min resets it (break rule used in fleet regulation).
    const moving = sig.speedKph > 3
    if (moving) {
      this.timeOnTaskMin += dtMin
      this.restMin = 0
    } else if (sig.gear === 'P' || sig.parkingBrake) {
      this.restMin += dtMin
      this.timeOnTaskMin = Math.max(0, this.timeOnTaskMin * Math.exp(-dtMin / 6))
      if (this.restMin >= 15) this.timeOnTaskMin = 0
    }

    // Monotony: exponential moving average of highway cruising with few control inputs.
    const prevTurn = this.last?.turnSignalEvents ?? sig.turnSignalEvents ?? 0
    const turnRate = Math.max(0, (sig.turnSignalEvents ?? 0) - prevTurn) / dtMin
    const raw =
      (sig.roadClass === 'highway' ? 0.45 : sig.roadClass === 'rural' ? 0.25 : 0.05) +
      (sig.cruiseOn ? 0.25 : 0) +
      (sig.speedKph > 70 ? 0.15 : 0) +
      0.15 * (1 - clamp(sig.steeringActivity ?? 0.4, 0, 1)) -
      clamp(turnRate * 0.6, 0, 0.3)
    const alpha = 1 - Math.exp(-dtMin / 12)
    this.monotony = clamp(this.monotony + alpha * (clamp(raw, 0, 1) - this.monotony), 0, 1)

    this.transients = this.transients.filter((x) => x.active || sig.t - x.t0 < x.halfLifeMin * 6e4 * 5)
    this.last = sig
    void co2Ppm
  }

  addProbe(p: ProbeResult) {
    this.probes.push(p)
    if (this.probes.length > 20) this.probes.shift()
  }

  boost(key: Transient['key'], amount: number, t: number, halfLifeMin: number, active = false) {
    this.transients = this.transients.filter((x) => x.key !== key)
    this.transients.push({ key, amount, t0: t, halfLifeMin, active })
  }

  endBoost(key: Transient['key'], t: number) {
    const tr = this.transients.find((x) => x.key === key)
    if (tr) {
      tr.active = false
      tr.t0 = t
    }
  }

  /** Total countermeasure effect (negative KSS) at time t; active transients assumed to end now. */
  countermeasureAt(t: number, now: number): number {
    let c = 0
    for (const x of this.transients) {
      const t0 = x.active ? now : x.t0
      const age = Math.max(0, (t - t0) / 6e4)
      c -= x.amount * Math.pow(0.5, age / x.halfLifeMin)
    }
    return c
  }

  setNapping(on: boolean) {
    this.napping = on
  }

  estimate(sig: VehicleSignals, co2Ppm: number): FatigueEstimate {
    const t = sig.t
    const C = circadian(t, this.profile.chronotype)
    const base = kssFromAlertness(this.S + C)
    // Linear decomposition around a well-rested reference of KSS 3.
    const sOnly = 10.6 - 0.6 * this.S - 3
    const cOnly = -0.6 * C
    const h = hourOfDay(t)
    const postLunch = 0.7 * Math.exp(-((h - 14.5) ** 2) / (2 * 1.1 ** 2))
    const tot = Math.min(2.4, 0.36 * (this.timeOnTaskMin / 60) * (1 + 0.8 * this.monotony))
    const mono = 0.6 * this.monotony
    const co2 = clamp((co2Ppm - 1000) / 1000, 0, 1.6) * 0.55
    const cabin = sig.cabinTempC ?? sig.setTempC
    const thermal = clamp((cabin - 23) * 0.18, 0, 0.9)
    // Pleos listeners: driving in the dark (low beam on) and contact warmth (seat / wheel heating).
    const darkness = sig.headlightsOn ? 0.15 : 0
    const warmth = clamp(((sig.seatHeat ?? 0) + (sig.wheelHeat ?? 0)) * 0.08, 0, 0.3)

    let countermeasure = 0
    for (const x of this.transients) {
      const age = x.active ? 0 : (t - x.t0) / 6e4
      countermeasure -= x.amount * Math.pow(0.5, age / x.halfLifeMin)
    }

    let kss = base + postLunch + tot + mono + co2 + thermal + darkness + warmth + countermeasure

    // Probe fusion: recent probes pull the estimate toward the measured value (weight decays over 25 min).
    let probeDelta = 0
    let confidence = 0.55
    const recent = this.probes.filter((p) => t - p.t < 25 * 6e4)
    if (recent.length) {
      let wsum = 0
      let ksum = 0
      for (const p of recent) {
        const w = Math.exp(-(t - p.t) / (12 * 6e4)) * (p.correct ? 1 : 1.3)
        wsum += w
        ksum += w * kssFromReaction(p.reactionMs, p.lapse)
      }
      const measured = ksum / wsum
      const w = clamp(wsum * 0.45, 0, 0.7)
      probeDelta = w * (measured - kss)
      kss += probeDelta
      confidence = clamp(0.55 + w * 0.5, 0, 0.95)
    }

    let dawDelta = 0
    // The vehicle's own warnings (DAW telltale, DMS camera drowsiness) override the model upward.
    if (sig.dawWarning || sig.dmsDrowsy) {
      dawDelta = Math.max(0, 7.4 - kss)
      kss += dawDelta
      confidence = Math.max(confidence, 0.9)
    }
    kss = clamp(kss, 1, 9)

    const contributions: Contribution[] = [
      { key: 'sleepPressure', label: '수면 압력(깨어있던 시간)', value: sOnly },
      { key: 'circadian', label: '생체리듬(시간대)', value: cOnly },
      { key: 'postLunch', label: '식후 저각성 구간', value: postLunch },
      { key: 'timeOnTask', label: '연속 운전 시간', value: tot },
      { key: 'monotony', label: '도로 단조로움', value: mono },
      { key: 'co2', label: '실내 CO₂', value: co2 },
      { key: 'thermal', label: '실내 온열 부하', value: thermal },
      { key: 'darkness', label: '야간 주행(전조등)', value: darkness },
      { key: 'warmth', label: '시트·스티어링 열선', value: warmth },
      { key: 'probe', label: '음성 반응속도 측정', value: probeDelta },
      { key: 'daw', label: '차량 주의 경고', value: dawDelta },
      { key: 'countermeasure', label: '깨움 개입 효과', value: countermeasure },
    ]

    return {
      kss,
      level: levelFromKss(kss),
      confidence,
      contributions,
      minutesToDanger: this.forecastMinutesToDanger(sig, co2Ppm, kss),
    }
  }

  /** Projects the current trajectory forward (no new countermeasures) and returns minutes until KSS ≥ 7. */
  forecastMinutesToDanger(sig: VehicleSignals, co2Ppm: number, nowKss: number, threshold = 7): number | null {
    if (nowKss >= threshold) return 0
    let S = this.S
    let tot = this.timeOnTaskMin
    const C0 = circadian(sig.t, this.profile.chronotype)
    const base0 = kssFromAlertness(this.S + C0)
    const cm0 = this.countermeasureAt(sig.t, sig.t)
    const offset = nowKss - base0 - Math.min(2.4, 0.36 * (tot / 60) * (1 + 0.8 * this.monotony)) - cm0
    for (let m = 1; m <= 360; m += 1) {
      S = LA + (S - LA) * Math.exp(-WAKE_DECAY / 60)
      tot += 1
      const tt = sig.t + m * 6e4
      const h = hourOfDay(tt)
      const pl = 0.7 * Math.exp(-((h - 14.5) ** 2) / (2 * 1.1 ** 2))
      const plNow = 0.7 * Math.exp(-((hourOfDay(sig.t) - 14.5) ** 2) / (2 * 1.1 ** 2))
      const k =
        kssFromAlertness(S + circadian(tt, this.profile.chronotype)) +
        Math.min(2.4, 0.36 * (tot / 60) * (1 + 0.8 * this.monotony)) +
        offset +
        this.countermeasureAt(tt, sig.t) +
        (pl - plNow)
      if (k >= threshold) return m
    }
    void co2Ppm
    return null
  }

  /** Forecast KSS curve for the next `minutes` assuming continuous driving (used by the rest planner). */
  forecastCurve(sig: VehicleSignals, nowKss: number, minutes: number, stepMin = 5): { min: number; kss: number }[] {
    const out: { min: number; kss: number }[] = [{ min: 0, kss: nowKss }]
    let S = this.S
    let tot = this.timeOnTaskMin
    const base0 = kssFromAlertness(this.S + circadian(sig.t, this.profile.chronotype))
    const offset = nowKss - base0 - Math.min(2.4, 0.36 * (tot / 60) * (1 + 0.8 * this.monotony)) - this.countermeasureAt(sig.t, sig.t)
    for (let m = stepMin; m <= minutes; m += stepMin) {
      S = LA + (S - LA) * Math.exp((-WAKE_DECAY * stepMin) / 60)
      tot += stepMin
      const tt = sig.t + m * 6e4
      const k =
        kssFromAlertness(S + circadian(tt, this.profile.chronotype)) +
        Math.min(2.4, 0.36 * (tot / 60) * (1 + 0.8 * this.monotony)) +
        offset +
        this.countermeasureAt(tt, sig.t)
      out.push({ min: m, kss: clamp(k, 1, 9) })
    }
    return out
  }
}
