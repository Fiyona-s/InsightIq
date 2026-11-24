#!/bin/sh
# Builds the two hosted images from this source tree. Usage: deploy/scripts/build-images.sh [TAG]   (default tag: local)
# It tags only insightiq-hosted-api and insightiq-hosted-web. It never touches the development images (project-api, project-web)
# or any running container.
. "$(dirname "$0")/lib.sh"
TAG=${1:-local}
ROOT=$(cd "$DEPLOY/.." && pwd)
docker build -f "$DEPLOY/api.Dockerfile" -t "insightiq-hosted-api:$TAG" "$ROOT/backend"
docker build -f "$DEPLOY/web/Dockerfile" --build-context "hosted=$DEPLOY/web" -t "insightiq-hosted-web:$TAG" "$ROOT/frontend"
echo "built insightiq-hosted-api:$TAG and insightiq-hosted-web:$TAG"
