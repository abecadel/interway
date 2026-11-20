#!/usr/bin/env bash
# Joins one relation that is cut between country extracts (the Vistula Lagoon between Poland and Kaliningrad)
# into a small input of its own: the relation with all its member ways and nodes, taken from every extract.
# Each country file alone cannot assemble the polygon; build with this file next to them.
#   tools/join-relation.sh 8140878 vistula-lagoon.osm.pbf filtered/poland.filtered.osm.pbf filtered/kaliningrad.filtered.osm.pbf
set -euo pipefail
rel=$1 out=$2
shift 2
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
i=0
for f in "$@"; do
  # exit status 1: some members are not in this extract, which is the point
  osmium getid -r "$f" "r$rel" -o "$tmp/$i.osm.pbf" || [ $? -eq 1 ]
  i=$((i + 1))
done
osmium merge -O "$tmp"/*.osm.pbf -o "$out"
