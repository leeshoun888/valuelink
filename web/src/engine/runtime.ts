// Runtime: wires a VehicleBus to the cabin twin, fatigue model, planner and orchestrator,
// executes actions, and publishes immutable snapshots for the UI.

import { DEFAULT_CABIN, stepCo2 } from './co2'
import type { BusEvent, Capabilities, VehicleBus } from './bus'
import { FatigueModel, kssFromReaction } from './fatigue'
import { Orchestrator, type Mode } from './orchestrator'
import { planRest } from './planner'
import { stopsAhead } from './route'
import type {
  DriverProfile,
  FatigueEstimate,
  ProbeResult,
  RestPlan,
  RestStop,
  TimelineEvent,
  VehicleAction,
  VehicleSignals,
} from './types'

export interface HistoryPoint {
  t: number
  km: number
  kss: number
  co2: number
  speed: number
  cabinTemp: number
  level: number
  recirc: boolean
}

export interface Proposal {
  id: string
  stop: RestStop
  etaMin: number
  createdAt: number // sim time
  createdWall: number
}

export interface Snapshot {
  sig: VehicleSignals
  co2: number
  est: FatigueEstimate
  plan: RestPlan | null
  mode: Mode
  timeline: TimelineEvent[]
  history: HistoryPoint[]
  proposal: Proposal | null
  waypoint: RestStop | null
  caps: Capabilities
  napRemainingMin: number | null
  probes: ProbeResult[]
  speaking: string | null
  stats: { interventions: number; co2Avoided: number; restMin: number; maxKss: number }
  /** Navi's own ETA / distance / SoC on arrival for the proposed or accepted stop (NaviHelper.requestTrip). */
  trip: { poiId: string; distanceKm: number; etaMin: number; socAtDest: number } | null
  /** Where the driver usually goes (NaviHelper recent destinations), for pre-trip rest planning. */
  recent: { name: string; lat: number; lon: number }[]
  /** Arrival at the accepted stop confirmed by the FusedLocation geofence. */
  arrivedAt: string | null
}

export interface RuntimeHooks {
  speak?: (key: string, text?: string) => void
  engage?: () => void
  probe?: () => void
}

const SUB_MS = 10_000

export class Runtime {
  bus: VehicleBus
  stops: RestStop[]
  /** All public rest stops; used when the vehicle is off the corridor route (sig.onRoute === false). */
  freeRoamStops: Omit<RestStop, 'km'>[] = []
  fatigue: FatigueModel
  orch = new Orchestrator()
  co2: number
  timeline: TimelineEvent[] = []
  history: HistoryPoint[] = []
  proposal: Proposal | null = null
  waypoint: RestStop | null = null
  hooks: RuntimeHooks = {}
  fleetMode = false
  autoPilot = true
  speaking: string | null = null
  private est: FatigueEstimate
  private plan: RestPlan | null = null
  private lastSample = 0
  private lastPlanAt = 0
  private acc = 0
  private stats = { interventions: 0, co2Avoided: 0, restMin: 0, maxKss: 0 }
  private listeners = new Set<(s: Snapshot) => void>()

  trip: Snapshot['trip'] = null
  recent: Snapshot['recent'] = []
  arrivedAt: string | null = null

  constructor(bus: VehicleBus, profile: DriverProfile, stops: RestStop[]) {
    this.bus = bus
    this.stops = stops
    const sig = bus.read()
    this.fatigue = new FatigueModel(profile, sig.t)
    this.co2 = DEFAULT_CABIN.outdoorPpm + (sig.recirculation ? 180 : 90)
    this.est = this.fatigue.estimate(sig, this.co2)
    bus.onEvent?.((e) => this.onBusEvent(e))
  }

  /** Vehicle / navi events from the Pleos SDKs (geofence, real trip ETA, waypoint list, recents). */
  private onBusEvent(e: BusEvent) {
    const t = this.bus.read().t
    switch (e.type) {
      case 'tripInfo':
        this.trip = { poiId: e.poiId, distanceKm: e.distanceKm, etaMin: e.etaMin, socAtDest: e.socAtDest }
        if (this.proposal && this.proposal.stop.id === e.poiId) this.proposal = { ...this.proposal, etaMin: e.etaMin }
        break
      case 'geofence': {
        const stop = this.waypoint
        if (!stop || stop.id !== e.stopId) break
        if (e.transition === 'ENTER') {
          this.arrivedAt = stop.id
          this.timeline.push({
            t,
            level: 0,
            title: `쉼터 도착 확인 · ${stop.name}`,
            detail: 'FusedLocation 지오펜스로 도착을 확인했습니다. 정차하면 파워냅을 준비합니다.',
            actions: [{ kind: 'speak', value: 'arrived', reason: '도착 안내' }],
          })
          this.hooks.speak?.('arrived')
        } else {
          this.timeline.push({ t, level: 0, title: `쉼터 출발 · ${stop.name}`, detail: `휴식 ${Math.round(this.fatigue.restMin)}분 후 다시 출발했습니다.`, actions: [] })
          this.arrivedAt = null
        }
        break
      }
      case 'waypoints':
        // Navi confirms (or not) that our stop is on the route; a missing stop means the driver removed it.
        if (this.waypoint && e.items.length && !e.items.some((w) => w.poiId === this.waypoint!.id || w.name === this.waypoint!.name)) {
          this.timeline.push({ t, level: 0, title: '경유지가 내비에서 제거됨', detail: '운전자가 내비에서 경유지를 지웠습니다. 다음 계획에서 다시 제안합니다.', actions: [] })
          this.waypoint = null
        }
        break
      case 'recentDestinations':
        this.recent = e.items
        break
      default:
        break
    }
  }

  subscribe(fn: (s: Snapshot) => void) {
    this.listeners.add(fn)
    fn(this.snapshot())
    return () => this.listeners.delete(fn)
  }

  /** Advance by real elapsed ms × timeScale (simulation) or just tick (native). */
  frame(realDtMs: number, timeScale: number) {
    if (this.bus.advance) {
      this.acc += realDtMs * timeScale
      let n = 0
      while (this.acc >= SUB_MS && n < 400) {
        this.bus.advance(SUB_MS)
        this.step()
        this.acc -= SUB_MS
        n++
      }
    } else {
      this.step()
    }
    this.emit()
  }

  private step() {
    const sig = this.bus.read()
    const prevT = this.fatigue.lastT
    const dtMin = Math.max(0, (sig.t - prevT) / 60000)
    const air = {
      occupants: sig.occupants,
      recirculation: sig.recirculation,
      fanSpeed: sig.fanSpeed,
      speedKph: sig.speedKph,
      windowOpenPct: sig.windowOpenPct ?? 0,
    }
    const before = this.co2
    this.co2 = stepCo2(this.co2, dtMin, air, DEFAULT_CABIN)
    if (!sig.recirculation && before > 1000) this.stats.co2Avoided += Math.max(0, before - this.co2)
    this.fatigue.setNapping(this.orch.mode === 'napping')
    this.fatigue.step(sig, this.co2)
    this.est = this.fatigue.estimate(sig, this.co2)
    this.stats.maxKss = Math.max(this.stats.maxKss, this.est.kss)
    if (sig.speedKph < 1 && sig.gear === 'P') this.stats.restMin += dtMin

    if (sig.t - this.lastPlanAt > 60_000 || !this.plan) {
      this.lastPlanAt = sig.t
      const curve = this.fatigue.forecastCurve(sig, this.est.kss, 240, 5)
      this.plan = planRest({
        stops: this.stopsFor(sig),
        progressKm: sig.routeProgressKm ?? 0,
        avgSpeedKph: 95,
        curve,
        timeOnTaskMin: this.fatigue.timeOnTaskMin,
        maxContinuousMin: this.fleetMode ? 120 : undefined,
        // EV low on charge: drowsy shelters have no chargers, so only service areas qualify.
        serviceOnly: (sig.socPct ?? 100) < 30,
        // Rain or a navi risk point ahead: keep a wider margin below the danger line.
        safeKss: sig.raining || sig.cautionType ? 6.3 : undefined,
      })
    }

    // While a rest stop is accepted, only re-plan if the forecast says it is no longer reachable safely.
    let planForOrch = this.plan
    if (this.waypoint) {
      const wp = this.waypoint
      const eta = ((wp.km - (sig.routeProgressKm ?? 0)) / 95) * 60
      const unsafe = this.est.minutesToDanger !== null && this.est.minutesToDanger < eta
      planForOrch = unsafe && this.plan && this.plan.stop.km < wp.km ? this.plan : null
    }
    const events = this.orch.tick({ sig, co2: this.co2, est: this.est, plan: planForOrch })
    for (const ev of events) this.execute(ev)

    // Arrived at the accepted rest stop → parked. Auto-pilot accepts the nap offer.
    if (this.waypoint && sig.gear === 'P' && this.orch.mode === 'parked' && this.autoPilot) {
      this.execute(this.orch.startNap(sig.t, 20))
      this.waypoint = null
    }

    // Auto-pilot: the simulated driver answers proposals after a short moment.
    if (this.proposal && this.autoPilot && performance.now() - this.proposal.createdWall > 4200) this.acceptProposal()

    if (sig.t - this.lastSample >= 60_000) {
      this.lastSample = sig.t
      this.history.push({
        t: sig.t,
        km: sig.routeProgressKm ?? 0,
        kss: this.est.kss,
        co2: this.co2,
        speed: sig.speedKph,
        cabinTemp: sig.cabinTempC ?? sig.setTempC,
        level: this.est.level,
        recirc: sig.recirculation,
      })
      if (this.history.length > 1200) this.history.shift()
    }
  }

  private stopsFor(sig: VehicleSignals): RestStop[] {
    if (sig.onRoute !== false || !sig.position || !this.freeRoamStops.length) return this.stops
    const heading = sig.speedKph > 5 ? sig.headingDeg : undefined
    return stopsAhead(this.freeRoamStops, sig.position, heading, sig.routeProgressKm ?? 0)
  }

  execute(ev: TimelineEvent) {
    this.timeline.push(ev)
    if (this.timeline.length > 200) this.timeline.shift()
    if (ev.level > 0) this.stats.interventions += 1
    const t = ev.t
    for (const a of ev.actions) this.applyAction(a, t)
  }

  applyAction(a: VehicleAction, t: number) {
    switch (a.kind) {
      case 'waypoint': {
        const v = a.value as { stop: RestStop; needsConfirm: boolean }
        if (v.needsConfirm) {
          this.proposal = {
            id: `${v.stop.id}-${t}`,
            stop: v.stop,
            etaMin: this.plan?.stop.id === v.stop.id ? this.plan.etaMin : 0,
            createdAt: t,
            createdWall: performance.now(),
          }
          // Refine the model's ETA with the navigation's own route (answer arrives as a 'tripInfo' event).
          this.bus.tripTo?.(v.stop)
        } else void this.commitWaypoint(v.stop)
        return
      }
      case 'speak':
        this.speaking = String(a.value)
        this.hooks.speak?.(String(a.value))
        return
      case 'engage':
        this.fatigue.boost('engage', 0.9, t, 12, true)
        this.hooks.engage?.()
        setTimeout(() => this.fatigue.endBoost('engage', this.bus.read().t), 6000)
        return
      case 'probe':
        if (this.bus.kind === 'sim' && this.autoPilot) this.simulateProbe()
        else this.hooks.probe?.()
        return
      case 'temperature':
        if (Number(a.value) < this.bus.read().setTempC) this.fatigue.boost('cool', 0.35, t, 15)
        break
      case 'napStart':
        this.fatigue.setNapping(true)
        break
      case 'napWake':
        this.fatigue.setNapping(false)
        this.fatigue.boost('nap', 0.4, t, 40)
        break
    }
    void this.bus.apply(a)
  }

  async commitWaypoint(stop: RestStop) {
    this.waypoint = stop
    this.orch.acceptStop(stop.id)
    const ok = await this.bus.addWaypoint(stop)
    if (!ok && this.waypoint === stop) this.waypoint = null
  }

  acceptProposal() {
    if (!this.proposal) return
    const stop = this.proposal.stop
    this.proposal = null
    const t = this.bus.read().t
    this.timeline.push({
      t,
      level: 0,
      title: `경유지 추가 · ${stop.name}`,
      detail: 'NaviHelper로 현재 경로에 경유지를 추가했습니다.',
      actions: [{ kind: 'waypoint', value: { stop, needsConfirm: false }, reason: '운전자 음성 승인' }],
    })
    this.hooks.speak?.('plan_accept')
    void this.commitWaypoint(stop)
  }

  declineProposal() {
    this.proposal = null
  }

  /** Driver cancels the accepted rest stop: remove the navi waypoint and its geofence. */
  cancelWaypoint() {
    const stop = this.waypoint
    if (!stop) return
    this.waypoint = null
    this.arrivedAt = null
    void this.bus.removeWaypoint?.()
    this.timeline.push({
      t: this.bus.read().t,
      level: 0,
      title: `경유지 취소 · ${stop.name}`,
      detail: 'NaviHelper.removeWaypoint로 경유지를 지웠습니다. 졸음 위험이 커지면 다시 제안합니다.',
      actions: [],
    })
  }

  startNap(minutes = 20) {
    this.execute(this.orch.startNap(this.bus.read().t, minutes))
    this.waypoint = null
  }

  wakeNow() {
    this.execute(this.orch.wake(this.bus.read().t))
  }

  recordProbe(reactionMs: number, correct = true) {
    const t = this.bus.read().t
    const p: ProbeResult = { t, reactionMs, correct, lapse: reactionMs > 500 || !correct }
    this.fatigue.addProbe(p)
    this.timeline.push({
      t,
      level: p.lapse ? 3 : 0,
      title: `음성 반응속도 ${Math.round(reactionMs)}ms${p.lapse ? ' · 지연(lapse)' : ''}`,
      detail: `측정 기반 추정 KSS ${kssFromReaction(reactionMs, p.lapse).toFixed(1)}`,
      actions: [],
    })
  }

  private simulateProbe() {
    // The simulated driver's reaction time tracks their true sleepiness plus noise.
    const k = this.est.kss
    const rt = 190 + 46 * (k - 1) + (Math.random() - 0.5) * 60
    setTimeout(() => this.recordProbe(rt, rt < 620), 900)
  }

  snapshot(): Snapshot {
    const sig = this.bus.read()
    return {
      sig,
      co2: this.co2,
      est: this.est,
      plan: this.plan,
      mode: this.orch.mode,
      timeline: this.timeline.slice(-60),
      history: this.history,
      proposal: this.proposal,
      waypoint: this.waypoint,
      caps: this.bus.capabilities(),
      napRemainingMin: this.orch.mode === 'napping' ? Math.max(0, (this.orch.napEndsAt - sig.t) / 60000) : null,
      probes: this.fatigue.probes.slice(-8),
      speaking: this.speaking,
      stats: { ...this.stats },
      trip: this.trip,
      recent: this.recent,
      arrivedAt: this.arrivedAt,
    }
  }

  private emit() {
    const s = this.snapshot()
    for (const l of this.listeners) l(s)
  }
}
