#!/bin/sh
# Release scan. Copies this project to a THROWAWAY folder, runs `git init` and `git add -A` there (never in
# the real folder), then reports what a push would contain and scans it for secrets and personal paths.
# Usage: sh scripts/release_check.sh        (exit code 1 if anything sensitive is found)
set -e
src=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
rsync -a --exclude '/.backups' --exclude '/.venv' --exclude 'node_modules' --exclude '/data' "$src/" "$tmp/p/"
cd "$tmp/p"
# Sentinels prove the ignore rules work even though the big folders were not copied.
mkdir -p .backups/x node_modules/y data && echo x > .backups/x/catalog.sqlite && echo x > node_modules/y/i.js && echo x > data/a.duckdb && echo KEY=x > .env.sentinel
git init -q && git add -A
git ls-files -z | tr "\\0" "\\n" | grep -v "^scripts/release_check.sh$" | tr "\\n" "\\0" > "$tmp/list"
echo "Tracked files: $(git ls-files | wc -l | tr -d ' ')"
xargs -0 stat -f %z < "$tmp/list" 2>/dev/null | awk '{s+=$1} END{printf "Tracked size: %.1f MB\n", s/1048576}' || true
echo "Ten largest tracked files:"
xargs -0 ls -l < "$tmp/list" | sort -k5 -n -r | head -10 | awk '{printf "  %.1f MB  %s\n",$5/1048576,$9}'
bad=0
for f in .backups/x/catalog.sqlite node_modules/y/i.js data/a.duckdb .env.sentinel .env; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then echo "TRACKED (should be ignored): $f"; bad=1; fi
done
scan() { label=$1; shift; hits=$(xargs -0 grep -I -l -E "$@" < "$tmp/list" 2>/dev/null || true); if [ -n "$hits" ]; then echo "FOUND [$label]:"; echo "$hits" | head -10 | sed 's/^/  /'; bad=1; else echo "clean [$label]"; fi; }
scan "API keys and tokens" '(sk-[A-Za-z0-9]{24,}|gsk_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|Bearer [A-Za-z0-9._-]{25,})'
scan "key/token/secret/password with a value" '(API_KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Za-z_]*[ ]*[:=][ ]*["'"'"']?[A-Za-z0-9._/+-]{12,}'
scan "absolute home paths" '/Users/[A-Za-z0-9._-]+|/home/[A-Za-z0-9._-]+/'
scan "personal email addresses" '[A-Za-z0-9._-]+@(gmail|outlook|hotmail|yahoo|icloud)\.com'
scan "real workspace dataset files (<uuid>.duckdb)" '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.duckdb'
[ $bad -eq 0 ] && echo "RELEASE SCAN: OK" || echo "RELEASE SCAN: ISSUES FOUND (see above)"
exit $bad
