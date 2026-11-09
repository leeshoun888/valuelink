// Value Map: the asset risk of where the car stands right now, in 원.
//
// Expected loss over the next 24 h = Σ probability × loss, each factor from one public dataset crossed with the
// car's own state (windows, doors, battery, parking level). The best nearby lot is the one with the lowest
// expected loss, which is what the car recommends. Probabilities and losses are labelled assumptions; the
// structure is what a Hyundai Capital or insurance partner would calibrate with claims data.

import type { VehicleSignals } from './types'
import { at, distanceM, type Lot, type PublicFeed, type Zone } from './publicdata'

export type RiskKind = 'flood' | 'rain' | 'hail' | 'heat' | 'theft' | 'fire'

export interface RiskFactor {
  kind: RiskKind
  label: string
  detail: string
  /** probability over the next 24 h */
  p: number
  /** loss if it happens, 원 */
  loss: number
  source: string
}

export interface PlaceRisk {
  /** 0..100, 100 = safe */
  score: number
  level: '안전' | '주의' | '위험'
  expectedLoss: number
  factors: RiskFactor[]
}

export interface ValueMap extends PlaceRisk {
  here: { lat: number; lng: number }
  lot?: Lot & { distanceM: number }
  /** safest lot within 1.2 km, when it is meaningfully safer than here */
  best?: Lot & { distanceM: number; risk: PlaceRisk; saved: number }
  zonesNear: (Zone & { distanceM: number; inside: boolean })[]
  lotsNear: (Lot & { distanceM: number; risk: PlaceRisk })[]
}

const RAIN_CLEANUP = 150_000 // [가정] interior drying / seat cleaning
const HAIL_DENT = 3_000_000 // [가정] paintless dent repair across panels
const THEFT_LOSS = 500_000 // [가정] break-in damage and items
const HEAT_FADE = 5_000 // [가정] UV / heat fade of the interior per day

function riskOf(place: { lat: number; lng: number }, lot: Lot | undefined, feed: PublicFeed, sig: VehicleSignals, valueWon: number): PlaceRisk {
  const f: RiskFactor[] = []
  // live: sample the real map layers (flood trace, crime density); snapshot: the regional pack's circles
  const inZone = (k: Zone['kind']) => {
    if (feed.sample && (k === 'flood' || k === 'theft')) return feed.sample(k, place) ?? undefined
    return feed.zones.find((z) => z.kind === k && distanceM(place, z) <= z.radiusM)
  }
  const alert = (k: string) => feed.alerts.find((a) => a.kind.startsWith(k))
  const underground = lot?.kind === '지하'
  const high = lot?.kind === '주차빌딩'
  const covered = lot?.covered ?? false

  // flood: past flood trace × heavy-rain warning × parking level
  const flood = inZone('flood')
  if (flood && !high) {
    const base = 0.0015
    const mult = alert('호우경보') || alert('태풍') ? 40 : alert('호우주의보') ? 10 : feed.weather.rain1hMm >= 30 ? 12 : 1
    const p = Math.min(0.6, base * mult * (underground ? 3 : 1))
    f.push({
      kind: 'flood',
      label: underground ? '침수흔적 구역 · 지하주차장' : '침수흔적 구역',
      detail: `${flood.detail}${mult > 1 ? ` · ${feed.alerts[0]?.kind ?? '시간당 30mm 이상 강수'}` : ''}`,
      p,
      loss: valueWon, // a flooded EV is a total loss
      source: `${flood.source} + 기상청 기상특보`,
    })
  }

  // rain on an open cabin
  const open = sig.windowsOpen ?? 0
  if (open > 0 && !covered && (feed.weather.pty > 0 || (feed.weather.rainInMin ?? 999) <= 180)) {
    f.push({ kind: 'rain', label: `창문 ${open}개 열림 · 비 예보`, detail: feed.weather.pty > 0 ? '지금 비가 와요' : `${feed.weather.rainInMin}분 뒤 비 (강수확률 ${feed.weather.pop}%)`, p: Math.max(0.3, feed.weather.pop / 100), loss: RAIN_CLEANUP, source: '기상청 초단기예보 + 차량 창문 상태' })
  }

  // hail on an open-air lot
  if (alert('우박') && !covered) f.push({ kind: 'hail', label: '우박 예보 · 실외 주차', detail: '판금 손상', p: 0.25, loss: HAIL_DENT, source: '기상청 기상특보' })

  // heat / UV on an open-air lot
  if ((feed.weather.uv >= 8 || feed.weather.tempC >= 31 || alert('폭염')) && !covered) f.push({ kind: 'heat', label: '폭염·강한 자외선 · 실외 주차', detail: `자외선 ${feed.weather.uv} · ${feed.weather.tempC}℃`, p: 1, loss: HEAT_FADE, source: '기상청 생활기상지수' })

  // theft-prone block
  const crime = inZone('theft')
  if (crime) f.push({ kind: 'theft', label: crime.label, detail: `${crime.detail}${sig.doorsLocked === false ? ' · 문 열림' : ''}`, p: sig.doorsLocked === false ? 0.02 : 0.004, loss: THEFT_LOSS, source: crime.source })

  // EV fire rules for underground parking (Seoul guidance: 90 % or less)
  if (underground && (sig.socPct ?? 0) > 90) f.push({ kind: 'fire', label: '지하주차장 · 충전량 90% 초과', detail: '서울시 공동주택 지하주차장 전기차 충전 90% 이하 권고', p: 0, loss: 0, source: '서울시 권고(2024) + 차량 SoC' })

  const expectedLoss = f.reduce((a, x) => a + x.p * x.loss, 0)
  const frac = expectedLoss / Math.max(1, valueWon)
  const score = Math.round(100 * Math.exp(-frac * 60) - f.filter((x) => x.kind === 'fire').length * 8)
  const s = Math.max(0, Math.min(100, score))
  return { score: s, level: s >= 80 ? '안전' : s >= 50 ? '주의' : '위험', expectedLoss, factors: f.sort((a, b) => b.p * b.loss - a.p * a.loss) }
}

export function valueMap(sig: VehicleSignals, feed: PublicFeed, valueManwon: number): ValueMap | null {
  if (!sig.position) return null
  const here = at(sig.position)
  const valueWon = valueManwon * 10_000
  const lotsNear = feed.lots
    .map((l) => ({ ...l, distanceM: distanceM(here, l) }))
    .filter((l) => l.distanceM <= 1_500)
    .sort((a, b) => a.distanceM - b.distanceM)
  const lot = lotsNear.find((l) => l.distanceM <= 80)
  const risk = riskOf(here, lot, feed, sig, valueWon)
  // lots: assume windows closed and doors locked once the driver moves there
  const moved = { ...sig, windowsOpen: 0, doorsLocked: true, socPct: Math.min(sig.socPct ?? 0, 90) }
  const rated = lotsNear.map((l) => ({ ...l, risk: riskOf(l, l, feed, moved, valueWon) }))
  const cand = rated.filter((l) => l.id !== lot?.id && l.distanceM <= 1_200).sort((a, b) => a.risk.expectedLoss - b.risk.expectedLoss || a.distanceM - b.distanceM)[0]
  const best = cand && risk.expectedLoss - cand.risk.expectedLoss > Math.max(50_000, risk.expectedLoss * 0.5) ? { ...cand, saved: risk.expectedLoss - cand.risk.expectedLoss } : undefined
  const sampled = (['flood', 'theft'] as const).map((k) => feed.sample?.(k, here)).filter((z): z is Zone => Boolean(z))
  const zonesNear = [...feed.zones, ...sampled]
    .map((z) => ({ ...z, distanceM: distanceM(here, z) }))
    .filter((z) => z.distanceM <= 2_000)
    .map((z) => ({ ...z, inside: z.radiusM === 0 || z.distanceM <= z.radiusM }))
  return { ...risk, here, lot, best, zonesNear, lotsNear: rated }
}

/** Accident hotspot within `ahead` metres of the car while driving. */
export function hotspotNear(sig: VehicleSignals, feed: PublicFeed, ahead = 600) {
  if (!sig.position) return undefined
  const here = at(sig.position)
  return feed.zones.find((z) => z.kind === 'accident' && distanceM(here, z) <= z.radiusM + ahead)
}
