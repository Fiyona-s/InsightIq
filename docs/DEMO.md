# Three-minute InsightIQ demo

Use disposable data and the controlled provider, not the original workspace. The provider boundary is a test fixture; DuckDB, guards, persistence, local models and UI operations are real. FX fixture quotes are synthetic, not market rates.

## Preparation

In separate terminals from the repository root:

```sh
.venv/bin/uvicorn tests.e2e_server:app --app-dir backend --host 127.0.0.1 --port 8003
```

```sh
cd frontend
API_PROXY_TARGET=http://127.0.0.1:8003 npm run dev -- --port 5176 --strictPort
```

This test-server module creates a new temporary workspace and uses `httpx.MockTransport`; it is excluded from the production image. Open http://127.0.0.1:5176. Use `fixtures/final-demo.csv`. Do not point the demo at ports 8080/8000 or original storage. Prepare a saved result/dashboard and a temporary trained model if the live walkthrough must fit exactly three minutes; actual training/provider latency is not fixed.

## Script

| Time | Action and narration |
|---|---|
| 0:00–0:30 | Upload the synthetic CSV. Open Schema and Data preview quality details. Edit one cell, confirm/save, then show the new revision. “Raw strings, stable row IDs and earlier revisions are retained; restore creates another revision.” |
| 0:30–1:00 | Open Knowledge base. Show the sharing notice, draft definitions and approve an item. “Drafting shares schema statistics, not sample rows. Helpful feedback does not verify SQL.” Show Single value versus advanced typed reference entry on a prepared candidate. |
| 1:00–1:35 | Ask for total revenue after reviewing types. Show actual SQL, result and computed evidence, mark Helpful and pin to a prepared dashboard. “SQL runs through the guard and a read-only sandbox. Model output is not trusted merely because it executes.” |
| 1:35–2:00 | Refresh a temporary widget explicitly, show prior snapshot and confirmed-currency display. Switch display currency and open raw JSON/formatted PDF. “Refresh uses saved SQL without new model calls; display conversion never rewrites financial values.” |
| 2:00–2:30 | Show the AutoML wizard and a prepared regression model's measured test metric and matching-scope validation baseline. Predict once. “Training is local with 0 LLM calls; these metrics do not establish future business benefit.” Show an unconfirmed unit label if the stored configuration has one. |
| 2:30–3:00 | Show Offline Evaluation, separate missing predictions and comparable-run rules. Archive the temporary dataset, then inspect dependencies/typed delete confirmation and retained deleted-source labels. “Historical results and model artifacts are retained; this remains a local, single-user application.” |

For the automated complete flow, including actual local training and two saved-prediction replays:

```sh
cd frontend
npx playwright test --config playwright.smoke.config.ts
```

That smoke starts its own clean workspace on 8002/5175, uses controlled AI/FX fixtures, checks zero console/page errors and writes [evidence](phase9/smoke-evidence.json). It does not measure live provider accuracy or real-world FX prices.

## Resume-ready summary

Built a local analytics application with React/TypeScript and FastAPI, combining inspectable AI-generated SQL with SQLGlot validation, isolated read-only DuckDB execution, dataset-scoped FAISS retrieval and a bounded LangGraph workflow. Implemented dependency-aware dataset lifecycle operations, immutable forward-only gzip snapshots, independently checked knowledge examples, dashboard refresh/history and provenance-preserving currency presentation. Added a local scikit-learn AutoML workflow and offline benchmark replay with explicit unscored cases and valid run comparison. Validated with unit/integration/browser regression suites, a clean-workspace end-to-end smoke and axe/responsive checks.

Use the final review for exact test counts and measured compression results. Do not add business uplift, general answer-accuracy percentages, public multi-tenant deployment or masking claims.
