# 깨움 KKAEUM: 졸음이 오기 전에, 차가 먼저 깨운다

**한 줄 소개**: 차량 데이터로 졸음을 *예측*하고, 공조·조명·시트·내비게이션을 직접 움직여 졸음이 오기 전에 운전자를 깨우는 **Pleos Connect 졸음운전 예방 코파일럿**.

현대자동차그룹 차량용 앱 개발 공모전 *Code your App into Pleos App Market* 출품작.

| | |
|---|---|
| 웹 라이브 데모 | https://leeshoun888.github.io/kkaeum/ |
| Mission Control (심사용 데모) | https://leeshoun888.github.io/kkaeum/#/console |
| 차량 앱 화면 | https://leeshoun888.github.io/kkaeum/#/car |
| Fleet 콘솔 (B2B) | https://leeshoun888.github.io/kkaeum/#/fleet |
| APK | [`apk/`](apk/) 폴더 (release 빌드) |
| 기획서(접수양식) | [`docs/`](docs/) |

---

## 무엇을 하나요

고속도로 사망자의 **71.6%가 졸음·주시태만**(한국도로공사, 2026 상반기)인데, 차량의 기존 운전자 주의 경고(DAW)는 이미 졸린 *뒤*에 경고등을 켤 뿐입니다. 깨움은 이를 **Sense → Predict → Intervene → Recover** 의 닫힌 고리로 바꿉니다.

1. **졸음 예측 엔진**: 3-Process 각성 모델(Åkerstedt & Folkard)로 기상시각·수면·생체리듬을 계산하고 연속운전시간·도로 단조로움·실내 CO₂·온도·차량 주의경고(`DRIVER_ATTENTION` 텔테일)·음성 반응속도를 결합해 **KSS(1–9)** 와 *위험 도달 시각*을 예측합니다. 각 요인의 기여도를 설명 가능한 형태로 보여줍니다.
2. **캐빈 CO₂ 디지털트윈**: `dC/dt = N·G/V − λ(C − C_out)` 질량수지 모델(현대 엘란트라 실측 계수, Deng et al. 2020)로 센서 없이 실내 CO₂를 추정하고, 1,200ppm 초과 시 외기 전환. 미세먼지가 나쁘면 듀티사이클 펄스 환기.
3. **단계별 개입 L0–L4**: 온도·송풍·앰비언트·통풍시트 → 대화형 각성 퀴즈·음성 PVT → 쉼터 경유지 → 반복 경고. **주행 조작에는 절대 개입하지 않습니다.**
4. **예측 휴식 플래너**: 공공데이터 **졸음쉼터 253개소 + 휴게소**를 경로에 정합해 *졸리기 전에 도착 가능한 마지막 쉼터*를 고르고 `NaviHelper.addWaypoint()`로 추가 (법인·렌터카 플릿은 회사 휴식정책을 제약으로 사용).
5. **파워냅 모드**: 정차(P) 시 시트 리클라인·수면 공조·웜톤 조명 → 타이머 → 빛·바람·소리 기상 시퀀스 → 반응속도 재측정.
6. **음성 코파일럿**: OpenAI Realtime(WebRTC) 함수 호출로 “좀 졸린데” 한마디에 상태 조회·캐빈 제어·경유지 제안. Gleo Interface `schema.json` 등록.
7. **Fleet 콘솔 / 주행 리포트**: 법인차·렌터카 플릿 관리자용 실시간 대시보드, AI 안전 코치 리포트.

## 저장소 구성

```
web/        React + TypeScript (Vite): 엔진, 차량 앱 UI, Mission Control, Fleet, 랜딩
  src/engine/   fatigue.ts(3-Process→KSS) · co2.ts(디지털트윈) · planner.ts · orchestrator.ts
                runtime.ts · sim.ts(시나리오 시뮬레이터) · native.ts(APK 브릿지) · sdkTrace.ts
  src/data/     route.json(경부고속도로) · reststops.json(공공데이터) · accidents.json · routePack.json
android/    Pleos Connect 호스트 앱 (Kotlin): WebView + Pleos SDK 브릿지, Gleo schema
server/     API 서버(무의존성 Node): OpenAI 키를 서버에만 보관 (Realtime 세션, TTS, AI 코치)
tools/      음성 프롬프트(gpt-4o-mini-tts)·지역 각성 콘텐츠 팩(gpt-5.5) 생성 스크립트
docs/       기획서(접수양식), 그림
apk/        release APK
```

## 실행 방법

### 1) 웹 (데모·심사용)
```bash
cd web
npm install
npm run dev            # http://localhost:5173  (#/console, #/car, #/fleet, #/report)
```
AI 기능(Realtime 음성 코파일럿, 동적 TTS, AI 리포트)을 쓰려면 API 서버를 함께 실행합니다. 키가 없어도 나머지 기능은 모두 동작합니다(사전 렌더링 음성·브라우저 음성으로 대체).
```bash
OPENAI_API_KEY=sk-... node server/index.mjs   # :8790, vite가 /api 를 프록시
```
프로덕션: `cd web && npm run build` 후 `node server/index.mjs` 가 `web/dist`를 함께 서빙합니다.

### 2) Android / Pleos Connect
자세한 내용은 [`android/README.md`](android/README.md).
```bash
cd web && npm run build          # 웹 번들 → android assets 로 복사됨
cd ../android && ./gradlew assembleRelease
```
- 요구사항: Android API 28+, Gradle 8+, JDK 17, Kotlin (Pleos 개발 환경 요구사항)
- SDK: `ai.pleos.playground:Vehicle:2.3.2`, `NaviHelper:3.0.5`, `TextToSpeech:3.3.1`, `SpeechToText:3.3.1`, `FusedLocation:1.1.3` (Maven: `https://nexus-playground.pleos.ai/repository/maven-releases/`)
- 테스트 환경: Pleos Connect Emulator v2.1.0 (API 34) + Virtual Console(`adb forward tcp:8088 tcp:8088`): 공조·텔테일(`DRIVER_ATTENTION`)·기어를 조작해 개입을 확인.
- 연동 범위(에뮬레이터 실기 검증): Vehicle(HVAC·Seat·Light·Window·Safety·Body·EV·Trip 리스너와 제어), CarPropertyManager(속도·기어·외기온·DMS 벤더 속성), NaviHelper(경유지 추가·취소, requestTrip ETA, TBT, 위험구간, 내비 상태, 충전소 화면), FusedLocation(위치·지오펜스), TTS/STT, Gleo 4개 함수, Pleos Fleet Webhook·REST 토큰 플로우(`server/fleet.mjs`).
- 연동 불가: 운전자 오디오존(시스템 API), Fleet REST 실데이터(계약 필요), Vehicle Data API(유럽 전용), Platform SDK DMS(특권 앱), LLM SDK(서비스 종료).
- 차량 제어(CONTROL_*) 권한은 Pleos App Market 사전 승인 대상이며, 미승인/미지원 시 앱은 음성 권고로 자동 대체합니다.

## 근거 데이터
- 한국도로공사 전국 졸음쉼터 표준데이터(2026.02), 고속도로 졸음운전 사고통계 원자료(2023–2025, 694건), 휴게소 OpenAPI
- Åkerstedt & Folkard 3-Process Model · Deng et al., *Sensors* 2020 · Satish et al., *EHP* 2012 · Wyon et al., *Ergonomics* 1996 · Reyner & Horne, *Psychophysiology* 1997 · Basner & Dinges 2011(PVT)
- 지도: © OpenStreetMap contributors, OpenFreeMap · 경로: OSRM

## 안전·개인정보 원칙
주행 조작(가속·조향·제동) 비개입 · 졸음 추론 전부 온디바이스 · 음성 원본·위치 서버 미전송 · 의료 진단 아님 · Pleos 주의분산 가이드라인 준수(주행 중 애니메이션/스크롤 없음, 음성 우선).
