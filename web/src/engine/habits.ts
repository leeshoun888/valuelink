// Driving habits that wear the car: harsh acceleration / braking (host-derived from the 1 Hz speed
// feed), driver-assist warning counts (telltale warningCount: forward collision, lane keeping, blind spot)
// and over-speed warnings. Expressed per 100 km so short and long drivers compare fairly.
//
// Wear money [assumptions]: a tyre set ≈ 80만원 per 50,000 km and brake service ≈ 30만원 per 60,000 km for
// a gentle driver; every harsh event per 100 km adds ~6 % tyre and ~8 % brake wear.

import type { VehicleSignals } from './types'

export interface HabitStats {
  km: number
  harshAccelPer100: number
  harshBrakePer100: number
  adasPer100: number
  score: number // 0..100, 100 = treats the car gently
  wearIndex: number // 0..1 for the value model
  wearWonPerKm: number // 원 per km above a gentle driver
}

const TYRE_WON_PER_KM = 800_000 / 50_000
const BRAKE_WON_PER_KM = 300_000 / 60_000

export class HabitTracker {
  private base: { accel: number; brake: number; adas: number; km: number } | null = null
  private last = { accel: 0, brake: 0, adas: 0, km: 0 }
  /** Prior kilometres and events so a fresh install is not judged on its first minute. */
  prior = { km: 400, accel: 4, brake: 6, adas: 2 }

  update(sig: VehicleSignals, drivenKm: number) {
    const cur = { accel: sig.harshAccel ?? 0, brake: sig.harshBrake ?? 0, adas: sig.adasWarnings ?? 0, km: drivenKm }
    if (!this.base) this.base = cur
    this.last = cur
  }

  /** Events since the tracker started (counters on the host are cumulative). */
  delta() {
    const b = this.base ?? this.last
    return {
      accel: Math.max(0, this.last.accel - b.accel),
      brake: Math.max(0, this.last.brake - b.brake),
      adas: Math.max(0, this.last.adas - b.adas),
      km: Math.max(0, this.last.km - b.km),
    }
  }

  stats(): HabitStats {
    const d = this.delta()
    const km = this.prior.km + d.km
    const per = (n: number) => (100 * n) / Math.max(1, km)
    const accel = per(this.prior.accel + d.accel)
    const brake = per(this.prior.brake + d.brake)
    const adas = per(this.prior.adas + d.adas)
    const harsh = accel + brake
    const wearIndex = Math.min(1, harsh / 8 + adas / 10)
    const score = Math.round(Math.max(0, Math.min(100, 100 - harsh * 7 - adas * 4)))
    const wearWonPerKm = harsh * (0.06 * TYRE_WON_PER_KM + 0.08 * BRAKE_WON_PER_KM)
    return { km, harshAccelPer100: accel, harshBrakePer100: brake, adasPer100: adas, score, wearIndex, wearWonPerKm }
  }
}

/** Extra wear in 원 caused by one harsh event (for the coaching line and the ledger). */
export const WON_PER_HARSH_EVENT = Math.round(100 * (0.06 * TYRE_WON_PER_KM + 0.08 * BRAKE_WON_PER_KM))
