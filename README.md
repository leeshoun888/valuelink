# 밸류링크 ValueLink

**당신의 현대차를 자산으로 관리하는 가장 스마트한 방법.**
Pleos Connect 위에서 차가 스스로 가치를 **지키고**, **증명하고**, 다음 차와 다음 주인에게 **잇습니다**.

- 웹 라이브 데모: https://leeshoun888.github.io/valuelink/ (랜딩 · `#/console` 시연 콘솔 · `#/car` 차량 앱 · `#/passport` 차량 여권 · `#/fleet` 플릿)
- APK: [`apk/`](apk/) (Pleos Connect 에뮬레이터 2.1.0, API 34에서 검증)
- 현대자동차그룹 차량용 앱 개발 공모전 출품작

## 무엇을 하나요

| | 차가 하는 일 | Pleos / AAOS |
|---|---|---|
| 지킨다 | 충전 상한 80% (장거리 전날만 100%), 폭염 충전 전류 제한, 비 오면 창문 닫기, 주차 후 전조등 끄기, 한낮 블라인드, 경고등이 켜지면 블루핸즈 검색, 깊은 방전 시 충전소 | `EvBattery.setEvChargePercentLimit` · `setEvChargeCurrentDrawLimit` · `Window.setWindowPosition` · `Light.setLowBeamLightSwitch` · `Window.moveWindowBlind` · `NaviHelper.requestNavigationScreen` |
| 증명한다 | 차량 실측 배터리 건강도, 주행거리와 바퀴 회전 수 이중 기록, 경고등·정비·에어백 이력, 하루 한 블록 SHA-256 해시 사슬 | `EV_CURRENT_BATTERY_CAPACITY / INFO_EV_BATTERY_CAPACITY` · `Odometer` · `WHEEL_TICK` · `Safety.getTelltalesInfo` |
| 잇는다 | 6개 요인으로 분해한 자산 가치, 3년 가치 예측(내 습관 vs 평균), 여권 기반 보상판매 매입가, Gleo 음성 5개 함수 | `CarInfo.getVINInfo` · Gleo `schema.json` |

모든 제어는 capability를 확인한 뒤 실행하고, 지원하지 않거나 승인 전이면 같은 규칙이 음성 안내로 대체됩니다. 창문·전조등·블라인드는 P단 정차가 확인될 때만 움직입니다.

## 저장소 구성

```
android/      Pleos Connect 호스트 앱 (Kotlin): WebView + Vehicle/NaviHelper/TTS/STT/FusedLocation + AAOS Car API
  vehicle/    SignalCollector(1Hz) · SignalListeners · CarPropertySource(서비스 재시작 대응) · VehicleGateway(가치 지킴 제어)
web/          React + TypeScript
  engine/     valuation · battery · habits · passport(SHA-256) · guard(규칙) · runtime · sim(밸류링크의 하루) · native
  car/        차량 앱 (1700×1212 / 840×1184 dp, 라이트·다크, Liquid Glass)
  three/      StudioCar: Blender로 만든 IONIQ 5 glb를 쓰는 3D 트윈 (차량에서는 저전력 렌더)
  pages/      랜딩 · 차량 여권 · 플릿
  console/    시연 콘솔
tools/blender export-geometry.ts → build.py(모델·패널 라인·AO 베이킹·glb) → render.py(Cycles 스튜디오 렌더)
tools/emu     에뮬레이터 재배포, 가상 콘솔 시나리오(jg.sh), WebView 디버그
docs/         기획서(접수양식) 빌더, 다이어그램, 스크린샷
```

## 실행

```bash
cd web && npm install && npm run dev        # http://127.0.0.1:5173
```

```bash
cd web && npm run build && cd ../android && ./gradlew assembleRelease   # web/dist가 APK assets로 동기화됨
```

- SDK: `ai.pleos.playground:Vehicle:2.3.2`, `NaviHelper:3.0.5`, `TextToSpeech:3.3.1`, `SpeechToText:3.3.1`, `FusedLocation:1.1.3`
- 에뮬레이터 시나리오: `adb forward tcp:8088 tcp:8088` 후 가상 콘솔 페이지를 연 상태에서 `tools/emu/jg.sh plug 100`, `rain`, `lights`, `lamp TPMS On` 등

## 에뮬레이터 검증 (Pleos Connect 2.1.0)

- 배터리 건강도: 77,000 / 77,400 Wh = 99.5% (3rd-party 권한으로 읽음)
- 충전 상한 50% → 80% 설정 후 재조회 확인, 충전 전류 12.5 → 16A
- 가상 콘솔에서 연 창문 40% → 0%, 전조등 LowBeam → Off 확인
- 경고등(TPMS) 감지 → 블루핸즈 안내, 즐겨찾기 수신, Gleo 5개 함수 응답
- 차량 서비스(VHAL) 재시작에도 앱이 살아남고 자동 재연결

## 외부 앱 권한 밖의 것

긴급제동·ABS 이벤트와 실제 타이어 압력은 시스템 서명 권한이라 3rd-party 앱이 읽을 수 없습니다(제휴 선탑재 시 가능). 엔진오일·브레이크액·에어백 전개 이력은 권한이 허용되지만 에뮬레이터 차량(전기차)에 센서가 없어 실차에서 동작합니다. 시세 계수와 제휴 서비스(인증중고차 매입가 보장 등)는 출품 시나리오의 가정값입니다.

## 개인정보

계산과 저장은 전부 차 안에서 이뤄집니다. 차량 여권은 차주가 동의할 때만 매입사와 공유합니다.
