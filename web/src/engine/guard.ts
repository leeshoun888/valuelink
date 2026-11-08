// Guard: rules that let the car protect its own value. Each rule looks at the live signals, and when it
// fires it returns vehicle actions plus a ledger entry that says what was protected, in 원, and on what basis.
//
// Rules only touch the cabin while parked (windows, lights, blind); charging limits are set while plugged in;
// everything else is a spoken suggestion. When a control is not approved / not supported on the vehicle, the
// runtime turns the same rule into a suggestion instead (graceful degradation).

import type { VehicleAction, VehicleSignals } from './types'
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
  | 'harshDriving'
  | 'gentleRoute'

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
  cta?: { label: string; action: VehicleAction }
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

/** Cable in, charging enabled, or charging: any of them means the charge limit matters now. */
export const isPlugged = (sig: VehicleSignals) => Boolean(sig.plugged || sig.chargeSwitch || sig.chargeState === 'charging')

export const RULES: Rule[] = [
  {
    kind: 'tripCharge',
    cooldownMs: 6 * 3600e3,
    test: ({ sig, rangeAtLimitKm }) => {
      const plugged = isPlugged(sig)
      const need = sig.routeRemainingKm
      if (!plugged || need === undefined || rangeAtLimitKm === undefined) return null
      if ((sig.chargeLimitPct ?? 100) >= 100 || need < rangeAtLimitKm * 0.9) return null
      return {
        actions: [{ kind: 'chargeLimit', value: 100, reason: `내비 목적지 ${Math.round(need)}km > 80% 주행가능 ${Math.round(rangeAtLimitKm)}km` }],
        entry: {
          kind: 'tripCharge',
          title: '장거리 일정 → 오늘만 100% 충전',
          detail: `내비 목적지 ${Math.round(need)}km. 80%로는 ${Math.round(rangeAtLimitKm)}km라서 이번 한 번만 완충합니다.`,
          won: 0,
          basis: '여행 전 완충은 출발 직전에만: 고충전 상태로 오래 두지 않음',
          say: `내비 목적지가 ${Math.round(need)}킬로미터라 이번만 100%까지 충전할게요. 도착하면 다시 80%로 돌려둘게요.`,
        },
      }
    },
  },
  {
    kind: 'chargeCap',
    cooldownMs: 8 * 3600e3,
    test: ({ sig, valueManwon, rangeAtLimitKm }) => {
      const plugged = isPlugged(sig)
      if (!plugged || (sig.chargeLimitPct ?? 100) <= 85) return null
      if (sig.routeRemainingKm !== undefined && rangeAtLimitKm !== undefined && sig.routeRemainingKm >= rangeAtLimitKm * 0.9) return null
      const w = sohWon(valueManwon, SOH_PER_CAPPED_SESSION)
      return {
        actions: [{ kind: 'chargeLimit', value: 80, reason: '일상 충전은 80%: 고충전 대기 시간 단축' }],
        entry: {
          kind: 'chargeCap',
          title: '충전 상한 100% → 80%',
          detail: `오늘 일정에는 80%(약 ${Math.round(rangeAtLimitKm ?? 0)}km)로 충분해요. 완충 상태로 밤새 두지 않도록 차가 직접 맞췄어요.`,
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
          title: '폭염 충전 → 충전 전류 16A로 제한',
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
          title: '비 오는데 창문 열림 → 자동으로 닫음',
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
          title: '주차 후 전조등 켜짐 → 자동 모드로 전환',
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
          title: '한낮 땡볕 주차 → 블라인드 닫음',
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
          title: `${names} 점검 필요`,
          detail: '지금 고치면 가치 손실 0원. 가까운 블루핸즈를 내비에서 찾아요.',
          cta: { label: '블루핸즈 찾기', action: { kind: 'searchPlace', value: '블루핸즈', reason: `경고등 ${names}` } },
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
          title: `겨울 급속충전 전 배터리 예열`,
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
    test: ({ sig }) => {
      if (sig.socPct === undefined || sig.socPct > 12 || sig.speedKph < 1) return null
      return {
        actions: [],
        entry: {
          kind: 'deepDischarge',
          title: `배터리 ${sig.socPct}% → 충전소 안내`,
          detail: '10% 아래 깊은 방전은 배터리 열화를 앞당겨요.',
          won: 0,
          basis: '깊은 방전 회피',
          say: `배터리가 ${sig.socPct}%예요. 가까운 충전소를 띄워드릴게요.`,
        },
        suggestion: { id: 'chg', kind: 'deepDischarge', title: '충전이 필요해요', detail: '내비 주변 충전소 목록을 열어요.', cta: { label: '주변 충전소', action: { kind: 'showChargers', reason: 'SoC ≤ 12%' } } },
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
