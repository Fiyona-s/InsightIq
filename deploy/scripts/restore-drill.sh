#!/bin/sh
# RESTORE DRILL for ONE company (Accounts A5): proves a backup can really bring the data back, byte for byte.
#   deploy/scripts/restore-drill.sh --name acme
# Steps: stop the app; fingerprint the data volume (every file's hash and a hash of the catalog's content); back up with restic;
# DESTROY the data volume; create a new empty one; restore; fingerprint again; compare; start the app and check it answers.
# It changes the company's data volume (it is destroyed and rebuilt from the backup) and downtime lasts a minute or two:
# run it on a test company, or in a quiet moment. It prints hashes only, never data or secrets.
. "$(dirname "$0")/lib.sh"
NAME=
while [ $# -gt 0 ]; do case $1 in --name) NAME=$2; shift 2;; *) die "unknown option $1";; esac; done
load_company "${NAME:-}"
fingerprint() {
  docker run --rm --user "$APP_UID:$APP_GID" --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp \
    -v "$(DATA_VOLUME):/data:ro" -v "$DEPLOY/scripts/volume_fingerprint.py:/fp.py:ro" --entrypoint python "$API_IMAGE" -I /fp.py /data
}
OUT=${IQ_DRILL_OUT:-$DIR/backups}; mkdir -p "$OUT"
echo "1. stopping the app and fingerprinting the data volume"
compose stop api >/dev/null
fingerprint > "$OUT/drill-before.json"
echo "2. backing up (restic, encrypted)"
"$DEPLOY/scripts/backup-company.sh" --name "$NAME" --stopped >/dev/null
echo "3. DESTROYING the data volume $(DATA_VOLUME)"
compose rm -f -s api >/dev/null 2>&1 || true
docker volume rm "$(DATA_VOLUME)" >/dev/null
docker volume create --label "com.docker.compose.project=$PROJECT" --label "com.docker.compose.volume=data" "$(DATA_VOLUME)" >/dev/null
docker run --rm --user 0:0 --network none --cap-drop ALL --cap-add CHOWN --security-opt no-new-privileges -v "$(DATA_VOLUME):/v" alpine:latest chown "$APP_UID:$APP_GID" /v
echo "4. restoring from the backup"
"$DEPLOY/scripts/restore-company.sh" --name "$NAME" >/dev/null
echo "5. fingerprinting the restored volume"
fingerprint > "$OUT/drill-after.json"
python3 - "$OUT/drill-before.json" "$OUT/drill-after.json" <<'PY'
import json, sys
a, b = (json.load(open(p)) for p in sys.argv[1:3])
same_files = a['files'] == b['files']
same_catalog = a['catalog_content_sha256'] == b['catalog_content_sha256'] and a['catalog_content_sha256'] not in (None, 'INTEGRITY-CHECK-FAILED')
print(f"files: {a['file_count']} before, {b['file_count']} after, identical: {same_files}")
print(f"catalog content hash: {a['catalog_content_sha256'][:16]}... before, {b['catalog_content_sha256'][:16]}... after, identical: {same_catalog}")
sys.exit(0 if same_files and same_catalog else 1)
PY
echo "6. starting the app again"
compose up -d >/dev/null
wait_healthy api 90
echo "RESTORE DRILL PASSED for $NAME: the restored volume is identical to the one that was backed up."
