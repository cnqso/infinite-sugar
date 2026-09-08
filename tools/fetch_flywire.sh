#!/usr/bin/env bash
# Fetch the FlyWire Codex FAFB v783 dumps that tools/build_brain.py consumes.
# Public GCS bucket, no auth. ~55 MB total. Raw dumps are gitignored; derived files are committed.
set -euo pipefail
cd "$(dirname "$0")/../data/raw"
B=https://storage.googleapis.com/flywire-data/codex/data/fafb/783
for f in consolidated_cell_types.csv.gz classification.csv.gz coordinates.csv.gz connections.csv.gz; do
  if [ -s "$f" ]; then echo "have $f"; else echo "-> $f"; curl -fsSL -O "$B/$f"; fi
done
ls -la
