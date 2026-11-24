#!/bin/sh
# Update ONE company to a new image. Usage: deploy/scripts/update.sh --name acme [--tag TAG] [--build]
# Backs up first and stops if the backup fails. Then pulls the images named in company.env (or, with --build, builds this source
# tree under TAG), restarts the stack and waits for it to be healthy. The previous image tags are printed so you can go back by
# editing company.env and running this script again with the old tag. It never touches another company.
. "$(dirname "$0")/lib.sh"
NAME= TAG= BUILD=0
while [ $# -gt 0 ]; do case $1 in --name) NAME=$2; shift 2;; --tag) TAG=$2; shift 2;; --build) BUILD=1; shift;; *) die "unknown option $1";; esac; done
load_company "${NAME:-}"
echo "previous images: API_IMAGE=$API_IMAGE WEB_IMAGE=$WEB_IMAGE"
"$DEPLOY/scripts/backup-company.sh" --name "$NAME" || die "backup failed; nothing was changed"
if [ -n "$TAG" ]; then
  sed -i.bak -E "s#^(API_IMAGE=.*):[^:]*\$#\\1:$TAG#; s#^(WEB_IMAGE=.*):[^:]*\$#\\1:$TAG#" "$ENVFILE" && rm -f "$ENVFILE.bak"
  load_company "$NAME"
fi
if [ "$BUILD" = 1 ]; then "$DEPLOY/scripts/build-images.sh" "${TAG:-local}"; else compose pull api web; fi
compose up -d
wait_healthy api 90; wait_healthy caddy 60
echo "updated $NAME: now API_IMAGE=$API_IMAGE WEB_IMAGE=$WEB_IMAGE"
