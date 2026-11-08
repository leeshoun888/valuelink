// Fleet Safety Console (B2B): a corporate-car / rental fleet safety manager watching every
// Pleos Connect passenger car that runs KKAEUM. Every vehicle is a real, independent engine instance · its own
// SimVehicle, FatigueModel, rest planner and orchestrator · driven by one shared clock.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { Map as MlMap, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import mlWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { area, curveMonotoneX, line, scaleLinear } from 'd3'
import { Runtime, type Snapshot } from '../engine/runtime'
import { SCENARIOS, SimVehicle, type ScenarioConfig } from '../engine/sim'
import { ROUTE } from '../engine/route'
import type { RestStop, RiskLevel, TimelineEvent } from '../engine/types'
import { REST_STOPS } from '../data/stops'
import { normalise, periodicPayload, WebhookVehicle, type FleetSample, type FleetUpdate } from '../fleet/pleosFleet'
import { LEVEL, clock, dur, kssColor } from '../ui/format'
import { IcAlert, IcCheck, IcPause, IcPlay, IcCar, Logo } from '../ui/icons'
import './fleet.css'

// ─── Simulation ──────────────────────────────────────────────────────────────

const FLEET_SIZE = 24
const COMPANY = '한빛모빌리티'
const LIMIT_MIN = 120 // 회사 안전정책: 2시간 연속운전마다 15분 휴식 (고속도로 휴식 권장 기준 준용)
const STEP_MS = 10_000 // Runtime sub-step
const AVG_KPH = 95

const BASE: ScenarioConfig = SCENARIOS.find((s) => s.id === 'fleet-dawn') ?? SCENARIOS[SCENARIOS.length - 1]

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const RENTAL_LETTERS = ['하', '허', '호'] // 대여사업용(렌터카) 번호판 용도기호
const CORP_LETTERS = ['가', '나', '다', '라', '마', '거', '너', '더', '러', '머', '고', '노', '도', '로', '모'] // 자가용(법인 명의)
const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '송', '전', '홍', '문']

export interface FeedItem {
  id: string
  t: number
  truckId: string
  plate: string
  level: RiskLevel
  kind: 'risk' | 'accept' | 'decline' | 'dispatch' | 'rest' | 'violation' | 'trip'
  title: string
  detail: string
}

export interface Truck {
  id: string
  plate: string
  driver: string
  sleepHours: number
  departedAt: number
  sim: SimVehicle
  rt: Runtime
  snap: Snapshot
  arrivedAt: number | null
  maxTot: number
  prevRest: number
  reluctance: number // probability the (simulated) driver turns a rest proposal down
  regSent: boolean
  violated: boolean
  rests: number
  accepted: number
  declined: number
  prevented: number
  seen: WeakSet<TimelineEvent>
}

/** Fleet clock starts at 04:10 today · the circadian trough where night line-haul drivers are most at risk. */
function fleetEpoch() {
  const d = new Date()
  d.setHours(4, 10, 0, 0)
  return d.getTime()
}

class FleetSim {
  trucks: Truck[] = []
  feed: FeedItem[] = []
  now: number
  private rnd: () => number
  private serial = 0
  private feedSeq = 0
  /** Day totals · survive vehicle re-dispatch. */
  totals = { trips: 0, violatedTrips: 0, rests: 0, accepted: 0, declined: 0, prevented: 0, dispatches: 0 }
  /** Pleos Fleet API Webhook "Periodic Data" bodies (10S_30S), as a real fleet would deliver them. */
  onPayload?: (payload: ReturnType<typeof periodicPayload>) => void
  payloads = 0
  private samples = new Map<string, FleetSample[]>()
  private lastSampleAt = new Map<string, number>()

  constructor(seed = 20261103) {
    this.rnd = mulberry32(seed)
    this.now = fleetEpoch()
  }

  get ready() {
    return this.trucks.length >= FLEET_SIZE
  }

  private plate() {
    const r = this.rnd
    const cls = 100 + Math.floor(r() * 600)
    const pool = r() < 0.6 ? RENTAL_LETTERS : CORP_LETTERS
    const letter = pool[Math.floor(r() * pool.length)]
    const num = 1000 + Math.floor(r() * 9000)
    return `${cls}${letter} ${num}`
  }

  /** Create one truck. `hoursAgo` > 0 replays its trip from departure to `now` so its state is earned, not mocked. */
  private makeTruck(slot: string, hoursAgo: number, startKm: number): Truck {
    const r = this.rnd
    const departedAt = this.now - Math.round(hoursAgo * 360) * STEP_MS
    const sleepHours = 4 + Math.pow(r(), 1.5) * 4 // 4–8 h, skewed short (dawn business trips)
    const awakeBefore = 1 + r() * 9 // some slept right before departure, some have been up since the afternoon
    const reluctance = r() < 0.6 ? 0 : 0.3 + r() * 0.4
    const scenario: ScenarioConfig = {
      ...BASE,
      id: `fleet-${slot}`,
      startHour: new Date(departedAt).getHours(),
      startMinute: new Date(departedAt).getMinutes(),
      sleepHours,
      occupants: 1,
      fleet: true,
    }
    const sim = new SimVehicle(scenario, departedAt, ROUTE, 1000 + this.serial * 7919)
    sim.km = startKm
    const surname = SURNAMES[Math.floor(r() * SURNAMES.length)]
    const rt = new Runtime(
      sim,
      { name: `${surname}○○`, wakeTime: departedAt - awakeBefore * 3.6e6, sleepHours, chronotype: (r() - 0.5) * 0.8 },
      REST_STOPS,
    )
    rt.fleetMode = true
    rt.autoPilot = true
    rt.hooks = {} // fleet monitoring: no audio, no on-screen probes
    this.serial++
    this.totals.trips++

    const truck = {
      id: slot,
      plate: this.plate(),
      driver: `${surname}○○`,
      sleepHours,
      departedAt,
      sim,
      rt,
      snap: rt.snapshot(),
      arrivedAt: null,
      maxTot: 0,
      prevRest: 0,
      reluctance,
      regSent: false,
      violated: false,
      rests: 0,
      accepted: 0,
      declined: 0,
      prevented: 0,
      seen: new WeakSet<TimelineEvent>(),
    } as Truck
    rt.subscribe((s) => (truck.snap = s))

    // Count rest proposals accepted while the driver is still below KSS 7 → a prevented risk segment.
    // Some drivers push on instead: the proposal is declined and the engine has to re-plan / escalate.
    const accept = rt.acceptProposal.bind(rt)
    rt.acceptProposal = () => {
      const p = rt.proposal
      if (!p) return
      if (this.rnd() < truck.reluctance) {
        truck.declined++
        this.totals.declined++
        rt.declineProposal()
        this.push(truck, { t: rt.bus.read().t, level: Math.max(2, truck.snap.est.level) as RiskLevel, kind: 'decline', title: `휴식 제안 거절 · ${p.stop.name}`, detail: `KSS ${truck.snap.est.kss.toFixed(1)} · 운행 계속 · 깨움이 다음 쉼터로 재계획합니다` })
        return
      }
      truck.accepted++
      this.totals.accepted++
      if (truck.snap.est.kss < 7) (truck.prevented++, this.totals.prevented++)
      accept()
    }

    // Replay the trip up to "now". Wall-clock auto-accept can't elapse during replay, so the
    // simulated driver answers each proposal at the end of its minute.
    while (sim.t < this.now) {
      rt.frame(Math.min(60_000, this.now - sim.t), 1)
      if (rt.proposal) rt.acceptProposal()
      this.observe(truck)
    }
    this.collect(truck)
    return truck
  }

  /** Builds one more truck (called repeatedly so the warm-up never blocks a frame for long). */
  buildNext() {
    if (this.ready) return
    const i = this.trucks.length
    const r = this.rnd
    const hoursAgo = 0.05 + r() * 3.95
    const startKm = r() < 0.7 ? 0 : r() * Math.max(0, 390 - hoursAgo * AVG_KPH) // 서울 출발 or 중간 지점(대전 지사 등) 출발
    this.trucks.push(this.makeTruck(`T${String(i + 1).padStart(2, '0')}`, hoursAgo, Math.min(startKm, Math.max(0, 390 - hoursAgo * AVG_KPH))))
  }

  tick(realDtMs: number, scale: number) {
    if (!this.ready || scale <= 0) return
    this.now += realDtMs * scale
    for (let i = 0; i < this.trucks.length; i++) {
      const tr = this.trucks[i]
      if (tr.arrivedAt !== null) {
        // ~40 min on site in Busan, then the slot is re-dispatched to a new trip from Seoul HQ.
        if (this.now - tr.arrivedAt > 40 * 60_000) {
          const next = this.makeTruck(tr.id, 0, 0)
          this.trucks[i] = next
          this.push(next, { t: this.now, level: 0, kind: 'trip', title: '신규 출장 배차 · 서울 본사 출발', detail: `${next.driver} 님 · 수면 ${next.sleepHours.toFixed(1)}h 자가신고` })
        }
        continue
      }
      tr.rt.frame(realDtMs, scale)
      this.sample(tr)
      // The simulated driver answers a voice proposal ~90 s (sim time) after it is made, at any time scale.
      const pr = tr.rt.proposal
      if (pr && tr.sim.t - pr.createdAt >= 90_000) tr.rt.acceptProposal()
      this.observe(tr)
      this.collect(tr)
    }
  }

  /** Every 10 s of vehicle time take a sample; every third one ships as a webhook payload. */
  private sample(tr: Truck) {
    const t = tr.sim.t
    if (t - (this.lastSampleAt.get(tr.id) ?? 0) < 10_000) return
    this.lastSampleAt.set(tr.id, t)
    const sig = tr.sim.read()
    const buf = this.samples.get(tr.id) ?? []
    buf.push({ t, speedKph: sig.speedKph, lat: sig.position?.[1] ?? 0, lon: sig.position?.[0] ?? 0, odometerKm: 41_200 + tr.sim.km, socPct: sig.socPct, dteKm: sig.rangeKm })
    if (buf.length >= 3) {
      this.payloads++
      this.onPayload?.(periodicPayload(`kkaeum-sim-${tr.id}`, `KMHKKAEUM${tr.plate.replace(/\D/g, '').padStart(8, '0')}`, buf))
      this.samples.set(tr.id, [])
    } else this.samples.set(tr.id, buf)
  }

  /** Regulation bookkeeping from the engine's own time-on-task counter. */
  private observe(tr: Truck) {
    const tot = tr.rt.fatigue.timeOnTaskMin
    const t = tr.sim.t
    tr.maxTot = Math.max(tr.maxTot, tot)
    if (tot > LIMIT_MIN && !tr.violated) {
      tr.violated = true
      this.totals.violatedTrips++
      this.push(tr, { t, level: 3, kind: 'violation', title: '연속운전 2시간 초과', detail: `휴식 없이 ${Math.round(tot)}분 운행 · 회사 안전정책(2시간마다 15분 휴식) 미준수` })
    }
    const rest = tr.rt.fatigue.restMin
    if (tr.prevRest < 15 && rest >= 15) {
      tr.rests++
      this.totals.rests++
      tr.regSent = false
      this.push(tr, { t, level: 0, kind: 'rest', title: '15분 휴식 충족 · 연속운전 리셋', detail: `${regionAt(tr.sim.km)} 정차 · 안전정책 휴식 요건 충족` })
    }
    tr.prevRest = rest
    // Fleet-side regulation guard: the engine proposes rest on predicted sleepiness; for commercial
    // vehicles the console also pushes a rest waypoint before the 2-hour continuous-driving limit.
    const rt = tr.rt
    if (tot >= 95 && tot <= LIMIT_MIN && !tr.regSent && !rt.waypoint && !rt.proposal && tr.snap.sig.speedKph > 3) {
      const km = tr.sim.km
      const plan = tr.snap.plan
      const stop =
        plan && plan.etaMin <= LIMIT_MIN - tot ? plan.stop : STOPS_BY_KM.find((s) => s.km > km + 0.8)
      if (stop) {
        tr.regSent = true
        this.totals.dispatches++
        const title = `관제 정책 휴식 안내 · ${stop.name}`
        const detail = `연속운전 ${Math.round(tot)}분, 2시간 도달 전 15분 휴식 경유지를 Pleos Fleet에서 전송했습니다.`
        rt.execute({ t, level: 1, title, detail, actions: [{ kind: 'waypoint', value: { stop, needsConfirm: true }, reason: '회사 안전정책 · 2시간마다 15분 휴식' }] })
        this.push(tr, { t, level: 1, kind: 'dispatch', title, detail })
      }
    }
    if (tot < 30) tr.regSent = false
    if (tr.sim.km >= ROUTE.totalKm - 0.3 && tr.arrivedAt === null) {
      tr.arrivedAt = t
      this.push(tr, { t, level: 0, kind: 'trip', title: '운행 완료 · 부산 사업장 도착', detail: `운행 ${dur((t - tr.departedAt) / 60000)} · 최대 연속운전 ${Math.round(tr.maxTot)}분` })
    }
  }

  /** Pull new engine timeline events into the fleet-wide alert feed. */
  private collect(tr: Truck) {
    const tl = tr.rt.timeline
    const fresh: TimelineEvent[] = []
    for (let k = tl.length - 1; k >= 0; k--) {
      const ev = tl[k]
      if (tr.seen.has(ev)) break
      tr.seen.add(ev)
      fresh.push(ev)
    }
    for (const ev of fresh.reverse()) {
      const accept = ev.title.startsWith('경유지 추가')
      if (ev.level < 2 && !accept) continue
      this.push(tr, { t: ev.t, level: ev.level, kind: accept ? 'accept' : 'risk', title: ev.title, detail: ev.detail })
    }
  }

  private push(tr: Truck, it: Omit<FeedItem, 'id' | 'truckId' | 'plate'>) {
    this.feed.push({ ...it, id: `f${this.feedSeq++}`, truckId: tr.id, plate: tr.plate })
    if (this.feed.length > 400) this.feed.splice(0, this.feed.length - 400)
  }

  sortedFeed() {
    return [...this.feed].sort((a, b) => b.t - a.t)
  }
}

// ─── Derived view model ──────────────────────────────────────────────────────

const STOPS_BY_KM = [...REST_STOPS].sort((a, b) => a.km - b.km)
function regionAt(km: number) {
  if (km < 14) return '수도권 진입로'
  if (km > ROUTE.totalKm - 12) return '부산 도심'
  let best = STOPS_BY_KM[0]
  for (const s of STOPS_BY_KM) if (Math.abs(s.km - km) < Math.abs(best.km - km)) best = s
  return `${best.name.replace(/\s*(휴게소|졸음쉼터).*$/, '')} 부근`
}
const shortStop = (s: RestStop) => s.name.replace(/\s+졸음쉼터/, ' 쉼터')

type Status = 'driving' | 'rest' | 'nap' | 'arrived'
function statusOf(tr: Truck): Status {
  if (tr.arrivedAt !== null) return 'arrived'
  if (tr.snap.mode === 'napping' || tr.snap.mode === 'waking') return 'nap'
  if (tr.snap.sig.speedKph < 1) return 'rest'
  return 'driving'
}
const STATUS_LABEL: Record<Status, string> = { driving: '운행', rest: '휴식', nap: '파워냅', arrived: '도착' }

interface NextRest {
  stop: RestStop
  etaMin: number
  state: '경유 확정' | '제안 중' | '계획'
}
function nextRest(tr: Truck): NextRest | null {
  const s = tr.snap
  const km = s.sig.routeProgressKm ?? 0
  const stop = s.waypoint ?? s.proposal?.stop ?? s.plan?.stop
  if (!stop || statusOf(tr) !== 'driving') return null
  return { stop, etaMin: Math.max(0, ((stop.km - km) / AVG_KPH) * 60), state: s.waypoint ? '경유 확정' : s.proposal ? '제안 중' : '계획' }
}

function totColor(min: number) {
  if (min > LIMIT_MIN) return 'var(--l4)'
  if (min > 100) return 'var(--amber)'
  return 'var(--aurora)'
}

// ─── Small UI atoms ──────────────────────────────────────────────────────────

function useTween(value: number, duration = 0.7) {
  const [shown, setShown] = useState(value)
  const cur = useRef(value)
  useEffect(() => {
    const c = animate(cur.current, value, {
      duration,
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: (v) => {
        cur.current = v
        setShown(v)
      },
    })
    return () => c.stop()
  }, [value, duration])
  return shown
}

function Num({ value, digits = 0, suffix }: { value: number; digits?: number; suffix?: string }) {
  const v = useTween(value)
  return (
    <span className="num">
      {v.toFixed(digits)}
      {suffix && <small>{suffix}</small>}
    </span>
  )
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function LevelChip({ level }: { level: RiskLevel }) {
  const L = LEVEL[level]
  return (
    <span className="fl-lv" style={{ ['--c' as string]: L.hex }}>
      <i />
      L{level} {L.name}
    </span>
  )
}

function Spark({ hist, kss }: { hist: Snapshot['history']; kss: number }) {
  const pts = hist.slice(-90)
  const W = 76
  const H = 24
  const y = (k: number) => H - 2 - ((k - 1) / 8) * (H - 4)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, pts.length - 1)) * W).toFixed(1)},${y(p.kss).toFixed(1)}`).join('')
  return (
    <svg className="fl-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <line x1="0" x2={W} y1={y(7)} y2={y(7)} className="thr" />
      {pts.length > 1 && <path d={d} stroke={kssColor(kss)} />}
    </svg>
  )
}

function Kpi({ label, children, sub, tone, icon }: { label: string; children: ReactNode; sub: ReactNode; tone?: string; icon?: ReactNode }) {
  return (
    <div className="fl-kpi glass" style={tone ? { ['--tone' as string]: tone } : undefined}>
      <div className="eyebrow">
        {icon}
        {label}
      </div>
      <div className="fl-kpi-v">{children}</div>
      <div className="fl-kpi-s">{sub}</div>
    </div>
  )
}

// maplibre v6 locates its worker next to its own module URL, which Vite's dep pre-bundling
// breaks in dev; point it at the real file explicitly (works in dev and build).
setWorkerUrl(mlWorkerUrl)

// ─── Map ─────────────────────────────────────────────────────────────────────

function FleetMap({ fleet, selected, onSelect }: { fleet: FleetSim; selected: string | null; onSelect: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const markers = useRef(new Map<string, { m: Marker; el: HTMLDivElement; key: string; plate: string }>())
  const sel = useRef(selected)
  const pick = useRef(onSelect)
  sel.current = selected
  pick.current = onSelect

  useEffect(() => {
    const lngs = ROUTE.points.map((p) => p[0])
    const lats = ROUTE.points.map((p) => p[1])
    const m = new MlMap({
      container: el.current!,
      style: 'https://tiles.openfreemap.org/styles/dark',
      bounds: [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      fitBoundsOptions: { padding: { top: 40, bottom: 40, left: 40, right: 40 } },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    })
    map.current = m
    m.on('load', () => {
      for (const layer of m.getStyle().layers ?? []) {
        if (layer.type === 'background') m.setPaintProperty(layer.id, 'background-color', '#05080d')
        if (layer.id.includes('water') && layer.type === 'fill') m.setPaintProperty(layer.id, 'fill-color', '#08131f')
      }
      m.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ROUTE.points.map((p) => [p[0], p[1]]) } } })
      m.addLayer({ id: 'route-glow', type: 'line', source: 'route', paint: { 'line-color': '#3CF2C8', 'line-width': 10, 'line-blur': 8, 'line-opacity': 0.12 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#2a3a52', 'line-width': 3 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      m.addSource('stops', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: REST_STOPS.map((s) => ({ type: 'Feature', properties: { name: s.name, kind: s.kind }, geometry: { type: 'Point', coordinates: s.lngLat } })) },
      })
      m.addLayer({ id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-radius': ['match', ['get', 'kind'], 'service', 3.2, 2.2], 'circle-color': ['match', ['get', 'kind'], 'service', '#c9d6ea', '#3CF2C8'], 'circle-opacity': 0.75, 'circle-stroke-width': 1, 'circle-stroke-color': '#05080d' } })
      m.addSource('target', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'target', type: 'circle', source: 'target', paint: { 'circle-radius': 11, 'circle-color': 'rgba(255,181,71,0.10)', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#FFB547' } })
      m.addLayer({ id: 'target-label', type: 'symbol', source: 'target', layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.6], 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#FFB547', 'text-halo-color': '#05080d', 'text-halo-width': 1.5 } })
    })
    const mk = markers.current
    return () => {
      mk.clear()
      m.remove()
    }
  }, [])

  // Marker positions follow the engine every animation frame; DOM classes only change on state change.
  useEffect(() => {
    let raf = 0
    let lastTarget = 0
    const loop = (now: number) => {
      const m = map.current
      if (m) {
        const live = new Set<string>()
        for (const tr of fleet.trucks) {
          live.add(tr.id)
          let rec = markers.current.get(tr.id)
          if (rec && rec.plate !== tr.plate) {
            rec.m.remove()
            markers.current.delete(tr.id)
            rec = undefined
          }
          if (!rec) {
            // Maplibre owns the wrapper's classes/transform; we only restyle the inner element.
            const wrap = document.createElement('div')
            const div = document.createElement('div')
            div.className = 'fl-mk'
            div.innerHTML = '<span class="ring"></span><span class="core"></span><b></b>'
            div.querySelector('b')!.textContent = tr.plate.split(' ').slice(1).join(' ')
            wrap.appendChild(div)
            wrap.addEventListener('click', (e) => {
              e.stopPropagation()
              pick.current(tr.id)
            })
            rec = { m: new Marker({ element: wrap }).setLngLat(tr.snap.sig.position ?? [127, 37.5]).addTo(m), el: div, key: '', plate: tr.plate }
            markers.current.set(tr.id, rec)
          }
          const pos = tr.snap.sig.position
          if (pos) rec.m.setLngLat(pos)
          const st = statusOf(tr)
          const lv = tr.snap.est.level
          const key = `${lv}|${st}|${sel.current === tr.id}`
          if (key !== rec.key) {
            rec.key = key
            rec.el.style.setProperty('--c', LEVEL[lv].hex)
            rec.el.className = `fl-mk lv${lv} s-${st}${lv >= 3 && st === 'driving' ? ' hot' : ''}${sel.current === tr.id ? ' sel' : ''}`
            rec.m.getElement().style.zIndex = sel.current === tr.id ? '5' : String(1 + lv)
            rec.el.title = `${tr.plate} · KSS ${tr.snap.est.kss.toFixed(1)}`
          }
        }
        for (const [id, rec] of markers.current) if (!live.has(id)) (rec.m.remove(), markers.current.delete(id))

        if (now - lastTarget > 400 && m.getSource('target')) {
          lastTarget = now
          const tr = fleet.trucks.find((x) => x.id === sel.current)
          const nr = tr ? nextRest(tr) : null
          ;(m.getSource('target') as GeoJSONSource).setData({
            type: 'FeatureCollection',
            features: nr ? [{ type: 'Feature', properties: { name: nr.stop.name }, geometry: { type: 'Point', coordinates: nr.stop.lngLat } }] : [],
          })
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [fleet])

  return <div ref={el} className="fl-map" />
}

// ─── Selected vehicle ────────────────────────────────────────────────────────

const H = 170
const m = { l: 30, r: 40, t: 10, b: 20 }

function TripChart({ tr }: { tr: Truck }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const hist = tr.snap.history
  const W = Math.max(240, w)
  const chart = useMemo(() => {
    if (hist.length < 2) return null
    const t0 = hist[0].t
    const t1 = Math.max(hist[hist.length - 1].t, t0 + 30 * 60_000)
    const x = scaleLinear().domain([t0, t1]).range([m.l, W - m.r])
    const y = scaleLinear().domain([1, 9]).range([H - m.b, m.t])
    const co2Max = Math.max(1600, ...hist.map((h) => h.co2)) * 1.05
    const yc = scaleLinear().domain([400, co2Max]).range([H - m.b, m.t])
    const kssLine = line<(typeof hist)[number]>().x((d) => x(d.t)).y((d) => y(d.kss)).curve(curveMonotoneX)(hist) ?? ''
    const kssArea = area<(typeof hist)[number]>().x((d) => x(d.t)).y0(H - m.b).y1((d) => y(d.kss)).curve(curveMonotoneX)(hist) ?? ''
    const co2Line = line<(typeof hist)[number]>().x((d) => x(d.t)).y((d) => yc(d.co2)).curve(curveMonotoneX)(hist) ?? ''
    // Rest periods (stationary) as shaded bands.
    const rests: [number, number][] = []
    let start: number | null = null
    for (const h of hist) {
      if (h.speed < 1 && start === null) start = h.t
      if (h.speed >= 1 && start !== null) (rests.push([start, h.t]), (start = null))
    }
    if (start !== null) rests.push([start, hist[hist.length - 1].t])
    const ticks: number[] = []
    const stepMs = (t1 - t0) / 60_000 > 150 ? 60 * 60_000 : 30 * 60_000
    for (let t = Math.ceil(t0 / stepMs) * stepMs; t <= t1; t += stepMs) ticks.push(t)
    return { x, y, yc, kssLine, kssArea, co2Line, rests, ticks, co2Max }
  }, [hist, hist.length, hist[hist.length - 1]?.t, W]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={ref} className="fl-chart">
      {chart ? (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <linearGradient id="fl-kss-grad" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={chart.y(1)} y2={chart.y(9)}>
              {[1, 5, 6, 7, 8.5, 9].map((k) => (
                <stop key={k} offset={(k - 1) / 8} stopColor={kssColor(k)} />
              ))}
            </linearGradient>
            <linearGradient id="fl-kss-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#3CF2C8" stopOpacity="0.16" />
              <stop offset="1" stopColor="#3CF2C8" stopOpacity="0" />
            </linearGradient>
          </defs>
          {chart.rests.map(([a, b], i) => (
            <rect key={i} className="rest" x={chart.x(a)} width={Math.max(2, chart.x(b) - chart.x(a))} y={m.t} height={H - m.t - m.b} />
          ))}
          {[3, 5, 7, 9].map((k) => (
            <g key={k}>
              <line className={k === 7 ? 'thr' : 'grid'} x1={m.l} x2={W - m.r} y1={chart.y(k)} y2={chart.y(k)} />
              <text className="ax" x={m.l - 6} y={chart.y(k) + 3} textAnchor="end">
                {k}
              </text>
            </g>
          ))}
          {[1000, 2000].filter((p) => p < chart.co2Max).map((p) => (
            <text key={p} className="ax co2" x={W - m.r + 6} y={chart.yc(p) + 3}>
              {p / 1000}k
            </text>
          ))}
          {chart.ticks.map((t) => (
            <text key={t} className="ax" x={chart.x(t)} y={H - 4} textAnchor="middle">
              {clock(t)}
            </text>
          ))}
          <path d={chart.kssArea} fill="url(#fl-kss-fill)" />
          <path d={chart.co2Line} className="co2l" />
          <path d={chart.kssLine} className="kssl" stroke="url(#fl-kss-grad)" />
        </svg>
      ) : (
        <div className="fl-empty">운행 데이터 수집 중…</div>
      )}
      <div className="fl-legend">
        <span>
          <i className="k" /> KSS (1–9)
        </span>
        <span>
          <i className="c" /> 실내 CO₂ ppm
        </span>
        <span>
          <i className="r" /> 정차·휴식
        </span>
        <span>
          <i className="t" /> KSS 7 위험선
        </span>
      </div>
    </div>
  )
}

function Contributions({ tr }: { tr: Truck }) {
  const cs = tr.snap.est.contributions
  const max = Math.max(1, ...cs.map((c) => Math.abs(c.value)))
  return (
    <div className="fl-contrib">
      {cs.map((c) => {
        const f = Math.abs(c.value) / max
        const pos = c.value >= 0
        return (
          <div key={c.key} className={`row${Math.abs(c.value) < 0.03 ? ' dim' : ''}`}>
            <span className="lab">{c.label}</span>
            <span className="bar">
              <span className="axis" />
              <motion.span
                className={pos ? 'pos' : 'neg'}
                initial={false}
                animate={{ width: `${f * 50}%`, left: pos ? '50%' : `${50 - f * 50}%` }}
                transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
              />
            </span>
            <span className="val num">
              {pos ? '+' : '−'}
              {Math.abs(c.value).toFixed(2)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function VehiclePanel({ tr }: { tr: Truck | undefined }) {
  if (!tr) return <section className="fl-detail glass fl-empty">지도나 목록에서 차량을 선택하세요.</section>
  const s = tr.snap
  const st = statusOf(tr)
  const km = s.sig.routeProgressKm ?? 0
  const nr = nextRest(tr)
  const recent = [...tr.rt.timeline].reverse().filter((e) => e.level > 0 || e.title.startsWith('경유지') || e.title.startsWith('파워냅')).slice(0, 6)
  const tot = tr.rt.fatigue.timeOnTaskMin
  return (
    <section className="fl-detail glass">
      <header className="fl-dh">
        <div>
          <div className="eyebrow">선택 차량 · {tr.id}</div>
          <h3>
            {tr.plate} <span>{tr.driver} 님</span>
          </h3>
        </div>
        <div className="fl-dh-chips">
          <span className={`chip st-${st}`}>{STATUS_LABEL[st]}</span>
          <LevelChip level={s.est.level} />
        </div>
      </header>
      <div className="fl-facts">
        <div>
          <span>KSS</span>
          <b className="num" style={{ color: kssColor(s.est.kss) }}>
            {s.est.kss.toFixed(1)}
          </b>
        </div>
        <div>
          <span>위치</span>
          <b className="num">{km.toFixed(0)} km</b>
          <em>{regionAt(km)}</em>
        </div>
        <div>
          <span>연속운전</span>
          <b className="num" style={{ color: totColor(tot) }}>
            {Math.round(tot)}분
          </b>
          <em>최대 {Math.round(tr.maxTot)}분</em>
        </div>
        <div>
          <span>졸음 위험까지</span>
          <b className="num">{s.est.minutesToDanger === null ? '6h+' : dur(s.est.minutesToDanger)}</b>
          <em>수면 {tr.sleepHours.toFixed(1)}h</em>
        </div>
        <div>
          <span>다음 휴식</span>
          <b>{nr ? shortStop(nr.stop) : '-'}</b>
          <em>{nr ? `${nr.state} · ${clock(s.sig.t + nr.etaMin * 60_000)}` : st === 'arrived' ? '운행 종료' : st !== 'driving' ? '휴식 중' : ''}</em>
        </div>
      </div>
      <div className="fl-dgrid">
        <div>
          <div className="fl-sub">
            KSS · 실내 CO₂ <span>출발 {clock(tr.departedAt)} 이후</span>
          </div>
          <TripChart tr={tr} />
        </div>
        <div>
          <div className="fl-sub">
            졸음 요인 분해 <span>KSS 기여도 (±점)</span>
          </div>
          <Contributions tr={tr} />
        </div>
      </div>
      <div className="fl-sub">
        최근 개입 <span>깨움 오케스트레이터</span>
      </div>
      <ol className="fl-iv">
        {recent.length === 0 && <li className="fl-empty">아직 개입 없음 · 각성 상태 양호</li>}
        {recent.map((e, i) => (
          <li key={`${e.t}-${i}`}>
            <span className="t num">{clock(e.t)}</span>
            <i style={{ background: LEVEL[e.level].hex }} />
            <div>
              <b>{e.title}</b>
              <p>{e.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

// ─── Vehicle list ────────────────────────────────────────────────────────────

type SortKey = 'plate' | 'km' | 'tot' | 'kss' | 'eta'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'plate', label: '차량 · 운전자' },
  { key: 'km', label: '현재 위치' },
  { key: 'tot', label: '연속운전' },
  { key: 'kss', label: 'KSS 추이' },
  { key: 'eta', label: '다음 휴식' },
]
function sortVal(tr: Truck, k: SortKey): number | string {
  switch (k) {
    case 'plate':
      return tr.plate
    case 'km':
      return tr.snap.sig.routeProgressKm ?? 0
    case 'tot':
      return tr.rt.fatigue.timeOnTaskMin
    case 'kss':
      return tr.arrivedAt !== null ? -1 : tr.snap.est.kss
    case 'eta':
      return nextRest(tr)?.etaMin ?? 9999
  }
}

function VehicleList({ trucks, selected, onSelect }: { trucks: Truck[]; selected: string | null; onSelect: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'kss', dir: -1 })
  // Re-rank at a calm cadence so rows don't jitter on every sub-point KSS change.
  const order = useRef<{ ids: string[]; at: number; key: string }>({ ids: [], at: 0, key: '' })
  const sig = `${sort.key}${sort.dir}|${trucks.map((t) => t.plate).join()}`
  const nowMs = performance.now()
  if (order.current.key !== sig || nowMs - order.current.at > 2500) {
    order.current = {
      key: sig,
      at: nowMs,
      ids: [...trucks]
        .sort((a, b) => {
          const va = sortVal(a, sort.key)
          const vb = sortVal(b, sort.key)
          const c = typeof va === 'string' ? va.localeCompare(String(vb), 'ko') : va - (vb as number)
          return c * sort.dir || a.id.localeCompare(b.id)
        })
        .map((t) => t.id),
    }
  }
  const byId = new Map(trucks.map((t) => [t.id, t]))
  const rows = order.current.ids.map((id) => byId.get(id)).filter((t): t is Truck => !!t)
  return (
    <section className="fl-list glass">
      <header className="fl-ph">
        <div>
          <div className="eyebrow">차량 현황</div>
          <h2>실시간 운행 차량</h2>
        </div>
        <span className="chip">
          <IcCar size={14} /> {trucks.length}대 · 경부선 서울→부산
        </span>
      </header>
      <div className="fl-thead" role="row">
        {SORTS.map((s) => (
          <button
            key={s.key}
            className={sort.key === s.key ? 'on' : ''}
            onClick={() => setSort((p) => ({ key: s.key, dir: p.key === s.key ? (p.dir === 1 ? -1 : 1) : s.key === 'plate' || s.key === 'eta' ? 1 : -1 }))}
          >
            {s.label}
            {sort.key === s.key && <span>{sort.dir === 1 ? '↑' : '↓'}</span>}
          </button>
        ))}
        <span className="lvh">상태</span>
      </div>
      <div className="fl-rows scroll-y">
        {rows.map((tr) => {
          const s = tr.snap
          const km = s.sig.routeProgressKm ?? 0
          const tot = tr.rt.fatigue.timeOnTaskMin
          const nr = nextRest(tr)
          const st = statusOf(tr)
          return (
            <motion.button
              layout="position"
              transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
              key={tr.id}
              className={`fl-row${selected === tr.id ? ' sel' : ''}${st === 'arrived' ? ' off' : ''}`}
              onClick={() => onSelect(tr.id)}
            >
              <span className="c-id">
                <b className="plate">{tr.plate}</b>
                <em>
                  {tr.driver} · {STATUS_LABEL[st]}
                </em>
              </span>
              <span className="c-loc">
                <b className="num">{km.toFixed(0)} km</b>
                <em>{regionAt(km)}</em>
              </span>
              <span className="c-tot">
                <span className="num" style={{ color: totColor(tot) }}>
                  {Math.round(tot)}
                  <small>/120분</small>
                </span>
                <span className="bar">
                  <span style={{ width: `${Math.min(100, (tot / LIMIT_MIN) * 100)}%`, background: totColor(tot) }} />
                  <i style={{ left: `${(100 / LIMIT_MIN) * 100}%` }} />
                </span>
              </span>
              <span className="c-kss">
                <Spark hist={s.history} kss={s.est.kss} />
                <b className="num" style={{ color: kssColor(s.est.kss) }}>
                  {s.est.kss.toFixed(1)}
                </b>
              </span>
              <span className="c-next">
                {nr ? (
                  <>
                    <b>{shortStop(nr.stop)}</b>
                    <em className="num">
                      {nr.state === '경유 확정' ? '● ' : ''}
                      {clock(s.sig.t + nr.etaMin * 60_000)} · {dur(nr.etaMin)}
                    </em>
                  </>
                ) : (
                  <em>{st === 'arrived' ? '현장 업무 중' : st === 'nap' ? '파워냅 중' : st === 'rest' ? '정차 휴식 중' : '-'}</em>
                )}
              </span>
              <span className="c-lv">
                <LevelChip level={s.est.level} />
              </span>
            </motion.button>
          )
        })}
      </div>
    </section>
  )
}

// ─── Alert feed ──────────────────────────────────────────────────────────────

type FeedFilter = 'all' | 'risk' | 'accept'
function AlertFeed({ feed, onSelect }: { feed: FeedItem[]; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<FeedFilter>('all')
  const items = feed
    .filter((f) => (filter === 'all' ? true : filter === 'risk' ? f.level >= 3 || f.kind === 'violation' || f.kind === 'decline' : f.kind === 'accept' || f.kind === 'rest'))
    .slice(0, 60)
  return (
    <section className="fl-feed glass">
      <header className="fl-ph">
        <div>
          <div className="eyebrow">실시간 알림</div>
          <h2>전 차량 이벤트 피드</h2>
        </div>
        <div className="fl-seg">
          {(
            [
              ['all', '전체'],
              ['risk', '위험'],
              ['accept', '휴식 이행'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {l}
            </button>
          ))}
        </div>
      </header>
      <ol className="fl-events scroll-y">
        <AnimatePresence initial={false}>
          {items.map((f) => (
            <motion.li
              key={f.id}
              layout="position"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className={`k-${f.kind}`}
              style={{ ['--c' as string]: f.kind === 'accept' || f.kind === 'rest' ? '#3CF2C8' : f.kind === 'trip' || f.kind === 'dispatch' ? '#5AB8FF' : LEVEL[f.level].hex }}
            >
              <span className="t num">{clock(f.t)}</span>
              <button className="plate" onClick={() => onSelect(f.truckId)}>
                {f.plate}
              </button>
              <div className="body">
                <b>
                  {f.kind === 'accept' || f.kind === 'rest' ? <IcCheck size={13} /> : f.level >= 3 ? <IcAlert size={13} /> : null}
                  {f.title}
                </b>
                <p>{f.detail}</p>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
        {items.length === 0 && <li className="fl-empty">표시할 이벤트가 없습니다.</li>}
      </ol>
    </section>
  )
}

// ─── Pleos Fleet API link ────────────────────────────────────────────────────

interface LiveVehicle {
  id: string
  bus: WebhookVehicle
  rt: Runtime
  last: FleetUpdate
}

/**
 * The fleet's data path, shown as it would run in production: every simulated vehicle ships Pleos Fleet
 * API Webhook payloads (Periodic Data, 10S_30S). With the KKAEUM server running they go out to
 * POST /api/fleet/webhook and come back over SSE (/api/fleet/stream) exactly as real fleet vehicles
 * would; vehicles that are not ours each get a fatigue engine fed only by the webhook data.
 */
function FleetApiPanel({ fleet }: { fleet: FleetSim }) {
  const [live, setLive] = useState(false)
  const [last, setLast] = useState<string>('')
  const [normal, setNormal] = useState<FleetUpdate | null>(null)
  const [received, setReceived] = useState(0)
  const [external, setExternal] = useState<LiveVehicle[]>([])
  const ext = useRef(new Map<string, LiveVehicle>())
  const liveRef = useRef(false)
  const posting = useRef(0)

  useEffect(() => {
    let shown = 0
    fleet.onPayload = (payload) => {
      const now = performance.now()
      if (now - shown > 900) {
        shown = now
        setLast(JSON.stringify(payload, null, 2))
        setNormal(normalise(payload, 'periodic').at(-1) ?? null)
      }
      // End-to-end through the server's webhook receiver, a few per second at most.
      if (liveRef.current && posting.current < 4) {
        posting.current++
        void fetch(`${import.meta.env.BASE_URL}api/fleet/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-API-Version': 'v1.0', 'X-42dot-transmissionType': '10S_30S' },
          body: JSON.stringify(payload),
        }).finally(() => posting.current--)
      }
    }
    return () => {
      fleet.onPayload = undefined
    }
  }, [fleet])

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const es = new EventSource(`${import.meta.env.BASE_URL}api/fleet/stream`)
    es.onopen = () => {
      liveRef.current = true
      setLive(true)
    }
    es.onerror = () => {
      liveRef.current = false
      setLive(false)
    }
    es.onmessage = (m) => {
      let u: FleetUpdate
      try {
        u = JSON.parse(m.data)
      } catch {
        return
      }
      setReceived((n) => n + 1)
      if (!u.vehicleId || u.vehicleId.startsWith('kkaeum-sim-')) return
      // A real fleet vehicle: its own fatigue engine on webhook data only.
      let v = ext.current.get(u.vehicleId)
      if (!v) {
        const bus = new WebhookVehicle(u)
        const rt = new Runtime(bus, { name: '운전자', wakeTime: u.t - 9 * 3.6e6, sleepHours: 6.5, chronotype: 0 }, REST_STOPS)
        rt.autoPilot = false
        v = { id: u.vehicleId, bus, rt, last: u }
        ext.current.set(u.vehicleId, v)
      } else v.bus.ingest(u)
      v.last = u
      v.rt.frame(0, 1)
      setExternal([...ext.current.values()])
    }
    return () => es.close()
  }, [])

  return (
    <section className="fl-api glass">
      <div className="fl-api-h">
        <div>
          <div className="eyebrow">Pleos Fleet API 연동</div>
          <h2>차량 데이터 파이프라인</h2>
        </div>
        <span className={`fl-api-src ${live ? 'live' : ''}`}>
          <i />
          {live ? '웹훅 수신기 연결됨 · /api/fleet/webhook → SSE' : '서버 없음 · 시뮬레이터가 웹훅 규격 페이로드를 직접 생성'}
        </span>
      </div>
      <div className="fl-api-grid">
        <div className="fl-api-stats">
          <div><b>{fleet.payloads.toLocaleString()}</b><span>생성한 Periodic Data 페이로드</span></div>
          <div><b>{received.toLocaleString()}</b><span>웹훅 수신기 경유 (SSE)</span></div>
          <div><b>{external.length}</b><span>실차 (외부 vehicleId)</span></div>
          <p>
            규격: <code>POST</code> 콜백 · 헤더 <code>X-42dot-transmissionType: 10S_30S</code> · 응답 <code>200 {'{"status":"completed"}'}</code>
            <br />
            실차 연결: Pleos Fleet 계약 후 발급되는 <code>FLEET_API_HOST · CLIENT_ID · SECRET · PROJECT_ID</code>만 서버에 설정하면 동일 경로로 수신·조회됩니다.
          </p>
          {normal && (
            <div className="fl-api-norm">
              <span>정규화</span> {normal.vehicleId.replace('kkaeum-sim-', '')} · {normal.speedKph?.toFixed(0)}km/h · SOC {normal.socPct?.toFixed(0)}% ·{' '}
              {normal.lat?.toFixed(3)}, {normal.lon?.toFixed(3)}
            </div>
          )}
        </div>
        <pre className="fl-api-json">{last || '페이로드 대기 중…'}</pre>
      </div>
      {external.length > 0 && (
        <table className="fl-api-ext">
          <thead>
            <tr><th>vehicleId</th><th>속도</th><th>SOC</th><th>연속운전</th><th>KSS</th></tr>
          </thead>
          <tbody>
            {external.map((v) => {
              const snap = v.rt.snapshot()
              return (
                <tr key={v.id}>
                  <td>{v.id.slice(0, 13)}</td>
                  <td>{(v.last.speedKph ?? 0).toFixed(0)} km/h</td>
                  <td>{v.last.socPct !== undefined ? `${v.last.socPct.toFixed(0)}%` : '-'}</td>
                  <td>{Math.round(v.rt.fatigue.timeOnTaskMin)}분</td>
                  <td style={{ color: kssColor(snap.est.kss) }}>{snap.est.kss.toFixed(1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

// ─── CSV export ──────────────────────────────────────────────────────────────

function exportCsv(fleet: FleetSim) {
  const head = ['차량번호', '운전자', '상태', '위험단계', 'KSS', '위치_km', '구간', '속도_kph', '연속운전_분', '최대연속운전_분', '2시간정책', '휴식이행_회', '휴식제안수락_건', '휴식제안거절_건', '예방_건', '다음휴식', '다음휴식_ETA', '개입_건', '실내CO2_ppm']
  const rows = fleet.trucks.map((tr) => {
    const s = tr.snap
    const km = s.sig.routeProgressKm ?? 0
    const nr = nextRest(tr)
    return [
      tr.plate,
      tr.driver,
      STATUS_LABEL[statusOf(tr)],
      `L${s.est.level} ${LEVEL[s.est.level].name}`,
      s.est.kss.toFixed(2),
      km.toFixed(1),
      regionAt(km),
      s.sig.speedKph.toFixed(0),
      tr.rt.fatigue.timeOnTaskMin.toFixed(0),
      tr.maxTot.toFixed(0),
      tr.violated ? '위반' : '준수',
      tr.rests,
      tr.accepted,
      tr.declined,
      tr.prevented,
      nr?.stop.name ?? '',
      nr ? clock(s.sig.t + nr.etaMin * 60_000) : '',
      s.stats.interventions,
      Math.round(s.co2),
    ]
  })
  const esc = (v: string | number) => {
    const t = String(v)
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const csv = '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\n')
  const d = new Date(fleet.now)
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${clock(fleet.now).replace(':', '')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `kkaeum-fleet-${stamp}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─── Page ────────────────────────────────────────────────────────────────────

const SPEEDS = [1, 30, 120]

export function Fleet() {
  const [fleet] = useState(() => new FleetSim())
  const [built, setBuilt] = useState(fleet.trucks.length)
  const [, setVersion] = useState(0)
  const [scale, setScale] = useState(30)
  const [paused, setPaused] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const ctl = useRef({ scale, paused })
  ctl.current = { scale, paused }

  // Warm-up: replay each truck's trip so far, one per macrotask.
  useEffect(() => {
    let alive = true
    let timer = 0
    const step = () => {
      if (!alive) return
      fleet.buildNext()
      setBuilt(fleet.trucks.length)
      if (!fleet.ready) timer = window.setTimeout(step, 0)
      else setSelected((s) => s ?? [...fleet.trucks].sort((a, b) => b.snap.est.kss - a.snap.est.kss)[0]?.id ?? null)
    }
    timer = window.setTimeout(step, 0)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [fleet])

  // One clock for the whole fleet.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastUi = 0
    const loop = (now: number) => {
      const dt = Math.min(100, now - last)
      last = now
      if (!ctl.current.paused) fleet.tick(dt, ctl.current.scale)
      if (now - lastUi > 250) {
        lastUi = now
        setVersion((v) => v + 1)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [fleet])

  const ready = built >= FLEET_SIZE
  const trucks = fleet.trucks
  const active = trucks.filter((t) => t.arrivedAt === null)
  const driving = active.filter((t) => statusOf(t) === 'driving').length
  const resting = active.length - driving
  const risk = active.filter((t) => t.snap.est.level >= 2)
  const crit = risk.filter((t) => t.snap.est.level >= 3).length
  const { trips, violatedTrips, rests, prevented, accepted, declined } = fleet.totals
  const compliance = trips ? 1 - violatedTrips / trips : 1
  const avgKss = active.length ? active.reduce((a, t) => a + t.snap.est.kss, 0) / active.length : 0
  const feed = fleet.sortedFeed()
  const sel = trucks.find((t) => t.id === selected)

  return (
    <div className="fleet">
      <div className="fl-bgglow" aria-hidden />
      <header className="fl-top">
        <div className="fl-brand">
          <Logo size={30} />
          <div>
            <div className="eyebrow">
              {COMPANY} · 법인·장기렌터카 {FLEET_SIZE}대 · KKAEUM for Fleet
            </div>
            <h1>Fleet Safety Console</h1>
            <p>Pleos Fleet 연동 · 법인·렌터카 승용 플릿 졸음운전 관리 (안전정책: 2시간 연속운전마다 15분 휴식 · 정책값은 고객사별 설정)</p>
          </div>
        </div>
        <nav className="fl-nav">
          <a href="#/">← 홈</a>
          <a href="#/console">드라이버 콘솔</a>
        </nav>
      </header>

      <div className="fl-bar">
        <div className="fl-clock">
          <span className={`live${paused ? ' off' : ''}`} />
          <span className="eyebrow">{paused ? '일시정지' : 'LIVE SIM'}</span>
          <b className="num mono">{clock(fleet.now)}</b>
          <span className="date">{new Date(fleet.now).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}</span>
        </div>
        <div className="fl-ctrl">
          <button className="fl-icon" onClick={() => setPaused((p) => !p)} aria-label={paused ? '재생' : '일시정지'}>
            {paused ? <IcPlay size={16} /> : <IcPause size={16} />}
          </button>
          <div className="fl-seg">
            {SPEEDS.map((s) => (
              <button key={s} className={scale === s ? 'on' : ''} onClick={() => (setScale(s), setPaused(false))}>
                {s}×
              </button>
            ))}
          </div>
          <button className="btn fl-csv" onClick={() => exportCsv(fleet)} disabled={!ready}>
            보고서 내보내기 (CSV)
          </button>
        </div>
      </div>

      {!ready ? (
        <div className="fl-loading glass">
          <div className="eyebrow">Pleos Fleet 동기화</div>
          <p>
            차량 {built}/{FLEET_SIZE}대의 오늘 운행 기록을 엔진으로 재생하는 중…
          </p>
          <div className="bar">
            <span style={{ width: `${(built / FLEET_SIZE) * 100}%` }} />
          </div>
        </div>
      ) : (
        <>
          <div className="fl-kpis">
            <Kpi label="운행 중 차량" icon={<IcCar size={13} />} sub={<>주행 {driving} · 휴식 {resting} · 도착 {trucks.length - active.length}</>}>
              <Num value={active.length} />
              <small>/{trucks.length}</small>
            </Kpi>
            <Kpi label="현재 졸음 위험 (L2+)" tone={risk.length ? 'var(--l3)' : undefined} icon={<IcAlert size={13} />} sub={<>L3 이상 {crit}대 · 자동 휴식 안내 중</>}>
              <Num value={risk.length} />
              <small>대</small>
            </Kpi>
            <Kpi label="2시간 휴식정책 준수율" tone={compliance < 0.9 ? 'var(--amber)' : 'var(--aurora)'} sub={<>오늘 {trips}회 운행 중 위반 {violatedTrips} · 15분 휴식 {rests}회</>}>
              <Num value={compliance * 100} digits={1} suffix="%" />
            </Kpi>
            <Kpi label="오늘 예방된 위험 구간" tone="var(--aurora)" icon={<IcCheck size={13} />} sub={<>KSS 7 전 휴식 수락 · 수락 {accepted} · 거절 {declined}</>}>
              <Num value={prevented} />
              <small>건</small>
            </Kpi>
            <Kpi label="평균 KSS" tone={kssColor(avgKss)} sub={<>운행 차량 평균 · 7 이상 = 졸음운전 위험</>}>
              <span style={{ color: kssColor(avgKss) }}>
                <Num value={avgKss} digits={2} />
              </span>
            </Kpi>
          </div>

          <div className="fl-main">
            <section className="fl-mapwrap glass">
              <FleetMap fleet={fleet} selected={selected} onSelect={setSelected} />
              <div className="fl-maplegend">
                {LEVEL.map((L, i) => (
                  <span key={i}>
                    <i style={{ background: L.hex }} />L{i}
                  </span>
                ))}
                <span>
                  <i className="svc" />
                  휴게소
                </span>
                <span>
                  <i className="drw" />
                  졸음쉼터
                </span>
              </div>
            </section>
            <VehicleList trucks={trucks} selected={selected} onSelect={setSelected} />
          </div>

          <div className="fl-lower">
            <VehiclePanel tr={sel} />
            <AlertFeed feed={feed} onSelect={setSelected} />
          </div>

          <FleetApiPanel fleet={fleet} />

          <footer className="fl-foot">
            각 차량은 독립된 깨움 엔진(3-프로세스 졸음 모델 · CO₂ 디지털 트윈 · 예측 휴식 플래너 · 개입 오케스트레이터)으로 시뮬레이션됩니다. 운전자 정보는 성만
            표시합니다.
          </footer>
        </>
      )}
    </div>
  )
}

export default Fleet
