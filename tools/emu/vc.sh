#!/bin/bash
# Drives the Pleos Connect Virtual Console (adb forward tcp:8088 tcp:8088) from the shell.
#   vc.sh gear D              Park/Reverse/Neutral/Drive (P/R/N/D)
#   vc.sh speed 100           km/h (holds accelerator so the VC physics keeps it)
#   vc.sh hvac power_on=1 fan=3 recirc_on=0 driver_temp=21.5
#   vc.sh state [jq-ish key]  dump /vehicle/state (optionally one top-level key)
set -e
VC=http://127.0.0.1:8088
case "$1" in
  gear)
    case "$2" in P) g=Park ;; R) g=Reverse ;; N) g=Neutral ;; D) g=Drive ;; *) g=$2 ;; esac
    curl -s -X PUT "$VC/vehicle/gear?gear=$g" ;;
  speed)
    curl -s -X PUT "$VC/vehicle/controls?speed=$2&accelerator=${3:-20}&brake=0" ;;
  hvac)
    shift; q=$(IFS='&'; echo "$*")
    curl -s -X PUT "$VC/vehicle/hvac?$q" ;;
  body)
    shift; q=$(IFS='&'; echo "$*")
    curl -s -X PUT "$VC/vehicle/body?$q" ;;
  state)
    if [ -n "$2" ]; then
      curl -s "$VC/vehicle/state" | python3 -c "import json,sys;print(json.dumps(json.load(sys.stdin).get('$2'),ensure_ascii=False,indent=1))"
    else
      curl -s "$VC/vehicle/state"
    fi ;;
  *) echo "usage: vc.sh gear|speed|hvac|body|state ..." >&2; exit 2 ;;
esac
echo
