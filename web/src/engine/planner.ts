// Predictive rest planner: intersects the forecast sleepiness curve with the rest
// stops ahead on the route and picks the LAST stop the driver can still reach safely
// (KSS at arrival below the safety threshold). "Rest before you get drowsy" instead of
// "warn when already drowsy".

import type { RestPlan, RestStop } from './types'

export interface PlannerInput {
  stops: RestStop[] // along the active route, any order
  progressKm: number
  avgSpeedKph: number
  curve: { min: number; kss: number }[] // from FatigueModel.forecastCurve
  timeOnTaskMin: number
  maxContinuousMin?: number // regulation (e.g. 120 for commercial vehicles)
  safeKss?: number
  serviceOnly?: boolean // low EV charge: only service areas (chargers), not drowsy shelters
}

export function kssAt(curve: { min: number; kss: number }[], min: number): number {
  if (!curve.length) return 5
  if (min <= curve[0].min) return curve[0].kss
  for (let i = 1; i < curve.length; i++) {
    if (curve[i].min >= min) {
      const a = curve[i - 1]
      const b = curve[i]
      return a.kss + ((b.kss - a.kss) * (min - a.min)) / (b.min - a.min)
    }
  }
  return curve[curve.length - 1].kss
}

export function planRest(input: PlannerInput): RestPlan | null {
  const safe = input.safeKss ?? 6.6
  const speed = Math.max(40, input.avgSpeedKph)
  const ahead = input.stops
    .filter((s) => s.km > input.progressKm + 0.8)
    .filter((s) => !input.serviceOnly || s.kind === 'service')
    .sort((a, b) => a.km - b.km)
    .map((stop) => {
      const etaMin = ((stop.km - input.progressKm) / speed) * 60
      return { stop, etaMin, kssAtArrival: kssAt(input.curve, etaMin) }
    })
    .filter((x) => x.etaMin <= 240)
  if (!ahead.length) return null

  const regLimit = input.maxContinuousMin ? input.maxContinuousMin - input.timeOnTaskMin : Infinity
  const feasible = ahead.filter((x) => x.kssAtArrival < safe && x.etaMin <= regLimit)

  let pick = feasible.length ? feasible[feasible.length - 1] : ahead[0]
  // Prefer a full service area (coffee, toilets) if it is only slightly earlier than the pick.
  if (feasible.length && pick.stop.kind === 'drowsy') {
    const svc = [...feasible].reverse().find((x) => x.stop.kind === 'service' && pick.etaMin - x.etaMin <= 12)
    if (svc) pick = svc
  }

  let reason: string
  if (!feasible.length) reason = '이미 졸음 위험 구간입니다. 가장 가까운 쉼터로 안내합니다.'
  else if (input.maxContinuousMin && pick.etaMin >= regLimit - 15)
    reason = `연속운전 ${input.maxContinuousMin}분 규정을 지키는 마지막 쉼터입니다.`
  else reason = `졸음 위험(KSS 7) 도달 전 도착 가능한 마지막 ${pick.stop.kind === 'service' ? '휴게소' : '졸음쉼터'}입니다.`
  if (input.serviceOnly) reason = `배터리가 낮아 충전이 가능한 휴게소만 골랐어요. ${reason}`

  return {
    stop: pick.stop,
    etaMin: pick.etaMin,
    kssAtArrival: pick.kssAtArrival,
    reason,
    alternatives: ahead.filter((x) => x.stop.id !== pick.stop.id).slice(0, 4),
  }
}
