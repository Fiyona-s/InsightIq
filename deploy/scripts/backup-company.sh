#!/bin/sh
# Encrypted backup of ONE company with restic (free). Usage: deploy/scripts/backup-company.sh --name acme [--stopped]
# The repository is per company (deploy/companies/NAME/backups/repo); its password is secrets/restic_password. The backup holds the
# company's data volume ONLY. The TOTP key (secrets/totp_key) is never in it: keep that offline copy somewhere else.
# While the copy runs the app container is paused (a few seconds on a small workspace) so the catalog is consistent; it is always
# resumed. With --stopped the app is assumed to be stopped already (used by the restore drill). Retention: 7 daily, 4 weekly, 6 monthly.
. "$(dirname "$0")/lib.sh"
NAME= STOPPED=0
while [ $# -gt 0 ]; do case $1 in --name) NAME=$2; shift 2;; --stopped) STOPPED=1; shift;; *) die "unknown option $1";; esac; done
load_company "${NAME:-}"
RESTIC=restic/restic:0.20.0
REPO=$DIR/backups/repo; mkdir -p "$REPO"
restic() {  # restic ARGS...  (read-only data volume, no network, nothing but the repository writable)
  docker run --rm --user "$APP_UID:$APP_GID" --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp \
    -v "$(DATA_VOLUME):/data:ro" -v "$REPO:/repo" -v "$DIR/secrets/restic_password:/run/restic_password:ro" \
    -e RESTIC_CACHE_DIR=/tmp/cache "$RESTIC" -r /repo --password-file /run/restic_password "$@"
}
if [ ! -f "$REPO/config" ]; then restic init >/dev/null; echo "initialised the repository for $NAME"; fi
api_id=$(compose ps -q api 2>/dev/null || true); paused=0
if [ "$STOPPED" = 0 ] && [ -n "$api_id" ] && [ "$(docker inspect -f '{{.State.Running}}' "$api_id")" = true ]; then
  docker pause "$api_id" >/dev/null; paused=1
  trap '[ "$paused" = 1 ] && docker unpause "$api_id" >/dev/null 2>&1' EXIT INT TERM
fi
restic backup /data --tag "company=$NAME" --host "$NAME" --quiet
if [ "$paused" = 1 ]; then docker unpause "$api_id" >/dev/null; paused=0; fi
restic forget --host "$NAME" --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune --quiet
restic check --quiet
echo "backup of $NAME finished and checked; snapshots now:"; restic snapshots --compact | tail -n +1
