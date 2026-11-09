// NativeVehicle: VehicleBus backed by the Android host (Pleos Connect APK).
// Kotlin pushes signal snapshots into window.__cv.onSignals(json) and exposes
// window.CarValueNative (an @JavascriptInterface) for actuation:
//   act(actionJson)        → Vehicle SDK setters (EvBattery / Window / Light / Door), see VehicleGateway.kt
//   searchPlace(keyword)   → NaviHelper.requestNavigationScreen(SearchPlace)
//   routeOption(option)    → NaviHelper.changeRouteOption
//   showChargers()         → NaviHelper.requestNavigationScreen(NearbyChargingStations)
//   speak(key, text) → TextToSpeech SDK ;  listen() → SpeechToText SDK
//   capabilities()         → JSON from the check*Capabilities() results

import type { BusEvent, Capabilities, VehicleBus } from './bus'
import type { VehicleAction, VehicleSignals } from './types'

interface NativeApi {
  /** the build has a public-data proxy; live data is read through https://appassets…/assets/web/pub/ */
  publicData?: () => boolean
  act(json: string): boolean
  capabilities(): string
  speak(key: string, text: string): void
  listen(requestId: string): void
  log(msg: string): void
  searchPlace?(keyword: string): boolean
  routeOption?(option: string): boolean
  showChargers?(): boolean
}

declare global {
  interface Window {
    CarValueNative?: NativeApi
    __cv?: {
      onSignals: (json: string) => void
      onSpeech: (requestId: string, event: string, payload: string) => void
      onSdkTrace: (line: string) => void
      onGleo?: (json: string) => { status: string; message: string; data?: unknown }
      onEvent?: (type: string, json: string) => void
    }
  }
}

export const isNative = () => typeof window !== 'undefined' && Boolean(window.CarValueNative)

type SpeechListener = (requestId: string, event: string, payload: string) => void
const speechListeners = new Set<SpeechListener>()
const traceListeners = new Set<(line: string) => void>()
export const onNativeSpeech = (fn: SpeechListener) => (speechListeners.add(fn), () => speechListeners.delete(fn))
export const onSdkTrace = (fn: (line: string) => void) => (traceListeners.add(fn), () => traceListeners.delete(fn))

export class NativeVehicle implements VehicleBus {
  readonly kind = 'native' as const
  private sig: VehicleSignals = { t: Date.now(), speedKph: 0, gear: 'P', parkingBrake: true }
  private caps: Capabilities
  private eventListeners = new Set<(e: BusEvent) => void>()

  constructor() {
    const api = window.CarValueNative!
    let parsed: Partial<Capabilities> = {}
    try {
      parsed = JSON.parse(api.capabilities())
    } catch {
      /* host returned nothing: assume minimal */
    }
    this.caps = {
      chargeLimit: false,
      chargeCurrent: false,
      window: false,
      doorLock: false,
      headlights: false,
      blind: false,
      ambientLight: false,
      telltales: false,
      navi: false,
      tts: true,
      stt: true,
      ...parsed,
      source: 'pleos',
    }
    window.__cv = {
      onSignals: (json) => {
        try {
          this.sig = { ...this.sig, ...JSON.parse(json), t: Date.now() }
        } catch {
          /* ignore malformed frame */
        }
      },
      onSpeech: (id, ev, payload) => speechListeners.forEach((l) => l(id, ev, payload)),
      onSdkTrace: (line) => traceListeners.forEach((l) => l(line)),
      onGleo: (json) => gleoHandler(json),
      onEvent: (type, json) => {
        let payload: Record<string, unknown> = {}
        try {
          payload = JSON.parse(json)
        } catch {
          /* malformed event */
        }
        const ev = { type, ...payload } as BusEvent
        this.eventListeners.forEach((l) => l(ev))
      },
    }
  }

  capabilities() {
    return this.caps
  }

  read(): VehicleSignals {
    return { ...this.sig, t: Date.now() }
  }

  async apply(action: VehicleAction) {
    const api = window.CarValueNative!
    switch (action.kind) {
      case 'searchPlace':
        return api.searchPlace?.(String(action.value)) ?? false
      case 'routeOption':
        return api.routeOption?.(String(action.value)) ?? false
      case 'showChargers':
        return api.showChargers?.() ?? false
      default:
        return api.act(JSON.stringify(action))
    }
  }

  onEvent(fn: (e: BusEvent) => void) {
    this.eventListeners.add(fn)
    return () => void this.eventListeners.delete(fn)
  }
}

// Gleo Interface (schema.json) actions arrive here and must be answered synchronously.
type GleoHandler = (json: string) => { status: string; message: string; data?: unknown }
let gleoHandler: GleoHandler = () => ({ status: 'fail', message: '밸류링크가 아직 준비 중이에요.' })
export const setGleoHandler = (fn: GleoHandler) => {
  gleoHandler = fn
}
