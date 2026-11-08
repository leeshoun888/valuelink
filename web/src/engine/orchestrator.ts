// Intervention orchestrator · an escalation ladder with hysteresis and cooldowns.
// L0 Watch → L1 Refresh (air/thermal/light) → L2 Engage (voice dialogue + probe)
// → L3 Rest (navigate to a rest stop) → L4 Critical. Parked: Power-Nap Pod.
// The orchestrator never touches driving controls; it only acts on cabin comfort,
// voice and navigation, and every action carries a human-readable reason.

import { co2Band, freshAirDutyCycle } from './co2'
import type { FatigueEstimate, RestPlan, TimelineEvent, VehicleAction, VehicleSignals } from './types'

export type Mode = 'driving' | 'parked' | 'napping' | 'waking'

export interface OrchestratorContext {
  sig: VehicleSignals
  co2: number
  est: FatigueEstimate
  plan: RestPlan | null
}

const MIN = 60_000

const CAUTION_LABEL: Record<string, string> = {
  ACCIDENT_PRONE_AREA: '사고 다발 구간',
  FOG_AREA: '안개 잦은 구간',
  DOWNHILL_CAUTION_AREA: '급경사 내리막',
  SLIPPERY_ROAD_ALERT: '미끄러운 도로',
  WILDLIFE_CROSSING: '야생동물 출몰 구간',
  FALLING_ROCK_AREA: '낙석 주의 구간',
  WRONG_WAY_DRIVING_ALERT: '역주행 경보',
  HIGHWAY_CONSTRUCTION: '도로 공사 구간',
}

export const AMBIENT = {
  calm: { color: '#3CF2C8', brightness: 35 },
  cool: { color: '#8FD8FF', brightness: 70 },
  alert: { color: '#FFB547', brightness: 80 },
  nap: { color: '#FF9A5A', brightness: 12 },
  wake: { color: '#E8F4FF', brightness: 100 },
}

export class Orchestrator {
  mode: Mode = 'driving'
  napEndsAt = 0
  napStartedAt = 0
  napMinutes = 20
  private lastFire: Record<string, number> = {}
  private proposedStopId: string | null = null
  acceptedStopId: string | null = null
  private dutyPhaseStart = 0
  private dutyOn = false
  engaged = false
  private lastL1Kss: number | null = null

  private ready(key: string, t: number, cooldownMin: number) {
    const last = this.lastFire[key] ?? -Infinity
    if (t - last < cooldownMin * MIN) return false
    this.lastFire[key] = t
    return true
  }

  reset() {
    this.lastFire = {}
    this.proposedStopId = null
    this.acceptedStopId = null
    this.mode = 'driving'
    this.engaged = false
  }

  acceptStop(id: string) {
    this.acceptedStopId = id
  }

  startNap(t: number, minutes = 20): TimelineEvent {
    this.mode = 'napping'
    this.napMinutes = minutes
    this.napStartedAt = t
    this.napEndsAt = t + minutes * MIN
    return {
      t,
      level: 0,
      title: `파워냅 ${minutes}분 시작`,
      detail: 'NASA 수면연구 기반 20분 이하 단잠: 깊은 수면 진입 전 기상으로 수면관성 최소화',
      actions: [
        { kind: 'napStart', value: minutes, reason: '정차(P) + 주차브레이크 확인' },
        { kind: 'seatRecline', value: 38, reason: '운전석 등받이 젖힘 (휴식 자세)' },
        { kind: 'temperature', value: 22.5, reason: '입면에 적합한 22~23℃' },
        { kind: 'fan', value: 2, reason: '저소음 송풍' },
        { kind: 'freshAir', value: true, reason: '수면 중 CO₂ 축적 방지' },
        { kind: 'ambient', value: AMBIENT.nap, reason: '저조도 웜톤 · 멜라토닌 억제 최소화' },
        { kind: 'blind', value: 'close', reason: '빛 차단' },
        { kind: 'smartGlass', value: true, reason: '수면 중 프라이버시·차광' },
        { kind: 'speak', value: 'nap_start', reason: '안내' },
      ],
    }
  }

  wake(t: number): TimelineEvent {
    this.mode = 'waking'
    this.lastFire['wake'] = t
    return {
      t,
      level: 0,
      title: '기상 시퀀스',
      detail: '빛·바람·소리를 90초에 걸쳐 단계적으로, 급격한 각성 없이 수면관성 해소',
      actions: [
        { kind: 'napWake', reason: '파워냅 종료' },
        { kind: 'ambient', value: AMBIENT.wake, reason: '고휘도 주광색 (각성 촉진)' },
        { kind: 'temperature', value: 20.5, reason: '서늘한 공기로 각성' },
        { kind: 'fan', value: 4, reason: '환기 강화' },
        { kind: 'seatRecline', value: 8, reason: '운전 자세 복귀 (저장된 등받이 위치로 정확히)' },
        { kind: 'cabinLight', value: true, reason: '실내등으로 각성' },
        { kind: 'blind', value: 'open', reason: '자연광 유입' },
        { kind: 'smartGlass', value: false, reason: '차광 해제' },
        { kind: 'speak', value: 'nap_wake', reason: '기상 안내' },
        { kind: 'probe', reason: '출발 전 반응속도 확인' },
      ],
    }
  }

  tick(ctx: OrchestratorContext): TimelineEvent[] {
    const { sig, co2, est, plan } = ctx
    const t = sig.t
    const out: TimelineEvent[] = []
    const parked = sig.speedKph < 1 && (sig.gear === 'P' || sig.parkingBrake)

    if (this.mode === 'napping') {
      if (t >= this.napEndsAt) out.push(this.wake(t))
      return out
    }
    if (this.mode === 'waking') {
      if (t - (this.lastFire['wake'] ?? t) > 3 * MIN) this.mode = parked ? 'parked' : 'driving'
      return out
    }
    if (!parked && this.lastFire['wake'] && !this.lastFire['cabinOff']) {
      this.lastFire['cabinOff'] = t
      out.push({ t, level: 0, title: '출발 · 실내등 끄기', detail: '주행 중 실내등은 시야를 방해합니다.', actions: [{ kind: 'cabinLight', value: false, reason: '주행 시작' }] })
    }
    this.mode = parked ? 'parked' : 'driving'

    // ── Air quality loop (independent of fatigue) ─────────────────────────────
    const pmBad = (sig.outsidePm25 ?? 0) > 35
    if (sig.recirculation && co2 > 1200 && !pmBad && this.ready('air', t, 4)) {
      out.push({
        t,
        level: est.level,
        title: '실내 CO₂ 축적 · 외기 유입 전환',
        detail: `CO₂ ${Math.round(co2).toLocaleString()}ppm (${co2Band(co2) === 'drowsy' ? '졸음 유발 구간' : '환기 필요'}). 내기순환을 외기 유입으로 전환합니다.`,
        actions: [
          { kind: 'freshAir', value: true, reason: `CO₂ ${Math.round(co2)}ppm > 1,200ppm` },
          { kind: 'fan', value: Math.max(3, sig.fanSpeed), reason: '환기량 확보' },
          { kind: 'speak', value: 'air_fresh', reason: '안내' },
        ],
      })
    } else if (pmBad && co2 > 1200) {
      // Duty-cycled bursts to balance CO2 against outdoor particulate matter.
      const duty = freshAirDutyCycle(
        { occupants: sig.occupants, recirculation: true, fanSpeed: Math.max(3, sig.fanSpeed), speedKph: sig.speedKph, windowOpenPct: 0 },
        1100,
      )
      const period = 10 * MIN
      if (!this.dutyPhaseStart) this.dutyPhaseStart = t
      const phase = ((t - this.dutyPhaseStart) % period) / period
      const want = phase < Math.max(0.2, duty)
      if (want !== this.dutyOn && this.ready('duty', t, 1)) {
        this.dutyOn = want
        if (want) this.lastFire['pmSpoke'] ??= t
        out.push({
          t,
          level: est.level,
          title: want ? '미세먼지 대응 펄스 환기 ON' : '펄스 환기 OFF · 내기순환 복귀',
          detail: `외부 PM2.5 ${sig.outsidePm25}µg/m³. CO₂와 미세먼지 유입을 동시에 최소화하는 듀티사이클 ${(duty * 100).toFixed(0)}%`,
          actions: [
            want
              ? { kind: 'freshAir' as const, value: true, reason: '공기질 최적화' }
              : { kind: 'recirculation' as const, value: true, reason: '미세먼지 유입 차단' },
            ...(want && !this.lastFire['pmSpoke'] ? [{ kind: 'speak' as const, value: 'pm_pulse', reason: '안내' }] : []),
          ],
        })
      }
    }

    if (parked) {
      if (est.kss >= 6 && this.ready('napOffer', t, 30)) {
        out.push({
          t,
          level: est.level,
          title: '파워냅 제안',
          detail: '정차 중입니다. 20분 단잠이 이후 운전 각성도를 크게 회복시킵니다.',
          actions: [{ kind: 'speak', value: 'nap_offer', reason: '정차 + 졸음 위험' }],
        })
      }
      return out
    }

    // Navi: right before a turn / exit nothing talks to the driver (NaviHelper TBT).
    const manoeuvre = (sig.tbtNextM ?? Infinity) < 400

    // Navi caution points (accident-prone, fog, downhill, ...) while already drowsy → one heads-up each.
    if (sig.cautionType && (sig.cautionM ?? Infinity) < 2500 && est.level >= 1 && !manoeuvre && this.ready(`caution:${sig.cautionType}`, t, 20)) {
      out.push({
        t,
        level: est.level,
        title: `전방 ${CAUTION_LABEL[sig.cautionType] ?? '위험 구간'} ${((sig.cautionM ?? 0) / 1000).toFixed(1)}km · 각성 유지`,
        detail: '내비 위험 지점 정보와 졸음 예측을 함께 보고 미리 알려 드립니다.',
        actions: [
          { kind: 'fanDirection', value: 'FACE', reason: '얼굴 쪽 서늘한 기류' },
          { kind: 'speak', value: 'caution', reason: '위험 구간 사전 안내' },
        ],
      })
    }

    // ── Predictive rest proposal (fires before the driver feels sleepy) ───────
    if (plan && plan.stop.id !== this.proposedStopId && plan.stop.id !== this.acceptedStopId) {
      const urgent = est.minutesToDanger !== null && est.minutesToDanger < plan.etaMin + 25
      if ((urgent || est.level >= 2) && !manoeuvre && this.ready('plan', t, 8)) {
        this.proposedStopId = plan.stop.id
        out.push({
          t,
          level: Math.max(1, est.level) as 1,
          title: `예측 휴식 제안 · ${plan.stop.name}`,
          detail: `${Math.round(plan.etaMin)}분 후 도착 (도착 시 예상 KSS ${plan.kssAtArrival.toFixed(1)}). ${plan.reason}`,
          actions: [
            { kind: 'waypoint', value: { stop: plan.stop, needsConfirm: true }, reason: plan.reason },
            { kind: 'speak', value: 'plan_offer', reason: '경유지 제안' },
          ],
        })
      }
    }

    // ── Escalation ladder ─────────────────────────────────────────────────────
    const l1Due = est.kss - (this.lastL1Kss ?? 0) >= 0.5 || t - (this.lastFire['L1'] ?? -Infinity) > 25 * MIN
    if (est.level >= 1 && l1Due && this.ready('L1', t, 10)) {
      this.lastL1Kss = est.kss
      out.push({
        t,
        level: 1,
        title: 'L1 리프레시 · 캐빈 각성 모드',
        detail: '서늘한 공기·송풍·주광색 앰비언트로 각성 유지 (운전 조작 개입 없음)',
        actions: [
          { kind: 'temperature', value: Math.max(19.5, sig.setTempC - 1.5), reason: '체온 하강 → 각성' },
          { kind: 'fan', value: Math.min(8, sig.fanSpeed + 1), reason: '기류 증가' },
          { kind: 'fanDirection', value: 'FACE', reason: '얼굴 쪽 기류' },
          ...((sig.seatHeat ?? 0) > 0 || (sig.wheelHeat ?? 0) > 0 ? [{ kind: 'heatOff' as const, reason: '열선 끄기 (온열은 졸음을 키움)' }] : []),
          { kind: 'ambient', value: AMBIENT.cool, reason: '청백색 광 · 각성 효과' },
          { kind: 'speak', value: 'refresh', reason: '짧은 음성 안내' },
        ],
      })
    }
    if (est.level >= 2 && !manoeuvre && this.ready('L2', t, 12)) {
      this.engaged = true
      out.push({
        t,
        level: 2,
        title: 'L2 인게이지 · AI 대화 + 반응속도 측정',
        detail: '경로 기반 퀴즈/대화로 인지 각성을 유도하고, 음성 반응속도로 졸음을 직접 측정합니다.',
        actions: [
          { kind: 'seatVent', value: 3, reason: '등·허벅지 냉각' },
          { kind: 'lumbarPulse', reason: '요추 지지대 촉각 신호' },
          { kind: 'engage', reason: '대화형 각성 유지' },
          { kind: 'probe', reason: '음성 PVT' },
        ],
      })
    }
    if (est.level >= 3 && this.ready('L3', t, 6)) {
      const acts: VehicleAction[] = [
        { kind: 'ambient', value: AMBIENT.alert, reason: '경고 색상(앰버)' },
        { kind: 'speak', value: 'rest_now', reason: '휴식 권고' },
      ]
      if (plan && plan.stop.id !== this.acceptedStopId)
        acts.unshift({ kind: 'waypoint', value: { stop: plan.stop, needsConfirm: !(sig.dawWarning || sig.dmsDrowsy) }, reason: '가장 안전한 쉼터 경유' })
      // EV with little charge left: show navi's nearby chargers so the stop can double as a charging stop.
      if ((sig.socPct ?? 100) < 25) acts.push({ kind: 'showChargers', reason: `배터리 ${sig.socPct}% · 충전 겸 휴식` })
      out.push({
        t,
        level: 3,
        title: sig.dmsDrowsy ? 'L3 차량 졸음 감지(DMS) 연동 · 즉시 휴식' : sig.dawWarning ? 'L3 차량 주의 경고 연동 · 즉시 휴식' : 'L3 휴식 필요',
        detail: `KSS ${est.kss.toFixed(1)} · 졸음운전 위험 구간 진입`,
        actions: acts,
      })
    }
    if (est.level >= 4 && this.ready('L4', t, 3)) {
      out.push({
        t,
        level: 4,
        title: 'L4 위험 · 반복 경고',
        detail: '즉시 가까운 안전한 곳에 정차하세요.',
        actions: [{ kind: 'speak', value: 'critical', reason: '반복 경고' }],
      })
    }
    if (est.level === 0 && this.engaged && this.ready('calm', t, 10)) {
      this.engaged = false
      out.push({
        t,
        level: 0,
        title: '각성 회복 · 개입 해제',
        detail: '운전자 상태가 안정되어 캐빈을 평상시로 되돌립니다.',
        actions: [
          { kind: 'ambient', value: AMBIENT.calm, reason: '평상시' },
          { kind: 'seatVent', value: 0, reason: '해제' },
        ],
      })
    }
    return out
  }
}
