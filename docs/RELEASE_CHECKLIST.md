# Release checklist: before sharing InsightIQ with a customer

InsightIQ is a **local, single-user** application. This list says what must be true before you put it in front of a customer, and what you must **not** claim about it. If an item cannot be ticked, say so to the customer instead of working around it.

## A. Must be true before sharing

**Safety of the data (yours and theirs)**
- [ ] You ran `sh scripts/release_check.sh` and it printed `RELEASE SCAN: OK`. (Run it before every push to GitHub. It never touches your real folder.)
- [ ] `.env` is not in the repository; only `.env.example` (placeholders, no key) is.
- [ ] The live data volume, `data/`, `.backups/`, models, predictions and saved answers are not in the repository.
- [ ] You made a fresh backup of the real workspace before any upgrade (`python3 backend/scripts/backup_workspace.py ...`, see [OPERATIONS.md](OPERATIONS.md)), verified it, and keep a **copy of the newest backup on another device**.
- [ ] The customer's data is on a computer only the customer (or you, with permission) can use. There is no login: the screen lock and the operating-system account are the only protection.
- [ ] The customer knows that, with an AI provider configured, their questions, column names, definitions and some result values are sent to that provider, and that nothing is masked. They have seen [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) ("Live AI calls: exactly what is sent").
- [ ] If no provider is configured, you told them plainly that Ask does not work until one is.

**Correctness of what you show**
- [ ] The full test pass on the exact code you are sharing is green and recorded (latest: STAGE7_REVIEW.md (removed)).
- [ ] You ran the [5-minute demo script](DEMO_WALKTHROUGH.md) on throwaway data, not on the customer's data, and every "You should see" line matched.
- [ ] Money and percentages are shown only for columns the customer confirmed. Do the confirmation with them; do not accept the suggestion for them.
- [ ] Every number you quote from the app was checked with **Show details, How this was calculated** (or the PDF appendix) at least once with the customer.
- [ ] Rule 3 areas (SQL guard, sandbox worker, Evaluation scoring and comparator, currency arithmetic and rate provenance, AutoML training and registry, editor save mechanics) are byte-identical to the last approved snapshot.

**Environment**
- [ ] Docker (or the local Python and Node versions in the README) runs the app on `127.0.0.1` only. The compose file binds ports 8000 and 8080 to loopback; do not change that.
- [ ] Uploads fit the limits (5 MiB, 20,000 rows, 100 columns). Excel files are exported to CSV first.

## B. What must NOT be claimed

Do not say, write or imply any of the following, in conversation, slides, the README, the PDF or the app:

| Do not claim | Why / what is true |
|---|---|
| "Secure", "private", "protected", "confidential" | There is no login and no encryption of data at rest. Anyone using the computer can open everything. |
| "Each client / company / user has their own data" or "multi-tenant" | Projects are a view filter for one person. They are not access control. There are no company or employee accounts. |
| "Admin tools are restricted / hidden for security" | The Admin switch is a browser preference. It hides pages from the owner's menu; it does not stop anyone. |
| "Accurate", "reliable", "X% accurate", "better than an analyst" | No general accuracy is measured or claimed. The Accuracy check covers a small fictional 45-question benchmark. Prediction scores are measured on held-out rows of that dataset only. |
| "The AI understands your business" | The AI writes SQL from column names and your definitions; you check the result. It can be wrong. |
| "Masks / anonymises / redacts your data before sending it to the AI" | There is no masking or PII redaction. |
| "Complete audit trail" or "who changed what" | Dataset change history lists some recorded dataset events, for the active project only, with no identity. |
| "Real-time" or "connects to your database / ERP / Shopify" | CSV upload only. |
| "Hosted", "cloud", "SaaS", "scales to many users" | Local, single-user. Hosting would need authentication, authorisation, HTTPS and more (see [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)). |
| "Predictions will hold in the future" | Scores describe held-out past rows. A warning can miss leakage, and a strong predictor can trigger it. |
| "Backups are automatic and safe" | Automatic copies before upgrades sit in the same volume. The Backup info page cannot see your folders. You must keep an external copy. |
| "Business uplift", "saves X hours" | Nothing was measured. No real first-time user has been timed. |

## C. Things to say out loud

1. "This runs on your computer for one person. There is no login."
2. "Every answer shows how it was calculated. Please check the first few with me."
3. "If we turn on the AI provider, your questions and some values go to them."
4. "I will make a backup before every change, and you should keep a copy somewhere else."

## D. Known limits to disclose if asked

- Mobile Lighthouse performance on Home and Dashboards is below 95 (simulated slow network; see the Stage 7 review).
- The Admin area, accuracy check and benchmark are developer tools.
- The leakage warning, the type suggestions and the AI drafts are aids, not verdicts.
