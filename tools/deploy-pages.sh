#!/bin/zsh
# Build web/ and publish it to the gh-pages branch (https://leeshoun888.github.io/valuelink/).
set -e
source /Volumes/Transcend/devtools/env.sh
ROOT=${0:A:h:h}
cd "$ROOT/web" && npm run build
S=$(mktemp -d)
cp -R "$ROOT/web/dist/." "$S/"
find "$S/3d/renders" -name '*.png' -delete
rm -f "$S/3d/ioniq5_black.glb"
touch "$S/.nojekyll"
cd "$S" && git init -q -b gh-pages && git add -A && git commit -qm "Deploy $(git -C "$ROOT" rev-parse --short HEAD)"
git push -f https://github.com/leeshoun888/valuelink.git gh-pages
rm -rf "$S"
