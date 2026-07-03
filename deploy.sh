#!/bin/bash
# Publică aplicația pe GitHub Pages. Rulare: bash deploy.sh "mesaj"
# Ștampilează versiunea (cache-busting pentru service worker) + commit + push.
set -e
cd "$(dirname "$0")"

V=$(date +%Y%m%d%H%M)
# ștampilăm versiunea în index.html și sw.js (orice ?v=... vechi + numele cache-ului)
sed -i -E "s/\?v=[A-Za-z0-9.]+/?v=$V/g" index.html sw.js
sed -i -E "s/const VERSION = '[^']*'/const VERSION = 'ezr-$V'/" sw.js

touch .nojekyll
git add -A
git commit -m "${1:-deploy $V}" || echo "(nimic de comis)"
git push origin main
echo "Publicat: versiunea $V — apare pe site în 1-2 minute."
