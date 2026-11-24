#!/bin/sh
# Local test harness only (called by provision-company.sh through IQ_PREPARE_HOOK, before the stack starts): fills a NEW company
# volume with the browser-test users, a dataset and a pinned dashboard, using the same prepare script as the local hosted suite,
# inside a one-shot container of the real image with every production setting. Needs IQ_COMPOSE_EXTRA (deploy/tests/compose.test.yaml).
. "$(dirname "$0")/../scripts/lib.sh"
load_company "$1"
OWNERS_DIR=${IQ_OWNERS_DIR:?set IQ_OWNERS_DIR to a folder for the test owners file}
mkdir -p "$OWNERS_DIR"
compose run --rm --no-deps -T -e HOSTED_E2E_DIR=/data -e HOSTED_E2E_KEEP_DIR=1 -e "HOSTED_E2E_ORIGIN=$PUBLIC_ORIGIN" \
  -e HOSTED_E2E_OWNERS_FILE=/owners/e2e_owners.json -v "$OWNERS_DIR:/owners" api python /app/tests/hosted_e2e_prepare.py > /dev/null
