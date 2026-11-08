# 깨움 KKAEUM: Android host (Pleos Connect / AAOS)

A thin native shell around the React UI in `../web`. The UI runs in a WebView. The native side talks to the
Pleos SDKs and the AAOS Car API and bridges them to the web engine (`web/src/engine/native.ts`).

```
web/dist  ──copyWebDist──▶  app/src/main/assets/web  ──WebViewAssetLoader──▶  https://appassets.androidplatform.net/assets/web/index.html#/car
                                                                                │  window.KkaeumNative.{act, addWaypoint, capabilities, speak, listen, log}
                                                                                ▼  window.__kkaeum.{onSignals (1 Hz), onSpeech, onSdkTrace, onGleo?}
MainActivity ─ VehicleGateway (Vehicle SDK 2.3.2: capabilities + setters)
             ─ SignalCollector (Vehicle SDK reads/listeners + CarPropertySource [speed, gear, parking brake, outside temp])
             ─ NaviGateway (NaviHelper 3.0.5)   ─ LocationGateway (FusedLocation 1.1.3)
             ─ VoiceGateway (bundled mp3 / TextToSpeech 3.3.1 / SpeechToText 3.3.1)
GleoReceiver (assets/schema.json, 4 functions) ─▶ window.__kkaeum.onGleo ─▶ APP_ACTION_RESPONSE broadcast (≤ 7 s)
```

| Item | Value |
|---|---|
| Package | `com.carvalue.app` |
| SDK levels | minSdk 28 (Pleos requirement), targetSdk 34, compileSdk 34, `useLibrary("android.car")` |
| Toolchain | JDK 17, Gradle 8.9 (wrapper), AGP 8.7.3, Kotlin 2.0.21 |
| Pleos SDKs | Vehicle 2.3.2, NaviHelper 3.0.5, TextToSpeech 3.3.1, SpeechToText 3.3.1, FusedLocation 1.1.3 |

## 1. One-time setup (this machine)

The main disk is nearly full, so every cache lives on `/Volumes/Transcend`:

```bash
source /Volumes/Transcend/devtools/env.sh   # JAVA_HOME, ANDROID_HOME, GRADLE_USER_HOME, ANDROID_USER_HOME, TMPDIR
```

Installing the Android SDK packages requires **you** to read and accept the SDK licenses:

```bash
sdkmanager --licenses                                   # review, then accept
sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools"
```

`gradle.properties` sets `android.builder.sdkDownload=false`, so Gradle never fetches SDK packages by itself.

## 2. Build

```bash
cd ../web && npm ci && npm run build        # produces web/dist (vite config must use base: './')
cd ../android
./gradlew assembleDebug                      # copyWebDist runs automatically before preBuild
./gradlew assembleRelease                    # signed with kkaeum-release.jks → ../apk/KKAEUM_kkaeum_release.apk
./gradlew assembleRelease -PapkBaseName=KKAEUM_깨움   # contest name: <팀명>_<앱이름>_release.apk
```

- `copyWebDist` copies `../web/dist` into `app/src/main/assets/web` (git-ignored). When `dist` is missing it
  logs a warning, keeps whatever is already there, and does not fail. If the bundle is absent the app shows a
  "UI bundle missing" page.
- Release signing reads `keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`).
  Both that file and `kkaeum-release.jks` were generated locally and are git-ignored. **Back them up**: Pleos
  requires the same signing lineage for every update. Without the file, release builds fall back to the debug
  key and Gradle prints a warning.
- Optional TTS/STT credentials (Pleos Playground › My Project) enable `HYBRID` speech. Without them speech runs
  `ON_DEVICE`, which needs no registration. Pass them with `-PpleosClientId=… -PpleosClientSecret=…` or in
  `$GRADLE_USER_HOME/gradle.properties`. Do not commit them.
- Ambient colour encoding is undocumented. The default sends packed `0xRRGGBB`. Use `-PambientColorMode=preset`
  to send the Virtual Console preset index instead (Cyan 0, Blue 1, Purple 2, White 3). See §5 to calibrate.

## 3. Pleos Connect Emulator

1. Android Studio › SDK Manager › **SDK Update Sites** › **+**. Name it `Pleos Connect System Image` and use this URL:
   - macOS (Apple Silicon): `https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-arm64-sys-img.xml`
   - Windows/Linux: `https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-sys-img.xml`
2. SDK Platforms › API 34 › *Show Package Details* › tick **Pleos Connect system image**.
3. Device Manager › Create › **Automotive** › *Pleos Connect v2.1.0*. Under Advanced, choose **Cold boot**
   (Quick boot breaks the VHAL), 4 GB RAM, and API 34 "Pleos Connect v2.1.0 APIs".
4. To use STT, enable the host microphone under Extended Controls › Microphone.

Install and run:

```bash
adb install -d -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.carvalue.app/.MainActivity
adb logcat -s KkaeumSdk KkaeumWeb          # SDK trace + (debug) web console
adb shell am force-stop com.carvalue.app
adb exec-out screencap -p > shot.png
```

The first launch asks for microphone, `pleos.car.permission.FUSED_LOCATION` and
`android.car.permission.CAR_SPEED`. All three are runtime (dangerous) permissions.

### Virtual Console (vehicle signal simulator)

```bash
adb forward tcp:8088 tcp:8088
open http://127.0.0.1:8088/
```

| Card | Drives |
|---|---|
| Motion › Gear P/R/N/D | `gear`. Power-nap actions (seat recline) are refused unless the gear is P. |
| Motion › Steering angle −540..540° | `steeringActivity` (σ of the angle over the last 60 s) |
| ADAS › Cruise state | `cruiseOn` |
| Convenience › Turn signal | `turnSignalEvents` |
| Convenience › Seat occupancy | `occupants` |
| Convenience › Ambient brightness/colour, Window position | read-back of the `ambient` / `window` actions |
| Safety › Telltales › **DRIVER_ATTENTION** On/Blink | `dawWarning` (polled via `Safety.getTelltalesInfo` every 2 s) |
| Climate › Recirculation, fan, target temp, seat vent | read-back of HVAC actions |

The Virtual Console has **no speed card**, so `speedKph` stays 0 in the emulator.

### Driving state (UX restrictions)

```bash
adb shell cmd hmg_car_service --service drivingstate driving_regulation on    # simulate driving
adb shell cmd hmg_car_service --service drivingstate driving_regulation off   # parked
```

The activity is declared `distractionOptimized`, so it stays usable while driving. Vehicle calls may still
fail with `ERROR_DRIVING_RESTRICTED`; that failure appears in the SDK trace.

### Form factors

The app sets no `screenOrientation`, declares `resizeableActivity`, and handles resize via `configChanges`, so the
WebView and the fatigue engine survive window changes. Test portrait (1 window, 840×1184 dp on 17") and
landscape (2 windows) with **FormFactorConsole** (see the Pleos emulator guide: host-display-bridge on ports
8095/8096). CCP/hardware Back at the top level calls `moveTaskToBack(true)`.

## 4. Gleo Interface

`app/src/main/assets/schema.json` declares 3 `service` functions: `GET_ALERTNESS_STATUS`, `ADD_REST_STOP`
(`kind`: REST_AREA | DROWSY_SHELTER) and `START_POWER_NAP` (`minutes`). Gleo reads schemas at boot and on
install. Integration activates only after Pleos approves the schema.

`GleoReceiver` forwards `{functionName, params}` to `window.__kkaeum.onGleo?.(json)`. If the web handler
**synchronously** returns `{status: 'success'|'asking'|'fail', message: '<English sentence>', data?, mode?}`,
that object becomes the reply. Otherwise a safe `fail` reply is sent. Either way the reply goes out as the
`ai.pleos.playground.intent.action.APP_ACTION_RESPONSE` broadcast within 5.5 s (Gleo's limit is 7 s).
Use `mode: 'silent'` when the app speaks the answer itself.

Simulate a Gleo call:

```bash
adb shell am broadcast -n com.carvalue.app/.gleo.GleoReceiver -a ADD_REST_STOP --es ACTION_PARAM '{"kind":"DROWSY_SHELTER"}'
```

## 5. SDK trace

Every real SDK call produces one line in logcat (`KkaeumSdk`) and in the UI via `window.__kkaeum.onSdkTrace`, e.g.

```
HVAC.checkHvacRecirculationCapabilities → OK (READ_WRITE [SeatArea(ROW_1_LEFT)])
HVAC.setHvacRecirculation(SeatArea(ROW_1_LEFT), false) → OK
Light.setAmbientLightBrightnessColor(SeatArea(ROW_1_LEFT), 3994312 [#3CF2C8=0x3CF2C8]) → FAILED ERROR_SECURITY_PERMISSION
```

Periodic reads are traced only on their first success or first failure.

To calibrate the ambient colour: pick a preset in the Virtual Console, restart the app, and read the
`Light.getAmbientLightBrightnessColor … raw=… hex=…` line.

## 6. Permissions and App Market approval

| Permission | Used for | Approval |
|---|---|---|
| `pleos.car.permission.CAR_CLIMATE`, `CAR_SEATS`, `CAR_LIGHTS`, `CAR_WINDOWS`, `CAR_DRIVE`, `CAR_SAFETY` | reads, capability checks; also the ambient-light **setters** (annotated `CAR_LIGHTS`) | Vehicle *State* SDK: usable without applying. The review guide still says every Vehicle SDK permission must be pre-agreed with Pleos App Market. |
| `pleos.car.permission.CONTROL_CAR_CLIMATE` | recirculation / temperature / fan | **App Market pre-approval** ("Vehicle Control SDK: Coming Soon") |
| `pleos.car.permission.CONTROL_CAR_SEATS` | seat ventilation, backrest jog | **App Market pre-approval** |
| `pleos.car.permission.CONTROL_CAR_LIGHTS` | `setAmbientColorAutoByDriveModeEnabled(false)` | **App Market pre-approval** |
| `pleos.car.permission.CONTROL_CAR_WINDOWS` | window position | **App Market pre-approval** |
| `pleos.car.permission.NAVI_ROUTE`, `NAVI_ROUTE_SEARCH` | destination info, `addWaypoint` | NaviHelper: available without applying |
| `pleos.car.permission.TTS_SERVICE`, `STT_SERVICE` | speech | My Project lists TTS/STT as "Coming Soon" |
| `pleos.car.permission.FUSED_LOCATION` (runtime) | position / heading | My Project lists it as "Coming Soon". The store also needs a location-terms URL. |
| `android.car.permission.CAR_SPEED` (runtime), `CAR_POWERTRAIN`, `CAR_EXTERIOR_ENVIRONMENT` | speed, gear, parking brake, outside temp (AAOS) | Standard AAOS; verify they are granted to 3rd parties on the target build |
| `RECORD_AUDIO`, `INTERNET` | STT, map tiles | standard |

Every control path checks its capability first and handles `onFailed`. Without approval the app still runs:
`act()` returns `false` or the trace shows `FAILED ERROR_SECURITY_PERMISSION`, and the web engine falls back
to voice advice.

**Before submission:** remove any `CONTROL_CAR_*` permission that App Market has not approved. Declaring an
unapproved permission fails review.

## 7. Security notes (Pleos security guide)

- Release builds are not debuggable, and WebView remote debugging is on only when `BuildConfig.DEBUG`.
- The WebView has file and content access off, `allow*FromFileURLs` off, mixed content never allowed, and no popups.
  Navigation is limited to `https://appassets.androidplatform.net`. Page permission requests (mic/camera) are denied.
- Cleartext traffic is disabled (`network_security_config.xml`).
- The JS bridge only answers when the top-level page is our own origin.
- Backups and device transfer are disabled. Location never appears in logs or traces, and web console logs are debug-only.
