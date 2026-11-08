// Battery health and charging habits.
//
// State of health comes from the car itself when it reports EV_CURRENT_BATTERY_CAPACITY and
// INFO_EV_BATTERY_CAPACITY (verified on the Pleos emulator: 77,000 / 77,400 Wh). Habits are learned from
// charge sessions (EV_CHARGE_STATE, charge rate, SoC before/after) and parked time at high SoC.
//
// Projected fade per year [assumptions, after published fleet studies: heat, DC fast charging and long
// dwell at high state of charge accelerate fade]:
//   base 1.5 %p + 1.4 × DC-fast share + 0.9 × share of sessions ending ≥ 95 % + 0.4 × hot-charging share
// The "average driver" (fast 35 %, full 55 %, hot 10 %) lands at 2.5 %p.

import type { VehicleSignals } from './types'

export interface ChargeSession {
  start: number
  end: number
  startSoc: number
  endSoc: number
  maxKw: number
  fast: boolean
  hot: boolean
  limitPct?: number
}

export interface BatteryHabits {
  sessions: number
  fastShare: number
  fullShare: number
  hotShare: number
  deepDischarges: number
}

export const AVG_HABITS: BatteryHabits = { sessions: 12, fastShare: 0.35, fullShare: 0.55, hotShare: 0.1, deepDischarges: 1 }

export function annualFade(h: BatteryHabits) {
  return 1.5 + 1.4 * h.fastShare + 0.9 * h.fullShare + 0.4 * h.hotShare + 0.1 * Math.min(4, h.deepDischarges)
}

/** %p of state of health saved by charging to 80 % instead of 100 % for one session [assumption]. */
export const SOH_PER_CAPPED_SESSION = 0.9 / 150

export class BatteryTracker {
  sessions: ChargeSession[] = []
  deepDischarges = 0
  private open: ChargeSession | null = null
  private lastSoc?: number

  /** Feed every tick; returns a finished session when one just ended. */
  update(sig: VehicleSignals): ChargeSession | null {
    const soc = sig.socPct
    if (soc !== undefined && this.lastSoc !== undefined && this.lastSoc > 10 && soc <= 10) this.deepDischarges++
    if (soc !== undefined) this.lastSoc = soc
    const charging = sig.chargeState === 'charging' || (sig.chargeKw ?? 0) > 0.5
    if (charging && !this.open && soc !== undefined) {
      this.open = { start: sig.t, end: sig.t, startSoc: soc, endSoc: soc, maxKw: 0, fast: false, hot: false }
    }
    if (this.open) {
      const o = this.open
      o.end = sig.t
      if (soc !== undefined) o.endSoc = soc
      o.maxKw = Math.max(o.maxKw, sig.chargeKw ?? 0)
      o.fast = o.maxKw >= 50
      o.hot = o.hot || (sig.outsideTempC ?? 20) >= 32
      o.limitPct = sig.chargeLimitPct
      if (!charging) {
        this.open = null
        if (o.endSoc - o.startSoc >= 3) {
          this.sessions.push(o)
          return o
        }
      }
    }
    return null
  }

  get charging() {
    return this.open
  }

  habits(windowMs = 30 * 864e5, now = Date.now()): BatteryHabits {
    const recent = this.sessions.filter((s) => now - s.end < windowMs)
    if (!recent.length) return { ...AVG_HABITS, sessions: 0 }
    const share = (f: (s: ChargeSession) => boolean) => recent.filter(f).length / recent.length
    return {
      sessions: recent.length,
      fastShare: share((s) => s.fast),
      fullShare: share((s) => s.endSoc >= 95),
      hotShare: share((s) => s.hot),
      deepDischarges: this.deepDischarges,
    }
  }
}

/** State of health in %: the car's number when it reports capacities, otherwise an age-based estimate. */
export function stateOfHealth(sig: VehicleSignals, ageYears: number): { soh: number; source: 'car' | 'estimate' } {
  if (sig.batteryCapWh && sig.batteryDesignWh) return { soh: (100 * sig.batteryCapWh) / sig.batteryDesignWh, source: 'car' }
  return { soh: 100 - 2.0 * ageYears, source: 'estimate' }
}
