#!/bin/sh
# Provision ONE company's hosted stack (Accounts A5).
#   deploy/scripts/provision-company.sh --name acme --host acme.example.com --owner-email owner@acme.example [--owner-name "A. Owner"]
# Options for trying it on one computer:  --local (Caddy's own test CA, Caddyfile.local)  --http-port 8081 --https-port 8443  --skip-owner
# What it does: creates deploy/companies/NAME/ with secrets/ (mode 700; totp_key and restic_password, mode 400, generated here,
# never printed), writes company.env (settings that are not secret), creates the company's own volumes and network, starts the stack,
# and creates the first owner through accounts_cli.py with the password TYPED at this terminal (twice). It prints no secret.
# It never touches another company, the development app or its volume.
. "$(dirname "$0")/lib.sh"
umask 077
NAME= HOST= OWNER_EMAIL= OWNER_NAME= LOCAL=0 HTTP_PORT=80 HTTPS_PORT=443 SKIP_OWNER=0 SUBNET=
while [ $# -gt 0 ]; do
  case $1 in
    --name) NAME=$2; shift 2;; --host) HOST=$2; shift 2;; --owner-email) OWNER_EMAIL=$2; shift 2;; --owner-name) OWNER_NAME=$2; shift 2;;
    --local) LOCAL=1; shift;; --http-port) HTTP_PORT=$2; shift 2;; --https-port) HTTPS_PORT=$2; shift 2;;
    --subnet) SUBNET=$2; shift 2;; --skip-owner) SKIP_OWNER=1; shift;;
    *) die "unknown option $1";;
  esac
done
valid_name "${NAME:-}" || die "--name is required: 2-30 characters, lower-case letters, digits, hyphens"
[ -n "$HOST" ] || die "--host is required (the public name people will type, for example acme.example.com)"
printf '%s' "$HOST" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' || die "--host must be a plain host name"
[ "$SKIP_OWNER" = 1 ] || [ -n "$OWNER_EMAIL" ] || die "--owner-email is required (or --skip-owner)"
[ "$LOCAL" = 1 ] || { [ "$HTTP_PORT" = 80 ] && [ "$HTTPS_PORT" = 443 ] || die "custom ports are only for --local trials"; }
DIR=$COMPANIES/$NAME
[ ! -e "$DIR" ] || die "$DIR already exists; refusing to overwrite a company"
docker image inspect insightiq-hosted-api:${IQ_TAG:-local} >/dev/null 2>&1 || die "build the images first: deploy/scripts/build-images.sh"

# a subnet no other company or Docker network uses
if [ -z "$SUBNET" ]; then
  used=$( (cat "$COMPANIES"/*/company.env 2>/dev/null | sed -n 's/^INTERNAL_SUBNET=//p'; docker network ls -q | xargs docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null) | tr ' ' '\n')
  n=10; while [ $n -lt 250 ]; do c=172.29.$n.0/24; echo "$used" | grep -qx "$c" || { SUBNET=$c; break; }; n=$((n+1)); done
  [ -n "$SUBNET" ] || die "no free subnet found; pass --subnet"
fi
BASE=${SUBNET%.0/24}
printf '%s' "$SUBNET" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.0/24$' || die "--subnet must look like 172.29.10.0/24"

mkdir -p "$DIR/secrets" "$DIR/backups"; chmod 700 "$DIR" "$DIR/secrets" "$DIR/backups"
# secrets: generated here, written with mode 400, never printed
openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n' > "$DIR/secrets/totp_key"          # a Fernet key: 32 random bytes, url-safe base64
openssl rand -base64 36 | tr -d '\n' > "$DIR/secrets/restic_password"
chmod 400 "$DIR/secrets/totp_key" "$DIR/secrets/restic_password"
if [ "$LOCAL" = 1 ]; then CADDYFILE=./Caddyfile.local; else CADDYFILE=./Caddyfile; fi
if [ "$HTTPS_PORT" = 443 ]; then SUFFIX=; else SUFFIX=":$HTTPS_PORT"; fi
cat > "$DIR/company.env" <<ENVEOF
# Settings for company $NAME. Nothing secret lives here (secrets are the files in secrets/).
COMPANY=$NAME
PUBLIC_HOST=$HOST
PUBLIC_PORT_SUFFIX=$SUFFIX
PUBLIC_ORIGIN=https://$HOST$SUFFIX
HTTP_PORT=$HTTP_PORT
HTTPS_PORT=$HTTPS_PORT
INTERNAL_SUBNET=$SUBNET
INTERNAL_RANGE=$BASE.128/25
CADDY_IP=$BASE.2
APP_UID=$(id -u)
APP_GID=$(id -g)
API_IMAGE=insightiq-hosted-api:${IQ_TAG:-local}
WEB_IMAGE=insightiq-hosted-web:${IQ_TAG:-local}
CADDYFILE=$CADDYFILE
COMPANY_DIR=$DIR
ENVEOF
chmod 600 "$DIR/company.env"
echo "created $DIR (secrets/ holds totp_key and restic_password; not shown)"

load_company "$NAME"
compose create >/dev/null
# the company's volumes start root-owned: give each to the user that will use it (and to nobody else)
docker run --rm --user 0:0 --network none --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --security-opt no-new-privileges -v "$(DATA_VOLUME):/v" alpine:latest chown -R "$APP_UID:$APP_GID" /v
for v in caddy_data caddy_config; do
  docker run --rm --user 0:0 --network none --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --security-opt no-new-privileges -v "${PROJECT}_$v:/v" alpine:latest chown -R 65532:65532 /v
done
if [ -n "${IQ_PREPARE_HOOK:-}" ]; then "$IQ_PREPARE_HOOK" "$NAME"; fi      # used by the local test harness only
compose up -d
wait_healthy api 90
wait_healthy caddy 60
if [ "$SKIP_OWNER" = 0 ]; then
  [ -t 0 ] || die "creating the owner needs a terminal (the password is typed, never passed). Re-run the owner step: deploy/scripts/provision-company.sh was left running; use:  docker compose exec api python /app/scripts/accounts_cli.py create-company ..."
  echo "Creating the first owner. You will be asked to type the password twice. It is not shown, stored in a file or passed as an argument."
  compose exec api python /app/scripts/accounts_cli.py create-company --data-dir /data --name "$NAME" --owner-email "$OWNER_EMAIL" ${OWNER_NAME:+--owner-name "$OWNER_NAME"}
fi
cat <<MSG

Company $NAME is running at https://$HOST$SUFFIX
Next, by hand:
  1. Copy secrets/totp_key and secrets/restic_password to your OFFLINE store now (see docs/OPERATIONS_HOSTED.md). Without totp_key
     enrolled owners cannot sign in; without restic_password the backups cannot be opened. Neither is inside the backups.
  2. The owner signs in, chooses a new password and sets up two-step sign-in.
  3. Schedule backups (deploy/systemd/ or cron) and run one restore drill before relying on them.
MSG
