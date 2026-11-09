#!/bin/bash
# Overnight: silver (light scenes) and black (dark scenes) builds → glbs for the app, Cycles stills and a
# turntable for the landing page.
source /Volumes/Transcend/devtools/env.sh
B=/Volumes/Transcend/.toolkit/blender/Blender.app/Contents/MacOS/Blender
K=/Volumes/Transcend/공모전_현대자동차/carvalue
G=$TMPDIR/blender
OUT=$K/web/public/3d/renders
mkdir -p $OUT
$B -b --python $K/tools/blender/build.py -- $G/ioniq5.json $G/out 2048 '#c3c6cb' 2>&1 | grep -E "EXPORTED|Error"
$B -b --python $K/tools/blender/build.py -- $G/ioniq5.json $G/out_black 2048 '#141518' 2>&1 | grep -E "EXPORTED|Error"
cp $G/out/ioniq5.glb $K/web/public/3d/ioniq5.glb
cp $G/out_black/ioniq5.glb $K/web/public/3d/ioniq5_black.glb
for s in hero_light side_light; do
  $B -b $G/out/car.blend --python $K/tools/blender/render.py -- $OUT $s 2560 1440 ${SAMPLES:-1024} 2>&1 | grep -E "RENDERED|Error"
done
for s in hero_dark rear_dark xray_dark; do
  $B -b $G/out_black/car.blend --python $K/tools/blender/render.py -- $OUT $s 2560 1440 ${SAMPLES:-1024} 2>&1 | grep -E "RENDERED|Error"
done
$B -b $G/out_black/car.blend --python $K/tools/blender/render.py -- $G/turn turntable_dark 1600 900 ${TURN_SAMPLES:-384} 2>&1 | grep -E "RENDERED|Error"
echo ALL_DONE
