#!/bin/bash
# Rebuilds web + debug APK, reinstalls on the emulator, grants runtime permissions, relaunches,
# and re-forwards WebView devtools to :9222.
set -e
source /Volumes/Transcend/devtools/env.sh
K=/Volumes/Transcend/공모전_현대자동차/carvalue
(cd $K/web && npm run build >/dev/null)
(cd $K/android && ./gradlew --no-daemon -q assembleDebug > $TMPDIR/gradle.log 2>&1) || { grep -E "^e: " $TMPDIR/gradle.log; exit 1; }
adb install -r -g $K/android/app/build/outputs/apk/debug/app-debug.apk | tail -1
for p in pleos.car.permission.FUSED_LOCATION android.permission.RECORD_AUDIO android.car.permission.CAR_SPEED android.car.permission.CAR_ENERGY; do adb shell pm grant --user 10 com.carvalue.app $p 2>/dev/null || true; done
adb shell am force-stop com.carvalue.app
adb shell am start -n com.carvalue.app/.MainActivity >/dev/null
sleep ${1:-7}
PID=$(adb shell pidof com.carvalue.app | tr -d '\r')
adb forward --remove tcp:9222 2>/dev/null || true
adb forward tcp:9222 localabstract:webview_devtools_remote_$PID >/dev/null
echo "relaunched pid=$PID"
