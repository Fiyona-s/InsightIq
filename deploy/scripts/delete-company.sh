#!/bin/sh
# Delete ONE company's hosted stack and everything this package stored for it (Accounts A5). Irreversible.
#   deploy/scripts/delete-company.sh --name acme          (you are asked to type the company name to confirm)
#   deploy/scripts/delete-company.sh --name acme --yes-delete-everything     (for automation, e.g. the local tests)
. "$(dirname "$0")/lib.sh"
NAME= YES=0
while [ $# -gt 0 ]; do
  case $1 in --name) NAME=$2; shift 2;; --yes-delete-everything) YES=1; shift;; *) die "unknown option $1";; esac
done
load_company "${NAME:-}"
if [ "$YES" != 1 ]; then
  echo "This deletes company $NAME: its containers, network, data volume (all datasets, answers, people, sessions, audit records),"
  echo "certificates volume, secrets, backups repository and settings. It cannot be undone."
  printf 'Type the company name (%s) to confirm: ' "$NAME"; read answer
  [ "$answer" = "$NAME" ] || die "not confirmed; nothing was deleted"
fi
# remove through compose first (containers, networks, ALL volumes of this project), then the files
compose down --volumes --remove-orphans
REMOVED_V=$(docker volume ls -q --filter "name=^${PROJECT}_" | wc -l | tr -d ' ')
[ "$REMOVED_V" = 0 ] || die "volumes of $PROJECT are still present; stopping before deleting the secrets"
rm -rf "$DIR/backups" "$DIR/secrets" "$ENVFILE"; rmdir "$DIR" 2>/dev/null || true
cat <<MSG
Deleted for company $NAME:
  - containers, the internal and edge networks and ALL volumes of project $PROJECT (data, caddy_data with its certificates, caddy_config)
  - $DIR/secrets (totp_key, restic_password), $DIR/backups (the restic repository and every snapshot in it), $DIR/company.env
NOT removed (you must handle these yourself if they exist):
  - copies of totp_key or restic_password you stored offline, and any backup copy you made OUTSIDE this folder (another disk, a remote restic repository)
  - the built images (insightiq-hosted-*), Docker's build cache, and logs kept by Docker or your system
  - DNS records, firewall rules, and certificates already issued by a public authority (those are public records)
  - other companies; nothing of theirs was touched
MSG
