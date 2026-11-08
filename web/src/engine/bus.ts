// VehicleBus: the single seam between the engine and a vehicle.
// - SimVehicle (browser demo / judges' console) implements it with a physics simulation.
// - NativeVehicle (inside the APK) forwards to Kotlin, which talks to the Pleos Connect
//   Vehicle / NaviHelper / TextToSpeech / SpeechToText / FusedLocation SDKs.

import type { RestStop, VehicleAction, VehicleSignals } from './types'

export interface Capabilities {
  hvacRecirculation: boolean
  hvacTemperature: boolean
  hvacFan: boolean
  ambientLight: boolean
  seatVentilation: boolean
  seatRecline: boolean
  window: boolean
  navWaypoint: boolean
  tts: boolean
  stt: boolean
  llm: boolean
  daw: boolean
  // second-tier interventions (ComfortActuators on the APK side)
  heatOff?: boolean
  fanDirection?: boolean
  cabinLight?: boolean
  lumbarPulse?: boolean
  blind?: boolean
  smartGlass?: boolean
  backrestRestore?: boolean
  source: 'simulation' | 'pleos'
}

/** One-off vehicle / navi events (geofence, real trip ETA, waypoint list, recent destinations, ...). */
export type BusEvent =
  | { type: 'geofence'; stopId: string; transition: 'ENTER' | 'EXIT' }
  | { type: 'tripInfo'; poiId: string; distanceKm: number; etaMin: number; socAtDest: number }
  | { type: 'waypoints'; items: { name: string; poiId: string; remainKm: number; remainMin: number }[] }
  | { type: 'waypointArrived'; name: string }
  | { type: 'recentDestinations'; items: { name: string; lat: number; lon: number }[] }
  | { type: 'chargerOperators'; items: string[] }

export interface VehicleBus {
  readonly kind: 'sim' | 'native' | 'fleet'
  capabilities(): Capabilities
  read(): VehicleSignals
  apply(action: VehicleAction): Promise<boolean>
  addWaypoint(stop: RestStop): Promise<boolean>
  /** Cancel the rest-stop waypoint (and its geofence). */
  removeWaypoint?(): Promise<boolean>
  /** Ask navi for the real ETA / distance / SoC on arrival to a candidate stop (answer arrives as a 'tripInfo' event). */
  tripTo?(stop: RestStop): void
  onEvent?(fn: (e: BusEvent) => void): () => void
  /** Advance simulated time; native implementations ignore this. */
  advance?(dtMs: number): void
}

export const SIM_CAPS: Capabilities = {
  hvacRecirculation: true,
  hvacTemperature: true,
  hvacFan: true,
  ambientLight: true,
  seatVentilation: true,
  seatRecline: true,
  window: true,
  navWaypoint: true,
  tts: true,
  stt: true,
  llm: true,
  daw: true,
  heatOff: true,
  fanDirection: true,
  cabinLight: true,
  lumbarPulse: true,
  blind: true,
  smartGlass: true,
  backrestRestore: true,
  source: 'simulation',
}
