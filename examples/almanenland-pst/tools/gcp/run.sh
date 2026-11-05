#!/bin/bash
# Run tools/pst_scenarios.py on a GCP spot VM (no SSH needed: code in, results out through a bucket).
# Usage: GRIDLAB=/path/to/gridlab BUCKET=gs://my-pst-bucket ZONE=europe-west4-c tools/gcp/run.sh
# Afterwards: gcloud storage cp "$BUCKET/out/*" results/ ; delete the VM and the bucket.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
: "${GRIDLAB:?path of a GridLab checkout}" "${BUCKET:?gs://bucket}"
ZONE=${ZONE:-europe-west4-c}; NAME=${NAME:-gl-pst-scen}; MACHINE=${MACHINE:-c2d-standard-32}
gcloud storage buckets create "$BUCKET" --location "${ZONE%-*}" --uniform-bucket-level-access
SA=$(gcloud iam service-accounts list --format='value(email)' --filter='email~compute@developer')
gcloud storage buckets add-iam-policy-binding "$BUCKET" --member "serviceAccount:$SA" --role roles/storage.objectAdmin >/dev/null
git -C "$GRIDLAB" archive --format=tar.gz -o /tmp/gridlab.tar.gz HEAD
gcloud storage cp /tmp/gridlab.tar.gz "$HERE/../pst_scenarios.py" "$BUCKET/"
gcloud compute instances create "$NAME" --zone "$ZONE" --machine-type "$MACHINE" --provisioning-model SPOT \
  --instance-termination-action DELETE --max-run-duration 4h --image-family ubuntu-2404-lts-amd64 \
  --image-project ubuntu-os-cloud --boot-disk-size 30GB --scopes cloud-platform \
  --metadata "gl-bucket=$BUCKET,gl-workers=30" --metadata-from-file "startup-script=$HERE/startup.sh"
echo "follow: gcloud storage cat $BUCKET/log.txt ; done when $BUCKET/out/done.txt exists"
