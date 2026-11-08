// VehicleBus: the single seam between the engine and a vehicle.
// - SimVehicle (browser demo / judges' console) implements it with a scripted day in the car's life.
// - NativeVehicle (inside the APK) forwards to Kotlin, which talks to the Pleos Connect
//   Vehicle / NaviHelper / TextToSpeech / SpeechToText / FusedLocation SDKs and the AAOS Car API.

import type { Bookmark, VehicleAction, VehicleSignals } from './types'

export interface Capabilities {
  chargeLimit: boolean
  chargeCurrent: boolean
  window: boolean
  doorLock: boolean
  headlights: boolean
  blind: boolean
  ambientLight: boolean
  telltales: boolean
  navi: boolean
  tts: boolean
  stt: boolean
  source: 'simulation' | 'pleos'
}

/** One-off vehicle / navi events. */
export type BusEvent =
  | { type: 'bookmarks'; items: Bookmark[] }
  | { type: 'tripInfo'; poiId: string; distanceKm: number; etaMin: number; socAtDest: number }
  | { type: 'chargerOperators'; items: string[] }

export interface VehicleBus {
  readonly kind: 'sim' | 'native'
  capabilities(): Capabilities
  read(): VehicleSignals
  apply(action: VehicleAction): Promise<boolean>
  onEvent?(fn: (e: BusEvent) => void): () => void
  /** Advance simulated time; native implementations ignore this. */
  advance?(dtMs: number): void
}

export const SIM_CAPS: Capabilities = {
  chargeLimit: true,
  chargeCurrent: true,
  window: true,
  doorLock: true,
  headlights: true,
  blind: true,
  ambientLight: true,
  telltales: true,
  navi: true,
  tts: true,
  stt: true,
  source: 'simulation',
}
