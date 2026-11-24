# Rule 8 check: duplicate chart on "Retail Sales Overview"

Read-only, against the last known state (Docker must not be started, so the volume cannot be re-read).

**Last direct read:** 2026-11-15, ~07:3x UTC, by a throwaway read-only container (`--read-only`, volume mounted `:ro`, `--network none`) running a probe that printed the dashboard's widgets:

```
dash updated 2026-11-14T03:12:25.959904+00:00 widgets 3
  w total_recognized_revenue_inr by category c57ac1e0   <- duplicate 1
  w total_recognized_revenue_inr by category c57ac1e0   <- duplicate 2 (same saved chart)
  w Total recognized revenue a4185918
```

**Why it still holds:**
1. The dashboard payload SHA-256 at that read, `1d1bca193fb2a9bea7ff079e3eb48b38a6a05a80affbf6b796ff6be3e90843a8`, is the value recorded in `docs/BASELINE.md` and `baseline-2026-11-15.json`. The full read-only re-check at ~08:48 UTC matched it (UNCHANGED).
2. The only writes ever logged against this dashboard are from 2026-11-14 03:11–03:12 UTC (`original-api-all-writes.txt`); none removed a widget.
3. Since Docker Desktop was quit (2026-11-15 09:11:23 UTC) its VM disk is untouched (`sh docs/baseline/check.sh` → UNCHANGED), so the volume and this payload cannot have changed.

**Conclusion:** both duplicate "by category" widgets (saved chart `c57ac1e0…`) still exist. No redesign code path deletes widgets automatically, and nothing has been applied to the original workspace.

## Direct re-check (2026-11-15, after Stage 2, Docker opened by the owner)

`docs/baseline/rule8_probe.py` in a throwaway read-only container (`--read-only`, `--network none`, volume `:ro`):

```
{"dashboard": "Retail Sales Overview", "widgets": 3, "duplicate_chart_ids": {"c57ac1e0-284b-4605-bb82-33f84a646652": 2},
 "widget_titles": ["total_recognized_revenue_inr by category", "total_recognized_revenue_inr by category", "Total recognized revenue"]}
```

The duplicate chart still exists (Rule 8). The full baseline check at the same time reported UNCHANGED.
