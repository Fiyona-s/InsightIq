# Restore InsightIQ from the two keep archives

Archives (next to the project folder, checksums in `InsightIQ_FINAL_keep.sha256`):

- `InsightIQ_FINAL_keep_code.zip`: the app source and text documents. No `.env`, no data, no `node_modules`, no `.venv`, no build output.
- `InsightIQ_FINAL_keep_data.zip`: your workspace data. `live-export-20261123/` is the workspace after the P7 upgrade; `backup-pre-upgrade-20261123/` is the verified copy from just before it.

Check the files first: `shasum -a 256 -c InsightIQ_FINAL_keep.sha256`.

1. **Unzip.** `unzip InsightIQ_FINAL_keep_code.zip -d InsightIQ` and `unzip InsightIQ_FINAL_keep_data.zip -d InsightIQ_data` (outside the project folder).
2. **Install.** Install Docker. In `InsightIQ`, copy `.env.example` to `.env` and put your own AI settings in it (no key is stored in either archive). Then `docker compose build`. For development without Docker: `python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt` and `cd frontend && npm ci`.
3. **Copy the data into an empty volume.** The volume name is the folder name plus `_insightiq-data` (the real one is `project_insightiq-data`, so name the folder `project` or adjust the name below). Never copy into a volume that already holds data you want to keep.
   ```sh
   docker volume create project_insightiq-data
   docker run --rm -v project_insightiq-data:/data -v "$PWD/../InsightIQ_data/live-export-20261123":/src:ro --entrypoint sh project-api:latest -c 'cp -a /src/. /data/'
   ```
   To return to the state before the P7 upgrade instead, use `backup-pre-upgrade-20261123` in place of `live-export-20261123`.
4. **Start.** `docker compose up -d`, then open http://localhost:8080. Login is off by default. Do not run `docker compose down -v`: it deletes the volume.
5. **Check.** `sh docs/baseline/check.sh` compares the volume with `docs/baseline/baseline-2026-11-23.json`. After restoring the live export (tested in a throwaway volume on 2026-11-23) it prints `CHANGED: catalog_file_sha256, backup_dirs` and nothing else. Both are expected: the export re-writes the catalog file (same rows: the row-level hash, counts, schema versions, dashboards and every dataset and model file are identical), and the app's own internal `backups/` folder is not in the export. Any other key in that line means the restore is wrong. The pre-upgrade backup is expected to differ more: it is at schema version 13, the baseline at 17.
