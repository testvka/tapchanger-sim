#!/bin/bash
# Startup script of the PST-scenario VM (tools/gcp/run.sh passes it as metadata "startup-script").
# Reads metadata gl-bucket (gs://...), takes gridlab.tar.gz + pst_scenarios.py from it, runs the AC load flows
# (smoke first, then everything) and writes out/ and the log back to the bucket. No SSH needed.
set -uo pipefail
exec > >(tee -a /var/log/pst.log) 2>&1
md() { curl -sf -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" || true; }
BUCKET=$(md gl-bucket)
WORKERS=$(md gl-workers); WORKERS=${WORKERS:-$(( $(nproc) - 2 ))}
APP=/opt/gridlab
export HOME=/root OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
push() { gcloud storage cp /var/log/pst.log "$BUCKET/log.txt" >/dev/null 2>&1 || true; }
echo "=== pst startup $(date -u +%FT%TZ) bucket=$BUCKET workers=$WORKERS"
if gcloud storage ls "$BUCKET/out/done.txt" >/dev/null 2>&1; then echo "already done"; push; exit 0; fi

if [ ! -x "$APP/.venv/bin/python" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q && apt-get install -y -q python3-venv python3-dev gcc
  mkdir -p "$APP"
  gcloud storage cp "$BUCKET/gridlab.tar.gz" /tmp/gridlab.tar.gz
  tar -C "$APP" -xzf /tmp/gridlab.tar.gz
  python3 -m venv "$APP/.venv"
  "$APP/.venv/bin/pip" install -q --upgrade pip
  grep -v '^pypowsybl' "$APP/requirements.txt" > /tmp/req.txt
  "$APP/.venv/bin/pip" install -q -r /tmp/req.txt -c "$APP/deploy/internet/constraints.txt"
fi
gcloud storage cp "$BUCKET/pst_scenarios.py" /opt/pst_scenarios.py
push
cd "$APP"
echo "=== smoke $(date -u +%T)"
.venv/bin/python /opt/pst_scenarios.py --gridlab "$APP" --out /opt/smoke --workers 7 --smoke
gcloud storage cp -r /opt/smoke "$BUCKET/" >/dev/null 2>&1
push
echo "=== full $(date -u +%T)"
( while sleep 120; do gcloud storage cp /opt/out/cases.jsonl "$BUCKET/out/cases.partial.jsonl" >/dev/null 2>&1; push; done ) &
.venv/bin/python /opt/pst_scenarios.py --gridlab "$APP" --out /opt/out --workers "$WORKERS"
echo "=== exit $? $(date -u +%T)"
kill %1 2>/dev/null
gzip -kf /opt/out/cases.jsonl
gcloud storage cp /opt/out/geometry.json /opt/out/summary.json /opt/out/cases.jsonl.gz "$BUCKET/out/"
date -u +%FT%TZ > /tmp/done.txt && gcloud storage cp /tmp/done.txt "$BUCKET/out/done.txt"
push
