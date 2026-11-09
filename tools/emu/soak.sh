#!/bin/zsh
# Long-run check of the release APK on the emulator: every 2 minutes run the demo scenarios through the in-app
# menu (heavy rain / clear / rain forecast) and the Gleo functions; log the app pid, ANRs and crashes.
#   tools/emu/soak.sh <minutes>
source /Volumes/Transcend/devtools/env.sh
MIN=${1:-40}
PKG=com.carvalue.app
tap_menu() { adb shell input tap 2452 156; sleep 2; adb shell input tap 2222 $1; }
adb logcat -c
start=$(date +%s)
pid0=$(adb shell pidof $PKG | tr -d '\r')
echo "start pid=$pid0"
n=0
while [ $(( $(date +%s) - start )) -lt $(( MIN * 60 )) ]; do
  n=$((n + 1))
  adb shell am start --user 10 -n $PKG/.MainActivity >/dev/null 2>&1
  tap_menu 509; sleep 25    # 호우경보 발령
  tap_menu 593; sleep 10    # 특보 해제
  tap_menu 425; sleep 20    # 30분 뒤 비 예보
  tap_menu 593; sleep 5
  for f in GET_PARKING_RISK GET_CAR_VALUE GET_BATTERY_HEALTH; do adb shell am broadcast --user 10 -a $f -n $PKG/.gleo.GleoReceiver >/dev/null; sleep 3; done
  pid=$(adb shell pidof $PKG | tr -d '\r')
  anr=$(adb logcat -d | grep -c "ANR in $PKG")
  fatal=$(adb logcat -d | grep -c "FATAL EXCEPTION")
  ok=$(adb logcat -d -s CvSdk | grep -c "APP_ACTION_RESPONSE")
  echo "cycle $n t=$(( ($(date +%s) - start) / 60 ))m pid=$pid anr=$anr fatal=$fatal gleo_ok=$ok"
  sleep 30
done
echo SOAK_DONE
