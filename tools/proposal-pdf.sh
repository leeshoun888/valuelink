#!/bin/bash
# docx → PDF (Microsoft Word, via ~/Documents because Word cannot reach the SSD) → page PNGs for review.
# Usage: tools/proposal-pdf.sh [out.pdf]
set -e
K=/Volumes/Transcend/공모전_현대자동차/carvalue
T=~/Documents/jegap_tmp
mkdir -p $T
rm -f $T/p.pdf
cp "$K/docs/밸류링크_ValueLink_접수양식_기획서.docx" $T/p.docx
osascript <<OSA
tell application "Microsoft Word"
  open (POSIX file "$T/p.docx")
  delay 4
  save as active document file name "$T/p.pdf" file format format PDF
  close active document saving no
end tell
OSA
OUT=${1:-/Volumes/Transcend/devtools/tmp/proposal.pdf}
cp $T/p.pdf "$OUT"
python3 - "$OUT" <<'PY'
import sys, os, pymupdf
d = pymupdf.open(sys.argv[1])
o = '/Volumes/Transcend/devtools/tmp/pdfp'
os.makedirs(o, exist_ok=True)
for f in os.listdir(o): os.remove(os.path.join(o, f))
for i in range(d.page_count):
    d[i].get_pixmap(dpi=70).save(f'{o}/p{i+1:02d}.png')
print('pages', d.page_count)
PY
