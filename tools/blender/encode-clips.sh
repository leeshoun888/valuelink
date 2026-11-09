#!/bin/zsh
# Rendered clip frames (tools/blender/clips.py) -> web/public/3d/clips:
#   <clip>_<theme>.webm  VP9 with alpha (app WebView, Chromium)
#   <clip>_dark.mp4      H.264 on black (demo page fallback for Safari)
#   tools/blender/encode-clips.sh <frames_dir>
F=/Volumes/Transcend/devtools/media/bin/ffmpeg
SRC=${1:?frames dir}
DST=/Volumes/Transcend/공모전_현대자동차/carvalue/web/public/3d/clips
mkdir -p $DST
for d in $SRC/*_(light|dark)(/N); do
  n=${d:t}
  ls $d/[0-9]*.png >/dev/null 2>&1 || continue
  $F -y -loglevel error -framerate 24 -i $d/%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 -row-mt 1 -auto-alt-ref 0 $DST/$n.webm
  if [[ $n == *_dark ]]; then
    $F -y -loglevel error -framerate 24 -i $d/%04d.png -filter_complex "color=black:r=24[bg];[bg][0:v]scale2ref[bg2][v];[bg2][v]overlay=shortest=1,format=yuv420p" -c:v libx264 -crf 20 -preset slow -movflags +faststart $DST/$n.mp4
  fi
  echo "encoded $n"
done
ls -la $DST
