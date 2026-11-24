# Why the original dashboard hash changed (eb491ae3… → 1d1bca19…)

Collected 2026-11-15, read-only: local backup files, file timestamps, and the stopped app containers' Docker logs (`docker logs`, which does not start a container). Raw logs are in this folder.

## Timeline (UTC)

| Time | Event | Source |
|---|---|---|
| 2026-11-09 → 2026-11-11 | Dashboard `bae47ed5…` payload SHA-256 **eb491ae351a0…** in all 77 catalog copies under `.backups/` (Phase 1B to Phase 9) | Hash of `dashboards.payload` in each backup |
| 2026-11-11 to 2026-11-14 | Product Stages 1–12: logical catalog digest `df364c61…` identical in every preservation record, so the dashboard was unchanged | `docs/product-stage*/preservation*.json` |
| 2026-11-14 02:55:11 | Stage 12 final preservation check written (unchanged) | file mtime `docs/product-stage12/preservation.json` |
| 2026-11-14 03:06:01 | Analyst run created (first of 3 new runs) | catalog `analyst_runs.created_at`. **No log line**: the API container was recreated at 03:09:09 and its earlier logs are gone. |
| 2026-11-14 03:08:12 | `.env` edited | file mtime |
| 2026-11-14 03:09:09 | Original API container (re)started | Docker log |
| 2026-11-14 03:09:35 | Browser opens localhost:8080 (VS Code Electron browser) | web container log |
| 2026-11-14 03:10:10, 03:11:08 | `POST /api/analyst/runs` ×2 | Docker log timestamps |
| 2026-11-14 03:11:27 | `POST /api/saved-charts` ("Total recognized revenue"), `POST /api/dashboards/bae47ed5…/charts` | Docker log |
| 2026-11-14 03:11:51 | `PUT /api/dashboards/bae47ed5…` | Docker log |
| 2026-11-14 03:12:26 | `POST …/widgets/85bcc7a0…/refresh`; catalog `dashboards.updated_at` = 03:12:25.959904, audit `dashboard_refresh` (actor `user_ui`) | Docker log + catalog |
| 2026-11-14 03:18:08 | AutoML predict attempt, rejected 422 (no write) | Docker log |
| 2026-11-14 03:36:37 | Web container shut down | Docker log |
| 2026-11-15 06:49:49 | **This session's first file** | scratchpad file mtime |
| 2026-11-15 07:26:58 → 08:21:29 | Original containers accidentally running (my Docker start); **0 writes** in this period | Docker log; see STAGE1_REVIEW §3 |
| 2026-11-15 | Baseline recorded: payload **1d1bca19…**, 21 runs, 102 files | `docs/BASELINE.md` |

## Conclusion

- The last write to dashboard `bae47ed5…` is `POST …/refresh` at **2026-11-14 03:12:26 UTC**, preceded by `PUT` at 03:11:51. That's more than 27 hours before this session's first file. The Docker log since the container's 03:09:09 start contains no later write of any kind.
- **What I can show:** the payload was eb491ae3… in every backup up to 2026-11-11; the dashboard was written through the UI on 2026-11-14 03:11–03:12; nothing has written to it since.
- **What I cannot show:** a copy of the payload taken between 03:12 on Nov 14 and this session, so the value 1d1bca19… itself is first *recorded* by my read-only baseline on 2026-11-15. Also, the 03:06:01 run has only its catalog timestamp as evidence, because the container logs before 03:09:09 no longer exist.
- The "97 files / 18 runs" figures are older than this change: product Stage 1 onward already recorded 102 files (6 experiments, 19 models). The 18 → 21 runs change is the three Nov 14 runs above.
