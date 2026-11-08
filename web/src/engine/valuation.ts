// Resale value model. Every factor is explicit so the car app can show *why* the number moved.
//
//   value = basePrice × age curve × (1 + mileage) × (1 + battery) × (1 + condition) × (1 + passport)
//
// The coefficients are ValueLink's working assumptions, not market data: with a Hyundai Certified Used Car
// partnership the age curve and base price would come from Hyundai's own transaction data, and the battery
// term from the BMS. The structure (what moves value and by how much) is what the app teaches the driver.

import type { VehicleSignals } from './types'
import { annualFade, AVG_HABITS } from './battery'

export interface CarModel {
  id: string
  name: string
  /** Reference new-car price in 만원 [assumption]. */
  basePrice: number
  ev: boolean
  batteryKwh?: number
}

// Reference prices are rounded working assumptions for the demo, not quotes.
export const CATALOG: CarModel[] = [
  { id: 'ioniq5-lr', name: '아이오닉 5 롱레인지', basePrice: 5300, ev: true, batteryKwh: 77.4 },
  { id: 'ioniq5-sr', name: '아이오닉 5 스탠다드', basePrice: 4700, ev: true, batteryKwh: 63 },
  { id: 'ioniq6-lr', name: '아이오닉 6 롱레인지', basePrice: 5400, ev: true, batteryKwh: 77.4 },
  { id: 'kona-ev', name: '코나 일렉트릭', basePrice: 4400, ev: true, batteryKwh: 64.8 },
  { id: 'grandeur-hev', name: '그랜저 하이브리드', basePrice: 4700, ev: false },
  { id: 'avante', name: '아반떼', basePrice: 2400, ev: false },
]

/** Identifies the model from what the car reports (VIN decoding would be exact on a real vehicle). */
export function identify(sig: VehicleSignals): CarModel {
  const kwh = sig.batteryDesignWh ? sig.batteryDesignWh / 1000 : undefined
  if (kwh) {
    const ev = CATALOG.filter((c) => c.ev && c.batteryKwh)
    return ev.reduce((a, b) => (Math.abs(b.batteryKwh! - kwh) < Math.abs(a.batteryKwh! - kwh) ? b : a))
  }
  if (sig.fuelType === 'gasoline') return CATALOG.find((c) => c.id === 'avante')!
  return CATALOG[0]
}

export const KM_PER_YEAR = 15_000
/** Battery fade of the "average driver" counterfactual, %p per year (see battery.ts). */
export const AVG_SOH_LOSS_PER_YEAR = annualFade(AVG_HABITS)
/** Each 1 %p of state of health away from expectation moves value by this share [assumption]. */
export const VALUE_PER_SOH_POINT = 0.012

/** Share of new price retained by age (years): steep first year, then ~12 %/yr [assumption]. */
export function ageCurve(age: number) {
  const first = 1 - 0.18 * Math.min(1, Math.max(0, age))
  return first * Math.pow(0.88, Math.max(0, age - 1))
}

export interface ValueInput {
  model: CarModel
  ageYears: number
  odometerKm: number
  sohPct?: number
  activeWarnings: number
  airbagDeployed: boolean
  /** 0 (gentle) .. 1 (hard): harsh accel/brake rate, mapped onto tyre/brake/suspension wear. */
  wearIndex: number
  passportDays: number
}

export interface ValueFactor {
  key: 'age' | 'mileage' | 'battery' | 'condition' | 'wear' | 'passport'
  label: string
  /** multiplicative effect, e.g. -0.024 = −2.4 % */
  effect: number
  won: number // 만원, effect on the final value
  note: string
}

export interface Valuation {
  value: number // 만원
  base: number
  factors: ValueFactor[]
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function expectedSoh(ageYears: number) {
  return 100 - AVG_SOH_LOSS_PER_YEAR * ageYears
}

export function valuate(i: ValueInput): Valuation {
  const afterAge = i.model.basePrice * ageCurve(i.ageYears)
  const expectedKm = KM_PER_YEAR * i.ageYears
  const overKm = i.odometerKm - expectedKm
  const mileage = clamp((-overKm / 10_000) * (overKm > 0 ? 0.025 : 0.02), -0.12, 0.08)
  const battery = i.model.ev && i.sohPct !== undefined ? clamp((i.sohPct - expectedSoh(i.ageYears)) * VALUE_PER_SOH_POINT, -0.15, 0.06) : 0
  const condition = clamp(-0.02 * i.activeWarnings, -0.08, 0) + (i.airbagDeployed ? -0.2 : 0)
  const wear = -0.03 * clamp(i.wearIndex, 0, 1)
  const passport = i.passportDays >= 30 ? 0.015 : (i.passportDays / 30) * 0.015

  const parts: [ValueFactor['key'], string, number, string][] = [
    ['mileage', '주행거리', mileage, `연 ${KM_PER_YEAR.toLocaleString()}km 기준 대비 ${overKm > 0 ? '+' : ''}${Math.round(overKm).toLocaleString()}km`],
    ['battery', '배터리 건강도', battery, i.sohPct !== undefined ? `SOH ${i.sohPct.toFixed(1)}% · 같은 연식 평균 ${expectedSoh(i.ageYears).toFixed(1)}%` : '내연기관'],
    ['condition', '차량 상태', condition, i.airbagDeployed ? '에어백 전개 이력' : i.activeWarnings ? `경고등 ${i.activeWarnings}개 미해결` : '경고등 없음'],
    ['wear', '운전 습관 마모', wear, '급가속·급제동 빈도로 본 타이어·브레이크·하체 마모'],
    ['passport', '차량 여권 검증', passport, i.passportDays >= 30 ? '주행거리·관리 이력 연속 검증' : `검증 ${i.passportDays}일 / 30일`],
  ]
  let value = afterAge
  const factors: ValueFactor[] = [
    { key: 'age', label: '연식', effect: ageCurve(i.ageYears) - 1, won: afterAge - i.model.basePrice, note: `출고 후 ${i.ageYears.toFixed(1)}년` },
  ]
  for (const [key, label, effect, note] of parts) {
    const before = value
    value = value * (1 + effect)
    factors.push({ key, label, effect, won: value - before, note })
  }
  return { value, base: i.model.basePrice, factors }
}

/** 만원 → "3,412만원" / "1억 2,340만원" */
export function manwon(v: number) {
  const r = Math.round(v)
  if (Math.abs(r) >= 10_000) {
    const eok = Math.trunc(r / 10_000)
    const rest = Math.abs(r % 10_000)
    return `${eok}억${rest ? ` ${rest.toLocaleString()}만` : ''}원`
  }
  return `${r.toLocaleString()}만원`
}

/** Small amounts in 원 (guard ledger entries are often a few thousand 원). */
export function won(v: number) {
  const r = Math.round(v)
  if (Math.abs(r) >= 10_000) return `${(r / 10_000).toFixed(r % 10_000 === 0 ? 0 : 1)}만원`
  return `${r.toLocaleString()}원`
}
