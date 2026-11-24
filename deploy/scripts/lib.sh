#!/bin/sh
# Shared helpers for the hosted-package scripts (Accounts A5). Sourced, not run. Prints no secret.
set -eu
DEPLOY=$(cd "$(dirname "$0")/.." && pwd)
COMPANIES=${IQ_COMPANIES_DIR:-$DEPLOY/companies}

die() { echo "error: $*" >&2; exit 1; }

valid_name() { printf '%s' "$1" | grep -Eq '^[a-z0-9][a-z0-9-]{1,29}$'; }

# load_company NAME: sets DIR, ENVFILE, PROJECT and the company's non-secret settings
load_company() {
  NAME=$1; valid_name "$NAME" || die "company name must be 2-30 characters: lower-case letters, digits, hyphens"
  DIR=$COMPANIES/$NAME; ENVFILE=$DIR/company.env
  [ -f "$ENVFILE" ] || die "no company called $NAME (looked for $ENVFILE)"
  PROJECT=iq-$NAME
  set -a; . "$ENVFILE"; set +a
}

# compose ARGS...: docker compose for the loaded company (extra -f files may be given through IQ_COMPOSE_EXTRA)
compose() {
  if [ -n "${IQ_COMPOSE_EXTRA:-}" ]; then
    docker compose --progress plain --project-name "$PROJECT" --env-file "$ENVFILE" -f "$DEPLOY/compose.yaml" -f "$IQ_COMPOSE_EXTRA" "$@"
  else
    docker compose --progress plain --project-name "$PROJECT" --env-file "$ENVFILE" -f "$DEPLOY/compose.yaml" "$@"
  fi
}

DATA_VOLUME() { printf '%s_data' "$PROJECT"; }

wait_healthy() {  # wait_healthy SERVICE SECONDS
  end=$(( $(date +%s) + $2 ))
  while :; do
    id=$(compose ps -q "$1" 2>/dev/null || true)
    st=$( [ -n "$id" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo none)
    [ "$st" = healthy ] && return 0
    [ "$(date +%s)" -ge "$end" ] && die "$1 did not become healthy in $2 seconds (status: $st). See: docker compose logs"
    sleep 2
  done
}
