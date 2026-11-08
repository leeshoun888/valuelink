// Shared domain types for the KKAEUM engine. The same engine runs in the browser
// (simulated vehicle) and inside the Pleos Connect APK (real Vehicle SDK via bridge).

export type Gear = 'P' | 'R' | 'N' | 'D'

export type LngLat = [number, number]

/** Raw signals the engine consumes every tick. Anything optional may be unsupported on a given vehicle. */
export interface VehicleSignals {
  t: number // epoch ms (sim or wall clock)
  speedKph: number
  gear: Gear
  parkingBrake: boolean
  cruiseOn?: boolean
  driveMode?: string
  tripMinutes?: number
  tripKm?: number
  // HVAC
  recirculation: boolean
  setTempC: number
  cabinTempC?: number
  outsideTempC?: number
  fanSpeed: number // 0..8
  acOn?: boolean
  seatVentDriver?: number // 0..3
  seatRecline?: number // degrees (driver)
  windowOpenPct?: number // driver window 0..100
  ambient?: { color: string; brightness: number }
  occupants: number
  // Safety
  dawWarning?: boolean // driver attention warning raised by the vehicle
  turnSignalEvents?: number // cumulative count
  steeringActivity?: number // 0..1 (micro-correction entropy proxy)
  // Location / navigation
  position?: LngLat
  headingDeg?: number
  routeProgressKm?: number
  /** false = off the bundled corridor route: progress is distance driven and stops come from the heading cone. */
  onRoute?: boolean
  routeRemainingKm?: number
  routeEtaMin?: number
  roadClass?: 'highway' | 'urban' | 'rural'
  // Pleos listeners added for the fatigue model and charge-aware stops
  headlightsOn?: boolean // low beam on → driving in the dark
  cruiseTargetKph?: number
  raining?: boolean // front wiper running
  brakeEvents?: number // cumulative pedal presses
  socPct?: number // traction battery state of charge
  rangeKm?: number
  seatHeat?: number // driver seat heating level (0 = off)
  wheelHeat?: number // steering-wheel heating level
  dmsDrowsy?: boolean // vehicle DMS drowsiness warning (Pleos vendor property, privileged)
  // NaviHelper
  tbtNextM?: number // distance to the next manoeuvre
  tbtNext?: string
  cautionType?: string // nearest risk point ahead (FOG_AREA, ACCIDENT_PRONE_AREA, …)
  cautionM?: number
  navStatus?: string
  /** Vehicle UI night mode (Configuration.uiMode), sent by the APK host. */
  uiNight?: boolean
  outsidePm25?: number // µg/m³ (from public air quality data along the route)
}

export interface DriverProfile {
  name: string
  wakeTime: number // epoch ms the driver woke up today
  sleepHours: number // last night's sleep
  chronotype: number // -1 (morning lark) .. +1 (night owl), shifts circadian acrophase
}

export type RiskLevel = 0 | 1 | 2 | 3 | 4

export interface Contribution {
  key:
    | 'sleepPressure'
    | 'circadian'
    | 'postLunch'
    | 'timeOnTask'
    | 'darkness'
    | 'warmth'
    | 'monotony'
    | 'co2'
    | 'thermal'
    | 'probe'
    | 'daw'
    | 'countermeasure'
  label: string
  value: number // KSS points (+ raises sleepiness)
}

export interface FatigueEstimate {
  kss: number // Karolinska Sleepiness Scale equivalent, 1..9
  level: RiskLevel
  confidence: number // 0..1
  contributions: Contribution[]
  minutesToDanger: number | null // forecast until KSS >= 7 at current trajectory
}

export interface ProbeResult {
  t: number
  reactionMs: number
  correct: boolean
  lapse: boolean
}

export type ActionKind =
  | 'freshAir'
  | 'recirculation'
  | 'temperature'
  | 'fan'
  | 'ambient'
  | 'seatVent'
  | 'seatRecline'
  | 'window'
  | 'waypoint'
  | 'speak'
  | 'engage'
  | 'probe'
  | 'napStart'
  | 'napWake'
  | 'heatOff' // seat + steering-wheel heating off (warmth deepens sleepiness)
  | 'fanDirection' // air to the face
  | 'cabinLight' // wake sequence
  | 'lumbarPulse' // haptic nudge through the lumbar support
  | 'blind' // nap shade (parked)
  | 'smartGlass' // nap privacy dimming (parked)
  | 'showChargers' // navi nearby-charging list (low battery)

export interface VehicleAction {
  kind: ActionKind
  value?: number | string | boolean | object
  reason: string
}

export interface RestStop {
  id: string
  name: string
  kind: 'drowsy' | 'service' // 졸음쉼터 | 휴게소
  highway: string
  direction?: string
  lngLat: LngLat
  km: number // distance along the active route
  amenities?: string[]
}

export interface RestPlan {
  stop: RestStop
  etaMin: number
  kssAtArrival: number
  reason: string
  alternatives: { stop: RestStop; etaMin: number; kssAtArrival: number }[]
}

export interface TimelineEvent {
  t: number
  level: RiskLevel
  title: string
  detail: string
  actions: VehicleAction[]
}
