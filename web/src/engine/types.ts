// Shared types for the ValueLink value engine.
// VehicleSignals is the contract with the Android host: SignalCollector / CarPropertySource keys
// (android/app/src/main/java/com/carvalue/app/vehicle) arrive here one-for-one.

export type Gear = 'P' | 'R' | 'N' | 'D'

/** A telltale that is on now (Safety.getTelltalesInfo). `count` is the car's own warningCount. */
export interface Warning {
  type: string
  state: string
  count: number
}

export type ChargeState = 'charging' | 'full' | 'idle' | 'error' | 'unknown'

export interface VehicleSignals {
  t: number // epoch ms
  speedKph: number
  gear: Gear
  parkingBrake: boolean

  // identity (AAOS INFO_* / Pleos CarInfo)
  make?: string
  model?: string
  modelYear?: number
  fuelType?: string
  vin?: string

  // mileage (Pleos Odometer, AAOS WHEEL_TICK as an independent witness)
  odometerKm?: number
  wheelTickKm?: number
  tripKm?: number

  // battery & charging (AAOS EV_* + Pleos EvBattery)
  socPct?: number
  rangeKm?: number
  batteryCapWh?: number
  batteryDesignWh?: number
  chargeState?: ChargeState
  chargeKw?: number
  chargeMinLeft?: number
  plugged?: boolean
  chargePortOpen?: boolean
  /** EV_CHARGE_SWITCH: charging enabled (the Virtual Console's "charging" toggle) */
  chargeSwitch?: boolean
  chargeLimitPct?: number
  chargeCurrentA?: number
  evEfficiency?: number

  // condition (Pleos Safety / Tire, when the vehicle exposes them)
  warnings?: Warning[]
  adasWarnings?: number
  overSpeedWarnings?: number
  engineOil?: string
  brakeFluid?: string
  transmissionOil?: string
  lowWasher?: boolean
  airbagDeployed?: boolean
  powerDownWarning?: boolean
  lowTireKpa?: number

  // habits (derived on the host from the 1 Hz speed feed, brake pedal listener)
  /** telltale EV_BATTERY_CONDITIONING (pack being warmed before a fast charge) */
  batteryConditioning?: boolean
  /** navi DrivingInfo: a DC fast-charging stop on the route */
  fastChargePlanned?: boolean
  plannedChargeKw?: number
  plannedChargeKm?: number
  /** navi CameraAlert over-speed episodes */
  cameraOverSpeed?: number
  /** telltale DRIVE_MODE_SPORT */
  sportMode?: boolean
  harshAccel?: number
  harshBrake?: number
  brakeEvents?: number
  driveMode?: string

  // cabin & environment
  windowsOpen?: number
  raining?: boolean
  headlightsOn?: boolean
  outsideTempC?: number

  // location & navi
  position?: [number, number] // [lng, lat]
  headingDeg?: number
  routeRemainingKm?: number
  routeEtaMin?: number
  navStatus?: string

  /** Vehicle day/night UI mode (APK only). */
  uiNight?: boolean

  // Simulator-only state the 3D twin shows (the APK does not read these back).
  blindClosed?: boolean
  doorsLocked?: boolean
  ambientColor?: string
  /** Last navi screen ValueLink opened (search / chargers), for the console's navi panel. */
  navScreen?: string
  placeName?: string
}

export type ActionKind =
  | 'chargeLimit'
  | 'chargeCurrent'
  | 'closeWindows'
  | 'lightsAuto'
  | 'lockDoors'
  | 'blind'
  | 'ambient'
  | 'searchPlace'
  | 'routeOption'
  | 'showChargers'

export interface VehicleAction {
  kind: ActionKind
  value?: unknown
  reason: string
}

export interface Bookmark {
  name: string
  category: 'HOME' | 'OFFICE' | 'EV_CHARGING_STATION' | 'DEFAULT' | string
  lat: number
  lng: number
}
