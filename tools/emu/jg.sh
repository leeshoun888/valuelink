#!/bin/bash
# ValueLink scenario steps on the Pleos Connect emulator through the Virtual Console (keep its page open:
# the VC accepts writes only while emulator_active). adb forward tcp:8088 tcp:8088 first.
#   jg.sh odo 24812          odometer km
#   jg.sh soc 62             state of charge
#   jg.sh plug 100           open the charge port, switch charging on, charge limit 100 % (guard should cap to 80)
#   jg.sh unplug
#   jg.sh rain               front window 40 % open + wipers Low (guard should close the windows while parked)
#   jg.sh dry
#   jg.sh lights             low beam on in P (guard should switch them off after 60 s)
#   jg.sh lamp TPMS On|Off   telltale (guard: suggestion + navi search "블루핸즈")
#   jg.sh gear P|D
#   jg.sh show               charge limit / current / windows / headlamp / wipers as the VC sees them
VC=http://127.0.0.1:8088
put() { curl -s -X PUT "$VC$1"; echo; }
case "$1" in
  odo) put "/vehicle/odometer?traveled_distance_km=$2" ;;
  soc) put "/vehicle/ev-battery?field=soc&value=$2" ;;
  plug)
    put "/vehicle/ev-battery?field=percent_limit&value=${2:-100}"
    put "/vehicle/ev-battery?field=charge_port_open&value=true"
    put "/vehicle/ev-battery?field=charge_switch&value=true" ;;
  unplug)
    put "/vehicle/ev-battery?field=charge_switch&value=false"
    put "/vehicle/ev-battery?field=charge_port_open&value=false" ;;
  rain) put "/vehicle/body?window_fl=40&front_wiper=Low" ;;
  dry) put "/vehicle/body?front_wiper=Off" ;;
  lights) put "/vehicle/lights?feature=headlamp_mode&value=LowBeam" ;;
  lamp) put "/vehicle/telltales/simulator?type=$2&state=${3:-On}&color=Red" ;;
  gear) case "$2" in P) g=Park ;; D) g=Drive ;; R) g=Reverse ;; *) g=Neutral ;; esac; put "/vehicle/gear?gear=$g" ;;
  show)
    curl -s "$VC/vehicle/state" | python3 -c "
import json,sys
d=json.load(sys.stdin); e=d['ev_battery']; b=d['body']
print('active', d['controls'].get('emulator_active'), '| limit', e['charge_limit_pct'], 'current', e['maximum_current_a'], 'switch', e['charging_activated'], 'soc', e['state_of_charge'])
print('windows', b['windows'], '| wipers', b['wipers']['front']['mode'], '| headlamp', d['lights']['headlamp_mode'], '| locks', b['door_locks']['all'])" ;;
  *) echo "usage: jg.sh odo|soc|plug|unplug|rain|dry|lights|lamp|gear|show" >&2; exit 2 ;;
esac
