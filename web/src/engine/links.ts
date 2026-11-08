// The "Link" in ValueLink: what the car's own record is worth to each Hyundai Motor Group service.
// Every figure that depends on a partnership (guaranteed price window, discounts, points, rate cuts) is a
// proposal-scenario assumption and is labelled as such in the UI.

import type { BatteryHabits } from './battery'
import type { HabitStats } from './habits'
import type { PassportCheck } from './passport'
import type { LedgerEntry } from './guard'
import { KM_PER_YEAR } from './valuation'

/** Hyundai Certified Used Car purchase rule: under 5 years, under 100,000 km, no accident. */
export const CPO_MAX_YEARS = 5
export const CPO_MAX_KM = 100_000

export interface Quest {
  id: string
  title: string
  progress: number
  target: number
  points: number
  done: boolean
}

export interface Links {
  /** 0..100: how well this car is being looked after (charging, driving, lamps, record). */
  careScore: number
  cpo: {
    eligible: boolean
    monthsLeft: number
    kmLeft: number
    /** the first limit the car will hit */
    limit: 'age' | 'km' | 'accident' | null
    price: number // 만원, passport-verified offer
    validDays: number
  }
  tradeUp: {
    /** recommended month to trade in: three months before CPO eligibility ends, or the steepest drop ahead */
    when: number // epoch ms
    reason: string
    loyaltyDiscount: number // 만원 [assumption]
    /** inside the recommended window: the car proactively suggests the trade-up */
    due: boolean
    offer: {
      model: string
      newPrice: number // 만원 [assumption]
      tradeIn: number // 만원
      discount: number // 만원
      net: number // 만원
      months: number
      ratePct: number // Hyundai Capital instalment [assumption]
      monthly: number // 만원
    }
  }
  quests: Quest[]
  pointsThisMonth: number
  capital: {
    tier: '우수' | '양호' | '보통'
    residualBonusPct: number // [assumption]
    rateCutPct: number // [assumption]
  }
}

export interface LinkInput {
  now: number
  ageYears: number
  odometerKm: number
  airbagDeployed: boolean
  valueManwon: number
  premium: number
  battery: BatteryHabits
  habits: HabitStats
  passport: PassportCheck
  activeWarnings: number
  ledger: LedgerEntry[]
  /** sessions this month that ended at or below 85 % */
  cappedSessionsThisMonth: number
  kmPerYear?: number
  newPrice?: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function careScore(i: Pick<LinkInput, 'battery' | 'habits' | 'passport' | 'activeWarnings'>) {
  const charging = 100 - 45 * i.battery.fullShare - 30 * i.battery.fastShare - 15 * i.battery.hotShare
  const driving = i.habits.score
  const lamps = i.activeWarnings ? 70 : 100
  const record = i.passport.chainOk && i.passport.mileageOk ? clamp(60 + i.passport.days / 9, 60, 100) : 30
  return Math.round(clamp(0.35 * charging + 0.3 * driving + 0.15 * lamps + 0.2 * record, 0, 100))
}

export function links(i: LinkInput): Links {
  const kmPerYear = i.kmPerYear ?? (i.ageYears > 0.3 ? i.odometerKm / i.ageYears : KM_PER_YEAR)
  const monthsByAge = (CPO_MAX_YEARS - i.ageYears) * 12
  const monthsByKm = ((CPO_MAX_KM - i.odometerKm) / Math.max(1, kmPerYear)) * 12
  const limit = i.airbagDeployed ? 'accident' : monthsByAge <= monthsByKm ? 'age' : 'km'
  const monthsLeft = Math.max(0, Math.floor(Math.min(monthsByAge, monthsByKm)))
  const eligible = !i.airbagDeployed && monthsLeft > 0
  const score = careScore(i)

  const when = new Date(i.now)
  when.setMonth(when.getMonth() + Math.max(0, monthsLeft - 3))
  when.setDate(1)

  const gentle = i.habits.score
  const unresolvedOld = i.ledger.filter((e) => e.kind === 'warningLamp' && e.won === 0 && i.now - e.t > 7 * 864e5).length
  const quests: Quest[] = [
    { id: 'cap', title: '80% 충전 10번 지키기', progress: Math.min(10, i.cappedSessionsThisMonth), target: 10, points: 5000, done: i.cappedSessionsThisMonth >= 10 },
    { id: 'gentle', title: '부드러운 운전 85점 이상', progress: Math.min(85, gentle), target: 85, points: 3000, done: gentle >= 85 },
    { id: 'lamps', title: '경고등 7일 안에 해결', progress: unresolvedOld ? 0 : 1, target: 1, points: 2000, done: !unresolvedOld && i.activeWarnings === 0 },
  ]
  return {
    careScore: score,
    cpo: { eligible, monthsLeft, kmLeft: Math.max(0, Math.round(CPO_MAX_KM - i.odometerKm)), limit: eligible ? limit : 'accident', price: Math.round((i.valueManwon * (1 + i.premium)) / 10) * 10, validDays: 7 },
    tradeUp: tradeUp(i, eligible, limit, monthsLeft, when.getTime(), score),
    quests,
    pointsThisMonth: quests.filter((q) => q.done).reduce((a, q) => a + q.points, 0),
    capital: {
      tier: score >= 85 ? '우수' : score >= 70 ? '양호' : '보통',
      residualBonusPct: score >= 85 ? 1 : score >= 70 ? 0.5 : 0,
      rateCutPct: score >= 85 ? 0.2 : score >= 70 ? 0.1 : 0,
    },
  }
}

/** World manufacturer identifier and model-year code of a 17-character VIN (ISO 3779). */
export function decodeVin(vin?: string): { maker: string; year?: number } | null {
  if (!vin || vin.length < 10) return null
  const wmi = vin.slice(0, 3).toUpperCase()
  const maker = { KMH: '현대자동차', KMF: '현대자동차(상용)', KMT: '제네시스', KNA: '기아', KND: '기아', KNM: '르노코리아' }[wmi] ?? wmi
  const code = vin[9].toUpperCase()
  const letters = 'ABCDEFGHJKLMNPRSTVWXY'
  const k = letters.indexOf(code)
  return { maker, year: k >= 0 ? 2010 + k : undefined }
}

/** Next-car offer: trade-in at the passport price, a loyalty discount for a well-kept car, Hyundai Capital terms. */
function tradeUp(i: LinkInput, eligible: boolean, limit: string, monthsLeft: number, when: number, score: number): Links['tradeUp'] {
  const loyaltyDiscount = score >= 85 ? 100 : score >= 70 ? 50 : 0
  const tradeIn = Math.round((i.valueManwon * (1 + i.premium)) / 10) * 10
  const newPrice = i.newPrice ?? 5_550 // 2027 IONIQ 5 Long Range [assumption]
  const net = Math.max(0, newPrice - tradeIn - loyaltyDiscount)
  const months = 36
  const ratePct = score >= 85 ? 4.5 : 4.9 // [assumption] care-score rate
  const r = ratePct / 100 / 12
  const monthly = (net * r) / (1 - Math.pow(1 + r, -months))
  return {
    when,
    reason: eligible ? `인증중고차 매입 기준(${limit === 'age' ? '출고 5년' : '10만km'}) 만료 3개월 전` : '가치 곡선이 가장 가파르게 꺾이기 전',
    loyaltyDiscount,
    due: eligible && monthsLeft <= 6,
    offer: { model: '아이오닉 5 롱레인지 (2027년형)', newPrice, tradeIn, discount: loyaltyDiscount, net, months, ratePct, monthly },
  }
}
