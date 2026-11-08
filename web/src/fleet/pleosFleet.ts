// Pleos Fleet API (document.pleos.ai/api-reference/fleet-api) on the console side.
//
// - periodicPayload(): builds a Webhook "Periodic Data" body exactly as documented
//   ({vin, vehicleId, itemsCount, items[{messageTime, data:{Vehicle:{Speed:{value,eventTime}}, …}}]},
//   header X-42dot-transmissionType 10S_30S: collected every 10 s, sent every 30 s).
// - normalise(): the same flattening server/fleet.mjs applies to real webhooks.
// - WebhookVehicle: a VehicleBus fed by normalised webhook updates, so a real fleet vehicle gets its own
//   KKAEUM fatigue engine (time on task from speed, circadian from the clock, location for rest stops).

import type { BusEvent, Capabilities, VehicleBus } from '../engine/bus'
import type { RestStop, VehicleAction, VehicleSignals } from '../engine/types'

export interface FleetSample {
  t: number
  speedKph: number
  lat: number
  lon: number
  odometerKm?: number
  socPct?: number
  dteKm?: number
}

export interface FleetUpdate {
  kind: 'periodic' | 'event'
  vin?: string
  vehicleId: string
  t: number
  speedKph?: number
  lat?: number
  lon?: number
  odometerKm?: number
  dteKm?: number
  socPct?: number
  ignition?: string
  buckled?: string | boolean
  parkingBrake?: string
  raw?: Record<string, unknown>
}

const vo = (value: unknown, t: number) => ({ value, eventTime: new Date(t).toISOString().replace('Z', '000000Z') })

/** Webhook Periodic Data body for up to three 10 s samples. */
export function periodicPayload(vehicleId: string, vin: string, samples: FleetSample[]) {
  return {
    vin,
    vehicleId,
    itemsCount: samples.length,
    items: samples.map((s) => ({
      messageTime: new Date(s.t).toISOString().replace('Z', '000000Z'),
      data: {
        Vehicle: {
          Speed: vo(Math.round(s.speedKph * 10) / 10, s.t),
          Latitude: vo(s.lat, s.t),
          Longitude: vo(s.lon, s.t),
          ...(s.odometerKm !== undefined ? { Odometer: vo(s.odometerKm, s.t) } : {}),
          ...(s.dteKm !== undefined ? { DTE: vo(s.dteKm, s.t) } : {}),
        },
        ...(s.socPct !== undefined ? { TractionBattery: { SOC: vo(s.socPct, s.t) } } : {}),
      },
    })),
  }
}

/** Webhook Vehicle event body (e.g. Vehicle.DrivingReady ON/OFF at trip start / end). */
export function eventPayload(vehicleId: string, vin: string, t: number, data: Record<string, unknown>) {
  return { vin, vehicleId, itemsCount: 1, items: [{ messageTime: new Date(t).toISOString(), data }] }
}

function flatten(data: unknown, prefix = '', out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries((data ?? {}) as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && 'value' in (v as object)) out[key] = (v as { value: unknown }).value
    else if (v && typeof v === 'object') flatten(v, key, out)
  }
  return out
}

type Payload = { vin?: string; vehicleId: string; items?: { messageTime: string; data: unknown }[] }

export function normalise(payload: Payload, kind: 'periodic' | 'event'): FleetUpdate[] {
  return [...(payload.items ?? [])]
    .sort((a, b) => a.messageTime.localeCompare(b.messageTime))
    .map((it) => {
      const f = flatten(it.data)
      return {
        kind,
        vin: payload.vin,
        vehicleId: payload.vehicleId,
        t: Date.parse(it.messageTime) || Date.now(),
        speedKph: f['Vehicle.Speed'] as number | undefined,
        lat: f['Vehicle.Latitude'] as number | undefined,
        lon: f['Vehicle.Longitude'] as number | undefined,
        odometerKm: f['Vehicle.Odometer'] as number | undefined,
        dteKm: f['Vehicle.DTE'] as number | undefined,
        socPct: f['TractionBattery.SOC'] as number | undefined,
        ignition: (f['Vehicle.DrivingReady'] ?? f['Vehicle.Ignition1']) as string | undefined,
        buckled: (f['Seat.Buckle.Driver'] ?? f['Vehicle.Seat.Buckle.Driver']) as string | boolean | undefined,
        parkingBrake: f['ParkingBrake.Engage'] as string | undefined,
        raw: f,
      }
    })
}

const FLEET_CAPS: Capabilities = {
  hvacRecirculation: false,
  hvacTemperature: false,
  hvacFan: false,
  ambientLight: false,
  seatVentilation: false,
  seatRecline: false,
  window: false,
  navWaypoint: false,
  tts: false,
  stt: false,
  llm: false,
  daw: false,
  source: 'pleos',
}

/** Read-only bus over Fleet API webhooks: the console can predict, the car does the intervening. */
export class WebhookVehicle implements VehicleBus {
  readonly kind = 'fleet' as const
  private sig: VehicleSignals

  constructor(first: FleetUpdate) {
    this.sig = { t: first.t, speedKph: 0, gear: 'P', parkingBrake: true, recirculation: false, setTempC: 22, fanSpeed: 2, occupants: 1 }
    this.ingest(first)
  }

  ingest(u: FleetUpdate) {
    const s = { ...this.sig, t: Math.max(this.sig.t, u.t) }
    if (u.speedKph !== undefined) {
      s.speedKph = u.speedKph
      s.gear = u.speedKph > 1 ? 'D' : s.gear
      s.parkingBrake = u.speedKph > 1 ? false : s.parkingBrake
    }
    if (u.lat !== undefined && u.lon !== undefined) s.position = [u.lon, u.lat]
    if (u.socPct !== undefined) s.socPct = u.socPct
    if (u.dteKm !== undefined) s.rangeKm = u.dteKm
    if (u.odometerKm !== undefined) s.tripKm = u.odometerKm
    if (u.parkingBrake) s.parkingBrake = u.parkingBrake === 'ENGAGE'
    if (u.ignition === 'OFF') {
      s.gear = 'P'
      s.speedKph = 0
    }
    this.sig = s
  }

  capabilities() {
    return FLEET_CAPS
  }

  read(): VehicleSignals {
    return { ...this.sig }
  }

  async apply(_a: VehicleAction) {
    return false
  }

  async addWaypoint(_s: RestStop) {
    return false
  }

  onEvent(_fn: (e: BusEvent) => void) {
    return () => {}
  }
}
