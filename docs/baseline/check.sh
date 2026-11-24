#!/bin/sh
# Read-only comparison of the real workspace with the newest recorded baseline (baseline-2026-11-23.json, recorded 2026-11-23 after the P7 upgrade: registry 1-17, eight new empty account tables). Older baselines are kept unedited.
# It never writes to the volume and never starts or stops the app. (CLAUDE.md rule 1 now reads: back up before
# any change to the real workspace; this script is a comparison, not an upgrade.)
#  - Docker running: FULL read-only check. A throwaway container (--read-only, --network none, volume :ro)
#    runs probe.py and compares everything with baseline-2026-11-23.json. For a consistent read, stop the app
#    first (docker compose stop); a running app may be writing. A "CHANGED" result is expected after normal
#    use of the app; record a new baseline when that is intended.
#  - Docker not running: proxy check. The Docker VM disk image is unchanged since the last record
#    (docker-disk-2026-11-21.json), so the volume inside it cannot have changed. This script does not start Docker.
set -e
here=$(cd "$(dirname "$0")" && pwd)
disk="$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"
if docker info >/dev/null 2>&1; then
  out=$(mktemp)
  docker run --rm --network none --read-only \
    -v project_insightiq-data:/data:ro -v "$here/probe.py:/probe.py:ro" \
    --entrypoint python project-api:latest /probe.py > "$out"
  python3 -I - "$here/baseline-2026-11-23.json" "$out" <<'PY'
import json, sys
a, b = (json.load(open(p)) for p in sys.argv[1:3])
diff = [k for k in a if a[k] != b.get(k)]
print('UNCHANGED (full read-only check)' if not diff else 'CHANGED: ' + ', '.join(diff))
sys.exit(1 if diff else 0)
PY
  exit $?
fi
python3 -I - "$disk" "$here/docker-disk-2026-11-21.json" <<'PY'
import json, os, sys
disk, record = sys.argv[1], json.load(open(sys.argv[2]))
if not os.path.exists(disk):
    print("CANNOT VERIFY: Docker VM disk image not found"); sys.exit(2)
st = os.stat(disk)
if (st.st_mtime_ns, st.st_size, st.st_ino) == (record["mtime_ns"], record["size"], record["inode"]):
    print("UNCHANGED (proxy): Docker VM disk untouched since", record["mtime_utc"]); sys.exit(0)
print("DOCKER DISK CHANGED since", record["mtime_utc"], "- Docker has run. Open Docker and rerun this script for a full read-only check.")
sys.exit(1)
PY
