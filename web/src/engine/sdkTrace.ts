// Maps engine actions to the exact Pleos Connect SDK calls the APK makes
// (signatures from Vehicle 2.3.2 / NaviHelper 3.0.5 / TextToSpeech 3.3.1 AARs).
// In the browser this renders as a live "SDK call trace"; in the APK the
// native side reports the real calls through window.__cv.onSdkTrace.

import type { VehicleAction } from './types'

const DRV = 'SeatArea(ROW_1_LEFT)'
// Areas as reported by the capability checks on Pleos Connect 2.1.0 (driver-only areas are refused).
const CABIN = 'SeatArea(ROW_1_LEFT, ROW_1_RIGHT, ROW_2_LEFT, ROW_2_CENTER, ROW_2_RIGHT)'
const FRONT = 'SeatArea(ROW_1_LEFT, ROW_1_RIGHT)'

export function sdkCallsFor(a: VehicleAction): string[] {
  const v = a.value
  switch (a.kind) {
    case 'freshAir':
      return [`vehicle.getHVAC().setHvacRecirculation(${CABIN}, ${v ? 'false' : 'true'})  // ${v ? '외기 유입' : '내기순환'}`]
    case 'recirculation':
      return [`vehicle.getHVAC().setHvacRecirculation(${CABIN}, ${v ? 'true' : 'false'})`]
    case 'temperature':
      return [`vehicle.getHVAC().setHvacTemperature(${DRV}, ${Number(v).toFixed(1)}f, TemperatureUnit.CELSIUS)`]
    case 'fan':
      return [`vehicle.getHVAC().setHvacPower(${CABIN}, true)`, `vehicle.getHVAC().setHvacFanSpeed(${FRONT}, ${v})`]
    case 'ambient': {
      const amb = v as { color: string; brightness: number }
      return [
        `vehicle.getLight().setAmbientLightSwitch(${CABIN}, LightSwitch.ON)`,
        `vehicle.getLight().setAmbientLightBrightness(${CABIN}, ${amb.brightness})`,
        `vehicle.getLight().setAmbientLightBrightnessColor(${CABIN}, 0x${amb.color.slice(1).toUpperCase()})`,
      ]
    }
    case 'seatVent':
      return [`vehicle.getSeat().setHvacSeatVentilation(${DRV}, ${v})`]
    case 'seatRecline':
      return Number(v) > 20
        ? [
            `vehicle.getSeat().getCurrentSeatBackrestAnglePosition(${DRV})  // 복원용 저장`,
            `vehicle.getSeat().moveSeatBackrestAngle(${DRV}, MoveControl.BACKWARD)`,
            `  … 5750ms → moveSeatBackrestAngle(${DRV}, MoveControl.STOP)`,
          ]
        : [
            `vehicle.getSeat().moveSeatBackrestAngle(${DRV}, MoveControl.FORWARD)`,
            `  … poll getCurrentSeatBackrestAnglePosition until saved → MoveControl.STOP`,
          ]
    case 'window':
      return [`vehicle.getWindow().setWindowPosition(WindowArea(ROW_1_LEFT), ${v})`]
    case 'waypoint': {
      const s = (v as { stop: { name: string; lngLat: [number, number] } }).stop
      return [
        (v as { needsConfirm: boolean }).needsConfirm
          ? `naviHelper.requestTrip(TripRequest(${s.lngLat[1].toFixed(5)}, ${s.lngLat[0].toFixed(5)}, "${s.name}"))  // 실제 ETA·도착 SoC`
          : `naviHelper.addWaypoint(RequestWaypointInfo(${s.lngLat[1].toFixed(5)}, ${s.lngLat[0].toFixed(5)}, "${s.name}", WaypointIndex.FIRST))`,
        ...((v as { needsConfirm: boolean }).needsConfirm
          ? []
          : [`fusedLocation.addProximityAlert(ProximityAlertRequest(${s.lngLat[1].toFixed(4)}, ${s.lngLat[0].toFixed(4)}, 400f, {ENTER, EXIT}))`]),
      ]
    }
    case 'speak':
      return [`audioFocus.request(GAIN_TRANSIENT_MAY_DUCK) → play voice/${v}.mp3  (fallback: textToSpeech.speak(…))`]
    case 'probe':
      return ['speechToText.startListening()  // onBeginningOfSpeech → reaction time']
    case 'engage':
      return ['speechToText.startListening()  // 각성 퀴즈 답변 인식']
    case 'napStart':
      return [`telltales.PARKING_BRAKE == ON && GEAR_SELECTION == P  ✓  → nap timer ${v}min`]
    case 'napWake':
      return ['nap timer elapsed → wake sequence (light · air · voice)']
    case 'heatOff':
      return [`vehicle.getSeat().setHvacSeatTemperature(${DRV}, 0)`, 'vehicle.getSteeringWheel().setHvacSteeringWheelHeat(0)']
    case 'fanDirection':
      return [`vehicle.getHVAC().setHvacFanDirection(${FRONT}, FanDirectionType.FACE)`]
    case 'cabinLight':
      return [`vehicle.getLight().setCabinLightSwitch(LightSwitch.${v ? 'ON' : 'OFF'})`]
    case 'lumbarPulse':
      return [`vehicle.getSeat().moveSeatLumbarForeAft(${DRV}, FORWARD → BACKWARD → STOP)  // 0.4s 촉각 신호`]
    case 'blind':
      return [`vehicle.getWindow().moveWindowBlind(WindowArea(ROOF_TOP_1), MoveControl.${v === 'close' ? 'FORWARD' : 'BACKWARD'})`]
    case 'smartGlass':
      return [`vehicle.getWindow().setSmartGlassState(${v ? 'true' : 'false'})`]
    case 'showChargers':
      return ['naviHelper.requestNavigationScreen(NavigationScreenRequest.NearbyChargingStations)']
    default:
      return []
  }
}

export const READ_CALLS = [
  'carPropertyManager.registerCallback(PERF_VEHICLE_SPEED · GEAR_SELECTION · PARKING_BRAKE_ON · ENV_OUTSIDE_TEMPERATURE)',
  'carPropertyManager.registerCallback(DMS_DROWSINESS_WARNING 557903627)  // Pleos vendor property (권한 시)',
  `vehicle.getSafety().registerTelltales(listener)  // DRIVER_ATTENTION · PARKING_BRAKE`,
  `vehicle.getHVAC().register{RecirculationState·FanSpeed·Temperature}(${CABIN}, listener)`,
  'vehicle.getSeat().registerHvacSeatTemperature · getSteeringWheel().registerHvacSteeringWheelHeatState',
  'vehicle.getLight().registerLowBeamLightState(listener)  // 야간 주행',
  'vehicle.getDrivingMode().registerCruiseControlState · registerCruiseControlTargetSpeed',
  'vehicle.getWiper().registerWiperState(FRONT_WINDSHIELD) · getBrake().registerBrakePedalStatus',
  'vehicle.getEvBattery().registerEvBatteryStateOfCharge · getOdometer().registerRangeRemainingListener',
  'vehicle.getSteeringWheel().registerSteeringWheelAngle · getTurnSignal().registerTurnSignalState',
  'fusedLocation.registerFusedLocationCallback(listener)',
  'naviHelper.getTBTInfo · onCautionPointInfo · getWaypointInfo · getRecentDestinationInfo',
]
