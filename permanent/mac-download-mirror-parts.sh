#!/bin/bash
# قبل از خواب روی مک اجرا کن:
#   curl -fsSL https://raw.githubusercontent.com/erfanpis/linkyar/main/permanent/mac-download-mirror-parts.sh -o ~/Downloads/mac-download-mirror-parts.sh
#   chmod +x ~/Downloads/mac-download-mirror-parts.sh
#   ~/Downloads/mac-download-mirror-parts.sh
#
# صبر می‌کند تا ۱۰ پارت روی گیت‌هاب آماده شود، همه را دانلود می‌کند،
# mirror.rar می‌سازد، بعد مک را خاموش می‌کند.

set -euo pipefail

REPO="erfanpis/linkyar"
OUT_DIR="${HOME}/Downloads/mirror-rar-parts"
EXPECTED_PARTS=10
SHUTDOWN_WHEN_DONE=1

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"
echo "دانلود در: $OUT_DIR"
echo "منتظر ۱۰ پارت روی گیت‌هاب…"

while true; do
  count=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=50" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print(sum(1 for r in d if str(r.get("tag_name","")).startswith("keep-mirror-part") and not r.get("draft") and (r.get("assets") or [])))' \
    2>/dev/null || echo 0)
  echo "$(date '+%H:%M:%S') آماده=${count}/${EXPECTED_PARTS}"
  if [ "${count}" -ge "${EXPECTED_PARTS}" ]; then
    break
  fi
  sleep 60
done

echo "شروع دانلود همه پارت‌ها…"
python3 - <<'PY' > /tmp/mirror-urls.txt
import json, urllib.request
url = "https://api.github.com/repos/erfanpis/linkyar/releases?per_page=50"
with urllib.request.urlopen(url) as r:
    rels = json.load(r)
items = []
for rel in rels:
    tag = rel.get("tag_name") or ""
    if not tag.startswith("keep-mirror-part") or rel.get("draft"):
        continue
    for a in rel.get("assets") or []:
        u = a.get("browser_download_url")
        if u:
            items.append((tag, u))
items.sort(key=lambda x: x[0])
for _, u in items:
    print(u)
PY

i=1
total=$(wc -l < /tmp/mirror-urls.txt | tr -d ' ')
while IFS= read -r url; do
  name=$(basename "$url")
  echo "=== [$i/$total] $name ==="
  ok=0
  for attempt in 1 2 3 4 5; do
    if curl -fL --retry 8 --retry-delay 5 -C - -o "$name" "$url"; then
      ok=1
      break
    fi
    echo "قطع شد؛ تلاش مجدد $attempt …"
    sleep 15
  done
  if [ "$ok" -ne 1 ]; then
    echo "شکست: $name"
    exit 1
  fi
  i=$((i + 1))
done < /tmp/mirror-urls.txt

echo "ساخت mirror.rar …"
cat mirror.rar.part* > mirror.rar
ls -lh mirror.rar
echo "تمام شد: $OUT_DIR/mirror.rar"

if [ "$SHUTDOWN_WHEN_DONE" -eq 1 ]; then
  echo "۲ دقیقه دیگر مک خاموش می‌شود (Ctrl+C برای لغو)…"
  sleep 120
  sudo shutdown -h now
fi
