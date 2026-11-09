// Guard: rules that let the car protect its own value. Each rule looks at the live signals, and when it
// fires it returns vehicle actions plus a ledger entry that says what was protected, in 원, and on what basis.
//
// Rules only touch the cabin while parked (windows, lights, blind); charging limits are set while plugged in;
// everything else is a spoken suggestion. When a control is not approved / not supported on the vehicle, the
// runtime turns the same rule into a suggestion instead (graceful degradation).

import type { VehicleAction, VehicleSignals } from './types'
import { distanceM, type PublicFeed } from './publicdata'
import { hotspotNear, type ValueMap } from './valuemap'
import { SOH_PER_CAPPED_SESSION } from './battery'
import { VALUE_PER_SOH_POINT, won } from './valuation'
import { WON_PER_HARSH_EVENT } from './habits'

export type GuardKind =
  | 'chargeCap'
  | 'tripCharge'
  | 'hotCharge'
  | 'rainWindows'
  | 'lightsLeftOn'
  | 'sunBlind'
  | 'warningLamp'
  | 'deepDischarge'
  | 'precondition'
  | 'tradeUp'
  | 'harshDriving'
  | 'gentleRoute'
  | 'rainForecast'
  | 'floodRisk'
  | 'theftZone'
  | 'accidentZone'
  | 'stormCheck'

export interface LedgerEntry {
  id: string
  t: number
  kind: GuardKind
  title: string
  detail: string
  /** Value protected in 원 (0 when the benefit is safety or convenience rather than money). */
  won: number
  basis: string
  /** SDK calls made (or the reason none were made). */
  sdk: string[]
  /** Spoken line. */
  say: string
  /** The car acted by itself (true) or ValueLink suggested it (false). */
  auto: boolean
}

export interface Suggestion {
  id: string
  kind: GuardKind
  title: string
  detail: string
  cta?: { label: string; action?: VehicleAction; /** opens an in-app sheet instead of a vehicle action */ sheet?: 'tradeUp' | 'map' }
  /** Hyundai Motor Group channel this suggestion leads to (revenue opportunity, recorded on accept) */
  channel?: Channel
  /** recorded when the driver follows the suggestion (value protected by the driver's own action) */
  onAccept?: Omit<LedgerEntry, 'id' | 't' | 'sdk' | 'auto'>
}

/** Hyundai Motor Group channels a ValueLink action leads into. */
export type Channel = '블루핸즈' | 'E-pit' | '신차 보상판매' | '현대 인증중고차' | '현대캐피탈' | '블루멤버스'

/** Revenue opportunity per channel, 만원 [assumption: average ticket]. */
export const CHANNEL_TICKET: Record<Channel, number> = {
  블루핸즈: 15,
  'E-pit': 2.5,
  '신차 보상판매': 5_550,
  '현대 인증중고차': 3_000,
  현대캐피탈: 180,
  블루멤버스: 1,
}

export interface GuardContext {
  sig: VehicleSignals
  valueManwon: number
  home?: { lat: number; lng: number }
  /** km the car can do from the current charge limit (estimated from range / SoC). */
  rangeAtLimitKm?: number
  parkedForSec: number
  newWarnings: string[]
  harshDelta: number
  /** public data around the car (weather, warnings, flood / crime / accident layers, parking) */
  pub?: PublicFeed
  map?: ValueMap | null
  /** today's exposure: a heavy-rain warning was seen, minutes inside a flood-trace zone under it */
  wxToday?: { alert: number; floodMin: number }
  /** the driver explicitly raised the limit today (voice or card); the cap waits until it expires */
  userHold?: boolean
}

export interface GuardResult {
  actions: VehicleAction[]
  entry: Omit<LedgerEntry, 'id' | 't' | 'sdk' | 'auto'>
  suggestion?: Suggestion
}

interface Rule {
  kind: GuardKind
  cooldownMs: number
  test(c: GuardContext): GuardResult | null
}

/** 원 of resale value for a change in state of health (%p). */
export const sohWon = (valueManwon: number, sohPoints: number) => valueManwon * 10_000 * VALUE_PER_SOH_POINT * sohPoints

const WARNING_KO: Record<string, string> = {
  TPMS: '타이어 공기압',
  ENGINE_OIL_PRESSURE: '엔진오일 압력',
  ENGINE_TEMPERATURE: '냉각수 온도',
  ENGINE: '엔진 점검',
  EV_SYSTEM: 'EV 시스템',
  HEV_SYSTEM: '하이브리드 시스템',
  LOW_VOLT_BATTERY: '12V 배터리',
  ABS: 'ABS',
  ESC: '차체 자세 제어',
  MDPS: '전동 조향',
  AIRBAG: '에어백',
  MASTER_WARNING: '종합 경고',
  RBS: '회생제동',
  PARTICLE_FILTER: '배기 필터',
  SCR: '요소수',
  LED_HEADLAMP: 'LED 헤드램프',
  AFS: '어댑티브 헤드램프',
  POWER_DOWN: '출력 제한',
}
export const warningName = (t: string) => WARNING_KO[t] ?? t

/** Nearest E-pit with a free charger (한국환경공단 live status), else the nearest free fast charger. */
export function bestCharger(sig: VehicleSignals, pub?: PublicFeed) {
  if (!sig.position || !pub?.chargers?.length) return undefined
  const here = { lng: sig.position[0], lat: sig.position[1] }
  const free = pub.chargers.filter((c) => c.avail > 0 && c.fast).map((c) => ({ ...c, d: distanceM(here, c) }))
  const epit = free.filter((c) => c.epit && c.d < 8_000).sort((a, b) => a.d - b.d)[0]
  return epit ?? free.sort((a, b) => a.d - b.d)[0]
}

function chargeSuggestion(sig: VehicleSignals, pub?: PublicFeed): Suggestion {
  const c = bestCharger(sig, pub)
  if (!c)
    return { id: 'chg', kind: 'deepDischarge', title: '충전이 필요해요', detail: '내비 주변 충전소 목록을 열어요.', cta: { label: '주변 충전소', action: { kind: 'showChargers', reason: 'SoC ≤ 12%' } } }
  return {
    id: 'chg',
    kind: 'deepDischarge',
    title: c.epit ? `${c.name}: 빈 충전기 ${c.avail}대` : `${c.name}: 빈 급속 ${c.avail}대`,
    detail: `${(c.d / 1000).toFixed(1)}km · 최대 ${c.maxKw}kW (한국환경공단 충전기 실시간 상태). 도착 전에 배터리를 예열해 둘게요.`,
    channel: c.epit ? 'E-pit' : undefined,
    cta: { label: c.epit ? 'E-pit 안내' : '충전소 안내', action: { kind: 'searchPlace', value: c.name, reason: 'SoC ≤ 12%, 빈 충전기' } },
  }
}

/** Cable in, charging enabled, or charging: any of them means the charge limit matters now. */
export const isPlugged = (sig: VehicleSignals) => Boolean(sig.plugged || sig.chargeSwitch || sig.chargeState === 'charging')

/** Distance to the navigation destination, only while a route is set (the host reports 0 with no route). */
export const activeRouteKm = (sig: VehicleSignals) => (sig.routeRemainingKm !== undefined && sig.routeRemainingKm > 0.5 ? sig.routeRemainingKm : undefined)
/** Range at the cap, only when the car reports a usable range. */
const usableRange = (km?: number) => (km !== undefined && km > 1 ? km : undefined)

export const RULES: Rule[] = [
  {
    kind: 'rainForecast',
    cooldownMs: 2 * 3600e3,
    test: ({ sig, parkedForSec, pub, map }) => {
      const w = pub?.weather
      if (!w || w.pty > 0 || w.rainInMin === undefined || w.rainInMin > 120) return null
      if (!(sig.windowsOpen ?? 0) || parkedForSec < 5 || map?.lot?.covered) return null
      return {
        actions: [{ kind: 'closeWindows', reason: `기상청 초단기예보: ${w.rainInMin}분 뒤 강수 (POP ${w.pop}%)` }],
        entry: {
          kind: 'rainForecast',
          title: '비 오기 전 창문 닫음',
          detail: `기상청 초단기예보로 ${w.rainInMin}분 뒤 비 소식(강수확률 ${w.pop}%)을 받고, 비가 오기 전에 창문 ${sig.windowsOpen}개를 닫았어요. 와이퍼가 움직이기 전에 지켰어요.`,
          won: 150_000 * (w.pop / 100),
          basis: '실내 습기 제거·시트 클리닝 15만원 [가정] × 강수확률 (기상청 단기예보 조회서비스)',
          say: `${w.rainInMin}분 뒤 비 예보가 있어서 열려 있던 창문을 미리 닫았어요.`,
        },
      }
    },
  },
  {
    kind: 'floodRisk',
    cooldownMs: 3 * 3600e3,
    test: ({ sig, map, parkedForSec }) => {
      const flood = map?.factors.find((f) => f.kind === 'flood')
      if (!map || !flood || map.level !== '위험' || sig.speedKph > 1 || parkedForSec < 5) return null
      const loss = Math.round(flood.p * flood.loss)
      const b = map.best
      return {
        actions: [],
        entry: {
          kind: 'floodRisk',
          title: '침수 위험 안내',
          detail: `${flood.detail}. 지금 자리의 24시간 기대손실은 약 ${Math.round(loss / 10_000).toLocaleString()}만원이에요.`,
          won: 0,
          basis: '행정안전부 침수흔적도 × 기상청 호우특보 × 주차 위치. 침수 시 전손 [기대손실 = 확률 가정 × 차량가]',
          say: b
            ? `호우경보예요. 여기는 예전에 물에 잠긴 곳이에요. ${Math.round(b.distanceM)}미터 옆 ${b.name}로 옮기면 안전해요.`
            : '호우경보가 내렸고 여기는 예전에 물에 잠긴 구역이에요. 높은 곳으로 차를 옮겨 주세요.',
        },
        suggestion: {
          id: 'flood',
          kind: 'floodRisk',
          title: '침수 위험',
          detail: b ? `${Math.round(b.distanceM)}m 옆 ${b.name}는 안전해요.` : '높은 곳으로 차를 옮겨 주세요.',
          cta: b ? { label: '안내', action: { kind: 'searchPlace', value: b.name, reason: '침수 위험 회피' } } : { label: '밸류맵 보기', sheet: 'map' },
          onAccept: b
            ? {
                kind: 'floodRisk',
                title: '침수 위험 회피',
                detail: `호우경보 중 침수흔적 구역을 벗어나도록 안내했어요. 기대손실 ${Math.round(b.saved / 10_000).toLocaleString()}만원 감소.`,
                won: b.saved,
                basis: '기대손실 차이 (현재 위치 − 추천 주차장), 침수흔적도 × 호우특보 [확률 가정]',
                say: `${b.name}로 안내할게요.`,
              }
            : undefined,
        },
      }
    },
  },
  {
    kind: 'stormCheck',
    cooldownMs: 24 * 3600e3,
    test: ({ pub, wxToday, sig }) => {
      if (!pub || !wxToday?.alert || wxToday.floodMin < 1 || sig.speedKph > 1) return null
      if (pub.alerts.some((a) => a.kind.startsWith('호우') || a.kind.startsWith('태풍'))) return null
      const min = Math.round(wxToday.floodMin)
      return {
        actions: [],
        entry: {
          kind: 'stormCheck',
          title: '호우 뒤 점검 안내',
          detail: `오늘 호우경보 중 침수흔적 구역에 ${min}분 있었어요. 하부와 고전압 배터리 방수 상태를 점검하면 여권에 "침수 안심" 기록이 남아요.`,
          won: 0,
          basis: '기상청 특보 해제 + 당일 침수 노출 기록 (여권). 침수 의심 차량은 중고 시세가 크게 하락',
          say: '비가 그쳤어요. 오늘 물이 찼던 구역에 잠시 있었으니 블루핸즈에서 하부 점검을 받아 두면 안심이에요.',
        },
        suggestion: {
          id: 'storm',
          kind: 'stormCheck',
          title: '호우 뒤 안심 점검',
          detail: '블루핸즈에서 하부를 확인하면 여권에 기록돼요.',
          channel: '블루핸즈',
          cta: { label: '블루핸즈', action: { kind: 'searchPlace', value: '블루핸즈', reason: '호우 뒤 안심 점검' } },
          onAccept: {
            kind: 'stormCheck',
            title: '호우 뒤 점검 → 블루핸즈',
            detail: '점검 결과가 여권에 기록되면 침수 의심 없는 차로 인증돼요.',
            won: 0,
            basis: '블루핸즈 점검 예약 (현대차그룹 정비 매출)',
            say: '가까운 블루핸즈를 찾아볼게요.',
          },
        },
      }
    },
  },
  {
    kind: 'theftZone',
    cooldownMs: 6 * 3600e3,
    test: ({ sig, map, parkedForSec }) => {
      const z = map?.zonesNear.find((x) => x.kind === 'theft' && x.inside)
      if (!z || parkedForSec < 30 || sig.doorsLocked === true) return null
      return {
        actions: [{ kind: 'lockDoors', reason: `${z.label} 주차 (생활안전지도)` }],
        entry: {
          kind: 'theftZone',
          title: '문 잠금 확인',
          detail: `${z.detail} 구간이에요. 문을 잠그고 차 안에 물건을 두지 않도록 안내했어요.`,
          won: 500_000 * 0.016,
          basis: '차량 파손·물품 도난 50만원 [가정] × 잠금 시 위험 감소분 (행정안전부 생활안전지도 치안안전)',
          say: '여기는 차량 범죄 주의 구간이라 문을 잠갔어요. 귀중품은 가지고 내리세요.',
        },
      }
    },
  },
  {
    kind: 'accidentZone',
    cooldownMs: 12 * 3600e3,
    test: ({ sig, pub }) => {
      if (!pub || sig.speedKph < 5) return null
      const z = hotspotNear(sig, pub)
      if (!z) return null
      return {
        actions: [],
        entry: {
          kind: 'accidentZone',
          title: `${z.label} 감속 안내`,
          detail: `${z.detail}. 사고 이력이 한 번 생기면 중고 시세가 크게 내려가요.`,
          won: 0,
          basis: '도로교통공단 사고다발지역정보. 사고 이력 차량 시세 하락 [가정 −5~10%]',
          say: `잠시 뒤 ${z.label}이에요. 천천히 지나갈게요.`,
        },
      }
    },
  },

  {
    // Long trip: the destination is entered at departure, not the night before. Instead of sitting at 100 %
    // overnight, keep the daily 80 % and add one E-pit stop on the way (pre-conditioned on arrival).
    kind: 'tripCharge',
    cooldownMs: 6 * 3600e3,
    test: ({ sig, valueManwon, pub }) => {
      const need = activeRouteKm(sig)
      const range = usableRange(sig.rangeKm)
      if (need === undefined || range === undefined || need < range * 0.9) return null
      if (sig.navStatus !== 'ROUTE_READY' && sig.navStatus !== 'ROUTE_DRIVE') return null
      const c = bestCharger(sig, pub)
      const stop = c?.epit ? c.name : 'E-pit'
      return {
        actions: [],
        entry: {
          kind: 'tripCharge',
          title: '장거리, E-pit 경유',
          detail: `지금 배터리로 약 ${Math.round(range)}km. 밤새 100%로 두지 않고, 가는 길에 E-pit에서 한 번 채우도록 안내하고 도착 전에 배터리를 예열해요.`,
          won: sohWon(valueManwon, SOH_PER_CAPPED_SESSION),
          basis: '고충전 상태 장시간 대기 회피(완충 1회분 SOH) + 예열된 급속충전',
          say: `목적지가 ${Math.round(need)}킬로미터라 가는 길에 E-pit에서 한 번 충전하면 돼요. 도착 전에 배터리를 데워 둘게요.`,
        },
        suggestion: {
          id: 'trip',
          kind: 'tripCharge',
          title: '가는 길에 E-pit 한 번',
          detail: `${Math.round(need)}km 경로에 E-pit을 넣고 미리 예열할게요.`,
          channel: 'E-pit',
          cta: { label: '경유 추가', action: { kind: 'searchPlace', value: stop, reason: '장거리 경로 충전' } },
        },
      }
    },
  },
  {
    kind: 'chargeCap',
    cooldownMs: 8 * 3600e3,
    test: ({ sig, valueManwon, rangeAtLimitKm, userHold }) => {
      const plugged = isPlugged(sig)
      if (userHold) return null // the driver asked for more today (Gleo / card)
      if (!plugged || (sig.chargeLimitPct ?? 100) <= 85) return null
      const need = activeRouteKm(sig)
      const range = usableRange(rangeAtLimitKm)
      if (need !== undefined && range !== undefined && need >= range * 0.9) return null
      const w = sohWon(valueManwon, SOH_PER_CAPPED_SESSION)
      return {
        actions: [{ kind: 'chargeLimit', value: 80, reason: '일상 충전은 80%: 고충전 대기 시간 단축' }],
        entry: {
          kind: 'chargeCap',
          title: '충전 상한 100% → 80%',
          detail: `오늘 일정에는 80%${range !== undefined ? `(약 ${Math.round(range)}km)` : ''}로 충분해요. 완충 상태로 밤새 두지 않도록 차가 직접 맞췄어요.`,
          won: w,
          basis: `완충 1회 회피 ≈ SOH +${SOH_PER_CAPPED_SESSION.toFixed(4)}%p × 1%p당 차량가 ${(VALUE_PER_SOH_POINT * 100).toFixed(1)}%`,
          say: '오늘은 80%까지만 충전할게요. 배터리 수명을 지키는 가장 쉬운 방법이에요.',
        },
      }
    },
  },
  {
    kind: 'hotCharge',
    cooldownMs: 12 * 3600e3,
    test: ({ sig, valueManwon }) => {
      if (sig.chargeState !== 'charging' || (sig.outsideTempC ?? 20) < 30 || (sig.chargeKw ?? 0) > 22) return null
      if ((sig.chargeCurrentA ?? 32) <= 16) return null
      return {
        actions: [{ kind: 'chargeCurrent', value: 16, reason: `외기 ${Math.round(sig.outsideTempC!)}℃ 완속 충전: 발열 감소` }],
        entry: {
          kind: 'hotCharge',
          title: '폭염엔 천천히 충전',
          detail: `밖이 ${Math.round(sig.outsideTempC!)}℃예요. 밤사이 천천히 채워 배터리 온도를 낮게 유지해요.`,
          won: sohWon(valueManwon, SOH_PER_CAPPED_SESSION / 2),
          basis: '고온 충전은 열화를 가속: 전류를 낮춰 셀 온도 상승 억제',
          say: '날이 더워서 오늘 밤은 천천히 충전할게요.',
        },
      }
    },
  },
  {
    kind: 'rainWindows',
    cooldownMs: 2 * 3600e3,
    test: ({ sig, parkedForSec }) => {
      if (!sig.raining || !(sig.windowsOpen ?? 0) || parkedForSec < 5) return null
      return {
        actions: [{ kind: 'closeWindows', reason: '주차 중 강우 감지(와이퍼) + 창문 열림' }],
        entry: {
          kind: 'rainWindows',
          title: '비 와서 창문 닫음',
          detail: `창문 ${sig.windowsOpen}개가 열린 채 주차돼 있었어요. 실내 시트·전장품 침수를 막았어요.`,
          won: 150_000,
          basis: '실내 습기 제거·시트 클리닝 평균 비용 [가정 15만원]',
          say: '비가 와서 열려 있던 창문을 닫았어요.',
        },
      }
    },
  },
  {
    kind: 'lightsLeftOn',
    cooldownMs: 3600e3,
    test: ({ sig, parkedForSec }) => {
      if (!sig.headlightsOn || parkedForSec < 60) return null
      return {
        actions: [{ kind: 'lightsAuto', reason: 'P단 정차 후 전조등 켜짐 1분 이상' }],
        entry: {
          kind: 'lightsLeftOn',
          title: '켜진 전조등 끔',
          detail: '12V 배터리가 방전되면 시동이 걸리지 않고, 반복 방전은 배터리 수명을 줄여요.',
          won: 30_000,
          basis: '12V 배터리 교체·긴급출동 비용의 기대값 [가정 3만원]',
          say: '전조등이 켜져 있어서 자동으로 바꿔뒀어요.',
        },
      }
    },
  },
  {
    kind: 'sunBlind',
    cooldownMs: 8 * 3600e3,
    test: ({ sig, parkedForSec }) => {
      const h = new Date(sig.t).getHours()
      if ((sig.outsideTempC ?? 20) < 28 || h < 10 || h > 17 || parkedForSec < 120) return null
      return {
        actions: [{ kind: 'blind', value: 'close', reason: `한낮 주차 외기 ${Math.round(sig.outsideTempC!)}℃` }],
        entry: {
          kind: 'sunBlind',
          title: '블라인드 닫음',
          detail: '직사광선은 대시보드·시트 변색의 주원인이에요. 실내 온도도 낮춰요.',
          won: 5_000,
          basis: '내장재 자외선 열화 방지 [가정 회당 5천원]',
          say: '햇볕이 강해서 블라인드를 닫아뒀어요.',
        },
      }
    },
  },
  {
    kind: 'warningLamp',
    cooldownMs: 30 * 60e3,
    test: ({ newWarnings, valueManwon }) => {
      if (!newWarnings.length) return null
      const names = newWarnings.map(warningName).join(', ')
      return {
        actions: [],
        entry: {
          kind: 'warningLamp',
          title: `경고등: ${names}`,
          detail: '방치하면 수리비가 커지고, 미해결 경고등은 자산 가치를 낮게 평가받게 해요.',
          won: valueManwon * 10_000 * 0.02,
          basis: '경고등 1개 미해결 = 차량가 −2% [가정], 블루핸즈 조기 점검으로 회복',
          say: `${names} 경고등이 켜졌어요. 가까운 블루핸즈를 찾아볼까요?`,
        },
        suggestion: {
          id: 'svc',
          kind: 'warningLamp',
          title: `${names} 경고등`,
          detail: '지금 고치면 가치 손실 0원이에요.',
          channel: '블루핸즈',
          cta: { label: '블루핸즈', action: { kind: 'searchPlace', value: '블루핸즈', reason: `경고등 ${names}` } },
        },
      }
    },
  },
  {
    kind: 'precondition',
    cooldownMs: 3 * 3600e3,
    test: ({ sig, valueManwon }) => {
      if (!sig.fastChargePlanned || (sig.outsideTempC ?? 20) > 5 || sig.batteryConditioning || sig.speedKph < 1) return null
      const km = sig.plannedChargeKm ? `${Math.round(sig.plannedChargeKm)}km 앞` : '경로 위'
      return {
        actions: [],
        entry: {
          kind: 'precondition',
          title: '급속충전 전 예열',
          detail: `${km} ${sig.plannedChargeKw ?? ''}kW 급속충전소. 바깥이 ${Math.round(sig.outsideTempC ?? 0)}℃라 차가운 배터리로 급속충전하면 열화가 커져요.`,
          won: sohWon(valueManwon, SOH_PER_CAPPED_SESSION),
          basis: '저온 급속충전 회피 (EV_BATTERY_CONDITIONING 텔테일 + 내비 충전 계획)',
          say: '곧 급속충전소예요. 배터리 컨디셔닝을 켜 두면 충전도 빠르고 배터리도 지킬 수 있어요.',
        },
        suggestion: { id: 'pre', kind: 'precondition', title: '급속충전 전 배터리 예열', detail: '차량 설정에서 배터리 컨디셔닝을 켜 주세요. 충전이 빨라지고 열화가 줄어요.' },
      }
    },
  },
  {
    kind: 'deepDischarge',
    cooldownMs: 3 * 3600e3,
    test: ({ sig, pub }) => {
      if (sig.socPct === undefined || sig.socPct > 12 || sig.speedKph < 1) return null
      return {
        actions: [],
        entry: {
          kind: 'deepDischarge',
          title: `배터리 ${sig.socPct}%, 충전 안내`,
          detail: '10% 아래 깊은 방전은 배터리 열화를 앞당겨요.',
          won: 0,
          basis: '깊은 방전 회피',
          say: `배터리가 ${sig.socPct}%예요. 가까운 충전소를 띄워드릴게요.`,
        },
        suggestion: chargeSuggestion(sig, pub),
      }
    },
  },
  {
    kind: 'harshDriving',
    cooldownMs: 15 * 60e3,
    test: ({ harshDelta }) => {
      if (harshDelta < 2) return null
      return {
        actions: [],
        entry: {
          kind: 'harshDriving',
          title: `급가속·급제동 ${harshDelta}회`,
          detail: `한 번에 타이어·브레이크 마모 약 ${won(WON_PER_HARSH_EVENT)}. 부드럽게 출발하면 그대로 내 돈이에요.`,
          won: 0,
          basis: '타이어 80만원/5만km, 브레이크 30만원/6만km 기준 가속 마모 [가정]',
          say: '조금만 부드럽게 출발해볼까요? 타이어와 브레이크가 오래가요.',
        },
      }
    },
  },
]
