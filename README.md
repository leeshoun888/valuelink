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
| 잇는다 | 6개 요인으로 분해한 자산 가치, 3년 가치 예측, 여권 기반 매입가(침수 안심 인증 우대), 보조금·세제 타이밍을 반영한 교체 시점, 블루핸즈·E-pit·현대캐피탈 연결과 매출 기회 장부, Gleo 음성 6개 함수 | `CarInfo.getVINInfo` · Gleo `schema.json` |

### 공공데이터 × 밸류맵

차를 세우는 순간 그 자리의 24시간 기대손실과 주차 안전 점수를 계산합니다. 정확한 위치 대신 기상청 5km 격자만 조회에 씁니다.

| 공공데이터 | 차가 하는 일 |
|---|---|
| 기상청 초단기예보 | 30분 뒤 비 예보 → 열린 창문을 비 오기 전에 닫음 (`Window.setWindowPosition`) |
| 기상청 기상특보 × 행정안전부 침수흔적도 | 호우경보 중 침수흔적 구역 → 가장 안전한 공영주차장 안내 (`NaviHelper.SearchPlace`), 특보 해제 후 블루핸즈 안심 점검 |
| 생활안전지도 범죄주의구간 | 문 잠금 (`Door.setDoorLock`) |
| 도로교통공단 사고다발지역 | 진입 전 감속 안내 |
| 전국주차장정보표준데이터 + 건축물대장 | 옥내·고층 주차장 추천 |
| 한국환경공단 충전소 실시간 상태 | 빈 E-pit 안내 |
| 무공해차 통합누리집 보조금 공고 | 교체 최적 시점 (실 부담 = 신차 − 보조금 − 매입가 − 할인) |
| 국토교통부 리콜정보 · 배터리 이력관리제 | 차량 여권 |

**실연동 검증 (2026-11-09)**: 공공데이터포털·생활안전지도 인증키로 기상청 초단기실황·예보, 기상특보, 생활기상지수, 생활안전지도 침수흔적도·범죄주의구간(절도) WMS, 도로교통공단 결빙 사고다발지, 전국주차장정보표준데이터, 한국환경공단 충전소 API를 실제로 호출해 에뮬레이터에서 동작을 확인했습니다.

- 인증키는 저장소와 APK에 없습니다. `tools/publicdata-proxy`(중계 서버)가 `../.secrets`에서 읽어 보관합니다.
- 차량 앱은 같은 출처 경로(`https://appassets…/assets/web/pub/`)로 요청하고, Android(`PublicDataRelay`)가 중계 서버로 전달합니다. 차의 좌표 대신 기상청 격자, 약 1km 지도 타일, 자치구 코드만 씁니다.
- 중계 서버가 없는 빌드(웹 데모, 제출 APK)는 `tools/publicdata-capture.mjs`로 수집한 강남·서초 실데이터(`web/public/pub`)를 같은 엔진으로 읽습니다. 날씨·특보만 시연 시나리오를 따릅니다.

```bash
tools/publicdata-proxy/run.sh                                   # :8791
adb reverse tcp:8791 tcp:8791
cd android && ./gradlew assembleDebug -PpublicProxy=http://127.0.0.1:8791
```

웹에서 실시간: `VITE_PUBLIC_PROXY=http://127.0.0.1:8791 npm run dev` 후 `http://127.0.0.1:5173/?live#/car`

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
- 경고등(TPMS) 감지 → 블루핸즈 안내, 즐겨찾기 수신, Gleo 6개 함수 응답
- 기상청 예보(30분 뒤 비) → 창문 40% → 0%, 호우경보 × 침수흔적 → 주차 안전 3(위험) → 공영주차빌딩 내비 검색, 특보 해제 → 블루핸즈 안심 점검 (서명된 release APK에서 확인)
- 차량 서비스(VHAL) 재시작에도 앱이 살아남고 자동 재연결

## 외부 앱 권한 밖의 것

긴급제동·ABS 이벤트와 실제 타이어 압력은 시스템 서명 권한이라 3rd-party 앱이 읽을 수 없습니다(제휴 선탑재 시 가능). 엔진오일·브레이크액·에어백 전개 이력은 권한이 허용되지만 에뮬레이터 차량(전기차)에 센서가 없어 실차에서 동작합니다. 시세 계수와 제휴 서비스(인증중고차 매입가 보장 등)는 출품 시나리오의 가정값입니다.

## 개인정보

계산과 저장은 전부 차 안에서 이뤄집니다. 차량 여권은 차주가 동의할 때만 매입사와 공유합니다.
