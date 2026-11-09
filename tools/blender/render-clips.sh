#!/bin/zsh
# Overnight: event clips (both themes) -> web/public/3d/clips, then the 4K stills with the rebuilt car.
# Don't run the Android emulator at the same time.
source /Volumes/Transcend/devtools/env.sh
B=/Volumes/Transcend/.toolkit/blender/Blender.app/Contents/MacOS/Blender
K=/Volumes/Transcend/공모전_현대자동차/carvalue
G=/Volumes/Transcend/devtools/tmp/blender
F=$G/clips
mkdir -p $F
for c in ${=CLIPS:-rain lights lock frost sun flood tradeup}; do
  for t in light dark; do
    s=$(date +%s)
    $B -b $G/out/car.blend --python $K/tools/blender/clips.py -- $F $c $t ${W:-1600} ${H:-900} ${SAMPLES:-96} 72 2>&1 | grep -E "CLIP_DONE|Error|Traceback"
    echo "$c $t $(( $(date +%s) - s ))s"
  done
done
$K/tools/blender/encode-clips.sh $F
if [ -z "$NO_STILLS" ]; then
  O=$G/r4k
  for s in flood_dark warning_xray charge_xray tradeup_dark passport_dark; do
    $B -b $G/out_black/car.blend --python $K/tools/blender/render.py -- $O $s 3840 2160 1024 2>&1 | grep -E "RENDERED|Error"
    sips -Z 2560 -s format jpeg -s formatOptions 90 $O/$s.png --out $K/web/public/3d/renders/$s.jpg >/dev/null
  done
fi
echo ALL_DONE
