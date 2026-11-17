#!/usr/bin/env bash
# stream-extract.sh URL W,S,E,N OUT.osm.pbf
#
# Cut a bounding box out of a large OSM .pbf (e.g. europe-latest.osm.pbf, 35 GB) without storing it: the file
# is downloaded in 1 GB ranges (each retried on its own, so a dropped connection costs one chunk), piped into
# `osmium extract -s simple` (osmium-tool, reads its input once) and checked against URL.md5 on the way.
# Then run `interway-filter` on OUT to keep what the graph builder reads.
#
# Used for countries whose extracts are not reachable directly, e.g. the Danube countries:
#   tools/stream-extract.sh https://ftp5.gwdg.de/pub/misc/openstreetmap/download.geofabrik.de/europe-latest.osm.pbf \
#     13.4,41.2,29.9,48.7 danube.osm.pbf
set -euo pipefail
url=$1 bbox=$2 out=$3
chunk=$((1 << 30))
size=$(curl -sSfLI "$url" | tr -d '\r' | awk 'tolower($1)=="content-length:" {n=$2} END {print n}')
[ -n "$size" ] || { echo "no size for $url" >&2; exit 1; }
want=$(curl -sSfL "$url.md5" | cut -d' ' -f1 || true)
sums=$(mktemp)
trap 'rm -f "$sums"' EXIT

feed() {
  local start=0 end i
  while [ "$start" -lt "$size" ]; do
    end=$((start + chunk - 1)); [ "$end" -lt "$size" ] || end=$((size - 1))
    for i in 1 2 3 4 5 6; do
      # buffer the chunk so a failed attempt never writes half of it into the stream
      if curl -sSfL --max-time 900 -r "$start-$end" -o "$out.part" "$url" \
         && [ "$(stat -c %s "$out.part")" -eq $((end - start + 1)) ]; then break; fi
      echo "chunk at $start failed (attempt $i)" >&2; sleep $((i * 20))
      [ "$i" -lt 6 ] || { echo "giving up" >&2; return 1; }
    done
    cat "$out.part"
    echo "$((end + 1)) / $size" >&2
    start=$((end + 1))
  done
  rm -f "$out.part"
}

feed | tee >(md5sum | cut -d' ' -f1 > "$sums") \
  | osmium extract -s simple -b "$bbox" -F pbf -o "$out" --overwrite -
sleep 1
got=$(cat "$sums")
if [ -n "$want" ] && [ "$got" != "$want" ]; then echo "md5 mismatch: $got != $want" >&2; exit 1; fi
echo "extracted $bbox -> $out ($(du -h "$out" | cut -f1)), md5 ${got:-unchecked}"
