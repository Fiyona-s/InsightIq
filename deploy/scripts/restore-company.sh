#!/bin/sh
# Restore ONE company's data volume from its restic repository. Usage:
#   deploy/scripts/restore-company.sh --name acme [--snapshot latest] [--wipe]
# The app is stopped first. The data volume must be EMPTY (for example a freshly created one). If it holds files, the script
# refuses unless --wipe is given, in which case it takes one more backup first and then empties the volume. It does not touch
# secrets, Caddy's certificates, or any other company.
. "$(dirname "$0")/lib.sh"
NAME= SNAP=latest WIPE=0
while [ $# -gt 0 ]; do case $1 in --name) NAME=$2; shift 2;; --snapshot) SNAP=$2; shift 2;; --wipe) WIPE=1; shift;; *) die "unknown option $1";; esac; done
load_company "${NAME:-}"
RESTIC=restic/restic:0.20.0
REPO=$DIR/backups/repo; [ -f "$REPO/config" ] || die "no backup repository for $NAME"
compose stop api >/dev/null
count=$(docker run --rm --network none --read-only -v "$(DATA_VOLUME):/v:ro" alpine:latest sh -c 'ls -A /v | wc -l')
if [ "$count" != 0 ]; then
  [ "$WIPE" = 1 ] || die "the data volume is not empty ($count entries). Use --wipe to back it up once more and then empty it."
  "$DEPLOY/scripts/backup-company.sh" --name "$NAME" --stopped
  docker run --rm --user "$APP_UID:$APP_GID" --network none --read-only -v "$(DATA_VOLUME):/v" alpine:latest sh -c 'find /v -mindepth 1 -delete'
fi
docker run --rm --user "$APP_UID:$APP_GID" --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp \
  -v "$(DATA_VOLUME):/data" -v "$REPO:/repo:ro" -v "$DIR/secrets/restic_password:/run/restic_password:ro" -e RESTIC_CACHE_DIR=/tmp/cache \
  "$RESTIC" -r /repo --password-file /run/restic_password restore "$SNAP" --target / --host "$NAME" --no-lock --quiet
echo "restored snapshot $SNAP into $(DATA_VOLUME). Start the app with:  docker compose --project-name $PROJECT --env-file $ENVFILE -f $DEPLOY/compose.yaml up -d"
