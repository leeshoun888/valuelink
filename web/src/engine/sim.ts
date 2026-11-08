// Physics-lite vehicle simulator used by the web console and as the scenario engine for
// the demo video. Deterministic given a seed so scenarios replay identically.

import { SIM_CAPS, type BusEvent, type Capabilities, type VehicleBus } from './bus'
import { pointAtKm, roadClassAt, ROUTE, type Route } from './route'
import type { Gear, RestStop, VehicleAction, VehicleSignals } from './types'

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

export interface ScenarioConfig {
  id: string
  title: string
  subtitle: string
  startHour: number
  startMinute: number
  wakeHour: number // the driver's wake-up time (same day, or previous day if after start)
  sleepHours: number
  occupants: number
  recirculation: boolean
  setTempC: number
  outsideTempC: number
  outsidePm25: number
  fleet?: boolean
}

export const SCENARIOS: ScenarioConfig[] = [
  {
    id: 'chuseok-night',
    title: '추석 귀성길 · 금요일 밤',
    subtitle: '22:30 서울 출발 · 가족 4인 · 내기순환 ON · 06:30 기상',
    startHour: 22,
    startMinute: 30,
    wakeHour: 6.5,
    sleepHours: 6,
    occupants: 4,
    recirculation: true,
    setTempC: 24.5,
    outsideTempC: 17,
    outsidePm25: 18,
  },
  {
    id: 'afternoon-solo',
    title: '출장 복귀 · 점심 직후',
    subtitle: '13:10 출발 · 1인 · 히터 25℃ · 식후 저각성',
    startHour: 13,
    startMinute: 10,
    wakeHour: 5.5,
    sleepHours: 5,
    occupants: 1,
    recirculation: true,
    setTempC: 25,
    outsideTempC: 9,
    outsidePm25: 62,
  },
  {
    id: 'fleet-dawn',
    title: '법인 출장 · 새벽 출발',
    subtitle: '03:40 출발 · 법인차 플릿 · 2시간 휴식정책',
    startHour: 3,
    startMinute: 40,
    wakeHour: 2.75,
    sleepHours: 5.5,
    occupants: 1,
    recirculation: false,
    setTempC: 23,
    outsideTempC: 6,
    outsidePm25: 12,
    fleet: true,
  },
]

export function scenarioStart(s: ScenarioConfig, base = new Date()): { start: number; wake: number } {
  const d = new Date(base)
  d.setHours(s.startHour, s.startMinute, 0, 0)
  const start = d.getTime()
  const w = new Date(d)
  w.setHours(Math.floor(s.wakeHour), Math.round((s.wakeHour % 1) * 60), 0, 0)
  let wake = w.getTime()
  if (wake > start) wake -= 24 * 3.6e6
  return { start, wake }
}

type DriveState = 'driving' | 'exiting' | 'parked' | 'merging'

const CAUTION_POINTS: [number, string][] = [
  [172, 'ACCIDENT_PRONE_AREA'],
  [218, 'FOG_AREA'],
]

export class SimVehicle implements VehicleBus {
  readonly kind = 'sim' as const
  readonly route: Route
  scenario: ScenarioConfig
  t: number
  km = 0
  speed = 0
  gear: Gear = 'D'
  parkingBrake = false
  cruise = false
  recirc: boolean
  setTemp: number
  cabinTemp: number
  fan = 3
  seatVent = 0
  recline = 8
  windowPct = 0
  ambient = { color: '#3CF2C8', brightness: 35 }
  occupants: number
  daw = false
  turnEvents = 0
  state: DriveState = 'driving'
  waypoint: RestStop | null = null
  // Pleos signals added in the API audit (simulated so the web demo exercises the same paths)
  soc = 78 // IONIQ 5 traction battery %
  seatHeat = 0
  wheelHeat = 0
  fanFace = false
  cabinLight = false
  blindClosed = false
  smartGlass = false
  private geofenceIn = false
  private events = new Set<(e: BusEvent) => void>()
  parkedUntil = 0
  holdParked = false
  private rnd: () => number
  private targetSpeed = 50
  private nextTurnAt = 0

  constructor(scenario: ScenarioConfig, start: number, route: Route = ROUTE, seed = 7) {
    this.scenario = scenario
    this.route = route
    this.t = start
    this.recirc = scenario.recirculation
    this.setTemp = scenario.setTempC
    this.cabinTemp = scenario.setTempC - 1.5
    this.occupants = scenario.occupants
    this.rnd = mulberry32(seed)
    this.nextTurnAt = start + 5 * 60_000
    // Cold night start: the driver switched the seat / wheel heating on (warmth that deepens sleepiness).
    if (scenario.outsideTempC < 10) this.seatHeat = 2
    if (scenario.outsideTempC < 7) this.wheelHeat = 1
  }

  onEvent(fn: (e: BusEvent) => void) {
    this.events.add(fn)
    return () => void this.events.delete(fn)
  }

  private emit(e: BusEvent) {
    this.events.forEach((l) => l(e))
  }

  /** Simulated NaviHelper.requestTrip: route distance, 95 km/h ETA and ~0.18 %/km consumption. */
  tripTo(stop: RestStop) {
    const distanceKm = Math.max(0, stop.km - this.km)
    const ev: BusEvent = { type: 'tripInfo', poiId: stop.id, distanceKm, etaMin: (distanceKm / 95) * 60, socAtDest: Math.max(0, Math.round(this.soc - distanceKm * 0.18)) }
    setTimeout(() => this.emit(ev), 0)
  }

  async removeWaypoint() {
    this.waypoint = null
    return true
  }

  capabilities(): Capabilities {
    return SIM_CAPS
  }

  advance(dtMs: number) {
    const dtMin = dtMs / 60_000
    this.t += dtMs
    const road = roadClassAt(this.route, this.km)

    if (this.state === 'parked') {
      this.speed = 0
      this.gear = 'P'
      this.parkingBrake = true
      if (!this.holdParked && this.t >= this.parkedUntil) {
        this.state = 'merging'
        this.gear = 'D'
        this.parkingBrake = false
        this.waypoint = null
      }
    } else {
      if (this.waypoint && this.waypoint.km - this.km < 1.2) this.state = 'exiting'
      if (this.state === 'exiting') {
        this.targetSpeed = 0
        this.cruise = false
        if (this.waypoint) this.km = Math.min(this.km, this.waypoint.km)
        if (this.speed < 2) {
          this.state = 'parked'
          this.parkedUntil = this.t + 10 * 60_000
          this.holdParked = true
        }
      } else {
        // Speed profile: urban stop&go vs highway cruising with mild noise.
        const base = road === 'urban' ? 46 + 18 * Math.sin(this.t / 47_000) : 101 + 6 * Math.sin(this.t / 230_000)
        this.targetSpeed = base + (this.rnd() - 0.5) * (road === 'urban' ? 14 : 5)
        if (this.state === 'merging' && this.speed > 85) this.state = 'driving'
        this.cruise = road === 'highway' && this.state === 'driving' && this.speed > 90
      }
      const k = 1 - Math.exp(-dtMin * 3)
      this.speed = Math.max(0, this.speed + (this.targetSpeed - this.speed) * k)
      if (this.state === 'exiting' && this.speed < 18) this.speed = Math.max(0, this.speed - 30 * dtMin)
      const prevKm = this.km
      this.km = Math.min(this.route.totalKm, this.km + (this.speed * dtMin) / 60)
      this.soc = Math.max(3, this.soc - (this.km - prevKm) * 0.18)
      this.gear = 'D'
      this.parkingBrake = false
      if (this.t >= this.nextTurnAt) {
        this.turnEvents += 1
        this.nextTurnAt = this.t + (road === 'urban' ? 3 : 14 + this.rnd() * 10) * 60_000
      }
    }
    // Simulated FusedLocation geofence (400 m) around the accepted stop.
    const near = this.waypoint ? Math.abs(this.waypoint.km - this.km) < 0.4 : false
    if (this.waypoint && near !== this.geofenceIn) {
      this.geofenceIn = near
      this.emit({ type: 'geofence', stopId: this.waypoint.id, transition: near ? 'ENTER' : 'EXIT' })
    }
    // Cabin temperature follows the set point (HVAC time constant ≈ 4 min).
    this.cabinTemp += (this.setTemp - this.cabinTemp) * (1 - Math.exp(-dtMin / 4))
  }

  read(): VehicleSignals {
    const { lngLat, heading } = pointAtKm(this.route, this.km)
    const road = roadClassAt(this.route, this.km)
    return {
      t: this.t,
      speedKph: this.speed,
      gear: this.gear,
      parkingBrake: this.parkingBrake,
      cruiseOn: this.cruise,
      recirculation: this.recirc,
      setTempC: this.setTemp,
      cabinTempC: this.cabinTemp,
      outsideTempC: this.scenario.outsideTempC,
      fanSpeed: this.fan,
      seatVentDriver: this.seatVent,
      seatRecline: this.recline,
      windowOpenPct: this.windowPct,
      ambient: this.ambient,
      occupants: this.occupants,
      dawWarning: this.daw,
      turnSignalEvents: this.turnEvents,
      steeringActivity: road === 'urban' ? 0.75 : 0.32,
      position: lngLat,
      headingDeg: heading,
      routeProgressKm: this.km,
      routeRemainingKm: this.route.totalKm - this.km,
      routeEtaMin: ((this.route.totalKm - this.km) / 95) * 60,
      roadClass: road,
      outsidePm25: this.scenario.outsidePm25,
      headlightsOn: (() => {
        const h = new Date(this.t).getHours()
        return h >= 18 || h < 7
      })(),
      socPct: Math.round(this.soc),
      rangeKm: Math.round(this.soc * 4.6),
      seatHeat: this.seatHeat,
      wheelHeat: this.wheelHeat,
      raining: false,
      ...this.navCaution(),
    }
  }

  /** Simulated navi caution points on the Gyeongbu route (fog-prone Chupungnyeong pass, accident-prone Okcheon curves). */
  private navCaution(): Pick<VehicleSignals, 'cautionType' | 'cautionM'> {
    for (const [km, type] of CAUTION_POINTS) {
      const ahead = (km - this.km) * 1000
      if (ahead > 0 && ahead < 3000) return { cautionType: type, cautionM: Math.round(ahead) }
    }
    return {}
  }

  async apply(a: VehicleAction): Promise<boolean> {
    switch (a.kind) {
      case 'freshAir':
        this.recirc = !a.value
        return true
      case 'recirculation':
        this.recirc = Boolean(a.value)
        return true
      case 'temperature':
        this.setTemp = Number(a.value)
        return true
      case 'fan':
        this.fan = Math.max(0, Math.min(8, Number(a.value)))
        return true
      case 'ambient':
        this.ambient = a.value as { color: string; brightness: number }
        return true
      case 'seatVent':
        this.seatVent = Number(a.value)
        return true
      case 'seatRecline':
        this.recline = Number(a.value)
        return true
      case 'window':
        this.windowPct = Number(a.value)
        return true
      case 'napWake':
        this.holdParked = false
        this.parkedUntil = this.t + 4 * 60_000
        return true
      case 'heatOff':
        this.seatHeat = 0
        this.wheelHeat = 0
        return true
      case 'fanDirection':
        this.fanFace = true
        return true
      case 'cabinLight':
        this.cabinLight = Boolean(a.value)
        return true
      case 'blind':
        this.blindClosed = a.value === 'close'
        return true
      case 'smartGlass':
        this.smartGlass = Boolean(a.value)
        return true
      default:
        return true
    }
  }

  async addWaypoint(stop: RestStop): Promise<boolean> {
    this.waypoint = stop
    this.geofenceIn = false
    return true
  }
}
