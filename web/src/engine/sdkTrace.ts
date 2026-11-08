// The Pleos SDK / AAOS reads the value engine relies on, listed for the console's SDK panel. In the APK the
// native side reports every real call through window.__cv.onSdkTrace instead.

export const READ_CALLS: { api: string; call: string; use: string }[] = [
  { api: 'AAOS', call: 'EV_CURRENT_BATTERY_CAPACITY / INFO_EV_BATTERY_CAPACITY', use: '배터리 건강도(SOH) 실측' },
  { api: 'AAOS', call: 'EV_CHARGE_STATE · EV_BATTERY_INSTANTANEOUS_CHARGE_RATE', use: '충전 세션·급속 비율' },
  { api: 'AAOS', call: 'EV_CHARGE_PERCENT_LIMIT · EV_CHARGE_PORT_CONNECTED', use: '충전 상한·플러그 상태' },
  { api: 'AAOS', call: 'INFO_MAKE / INFO_MODEL / INFO_MODEL_YEAR', use: '차종·연식 식별' },
  { api: 'AAOS', call: 'WHEEL_TICK', use: '주행거리 독립 검증(여권)' },
  { api: 'AAOS', call: 'PERF_VEHICLE_SPEED · GEAR_SELECTION', use: '급가속·급제동, 주행/정차' },
  { api: 'Vehicle', call: 'Odometer.registerDistanceDriven', use: '누적 주행거리' },
  { api: 'Vehicle', call: 'Safety.getTelltalesInfo → warningCount', use: '경고등·운전보조 경고 횟수' },
  { api: 'Vehicle', call: 'Safety.getEngineOilLevelState · hasSeatAirbagBeenDeployed', use: '관리 상태·사고 이력' },
  { api: 'Vehicle', call: 'Tire.getLowTirePressure', use: '타이어 관리' },
  { api: 'Vehicle', call: 'EvBattery.registerEvBatteryStateOfCharge', use: '충전 습관' },
  { api: 'Vehicle', call: 'Window.getCurrentWindowPosition · Wiper.registerWiperState', use: '비 오는 날 창문' },
  { api: 'Vehicle', call: 'Light.registerLowBeamLightState · Brake.registerBrakePedalStatus', use: '방전 위험·제동 습관' },
  { api: 'Vehicle', call: 'CarInfo.getVINInfo', use: '차량 여권 식별자' },
  { api: 'NaviHelper', call: 'getBookmarkInfo · getRouteStateInfo · onDestinationInfo', use: '집 위치·장거리 일정' },
  { api: 'FusedLocation', call: 'requestLocationUpdates', use: '주행 경로' },
  { api: 'TTS / STT', call: 'speak · startListening', use: '음성 안내·응답' },
  { api: 'Gleo', call: 'schema.json 5 functions → APP_ACTION_RESPONSE', use: '“제값, 내 차 얼마야?”' },
]
