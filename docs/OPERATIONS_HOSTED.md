# Hosted operations runbook (Accounts stage A5, option C: one stack per company)

For the person who runs the server. Plain steps, what each script does, and what it cannot do.
Everything here uses free tools: Docker Compose, Caddy, nginx, restic, OpenSSL, and the shell.

**Status, said plainly.** The package was built and tested on one computer with Caddy's own test certificate authority. It was **not** run on a real server and **no real certificate** (Let's Encrypt) was issued, because that needs a public domain name. Backups go to a **local** restic repository; copying them to another machine is your step (section 5) and was **not** exercised. Nothing here is a statement that a company's data is protected: the wording rules in `ACCOUNTS_PLAN.md` section 10 still apply, and the independent review (A8) has not happened.

## 1. What one company's stack is

Three containers per company, started by `deploy/compose.yaml`, each company under its own Compose project name `iq-<name>`:

| Container | Job | Published | User |
|---|---|---|---|
| `caddy` | front door: HTTPS, redirect from HTTP, response headers, routes `/api/*` to the app and everything else to the front-end | **ports 80 and 443 only** | non-root (65532) |
| `web` | nginx serving the built front-end files | nothing (internal network) | non-root (101) |
| `api` | the application, with `APP_ENV=production` and `AUTH_MODE=on` | nothing (internal network) | non-root (the operator's uid) |

Per company: its own data volume `iq-<name>_data`, its own `caddy_data` (certificates) and `caddy_config` volumes, its own internal network (no route out, nothing on it is published), and its own folder `deploy/companies/<name>/` holding `company.env` (settings, nothing secret), `secrets/` (mode 700) and `backups/` (the restic repository). Nothing is shared between companies. The development app at the project root (`compose.yaml`, ports 8000 and 8080) is a different thing and is never touched by these scripts.

Hardening on every container: read-only root file system, all Linux capabilities dropped, `no-new-privileges`, memory, CPU and process limits, health checks, restart unless stopped. What may be written: the `api` writes `/data` (its volume) and `/tmp` (512 MB of memory-backed space, which also holds the matplotlib cache and working files); `caddy` writes its two volumes and `/tmp`; `web` writes only `/tmp`. Nothing else is writable, and the app and the browser test suite both run normally like this. The app's Python bytecode is not cached (it is off by design on a read-only file system).

## 2. What you need

A Linux host (a Mac works for trials) with Docker and Docker Compose v2, `openssl`, `sh`, `python3` (only for the local test). A public domain name pointing at the host, with ports 80 and 443 open from the internet, for the real certificate. Disk for the data volume and for backups.

Build the images once (or after changing the code): `deploy/scripts/build-images.sh [tag]`. It tags `insightiq-hosted-api` and `insightiq-hosted-web` only.

## 3. Provision a company

```
deploy/scripts/provision-company.sh --name acme --host acme.example.com --owner-email owner@acme.example --owner-name "A. Owner"
```

It does, in order: creates `deploy/companies/acme/` with `secrets/` (mode 700); generates `totp_key` (a random Fernet key) and `restic_password` with OpenSSL, writes them with mode 400 and prints neither; writes `company.env`; creates the company's volumes and network; gives each volume to the user that will use it; starts the stack; waits for it to be healthy; then asks you, **at the terminal**, to type the first owner's password twice (it is never an argument, a file or an environment value). It then prints where the company is running and what to do next.

Then, by hand:

1. **Copy `secrets/totp_key` and `secrets/restic_password` to your offline store now** (a password manager, or printed and locked away). See section 7 for what happens without them. Neither is inside the backups.
2. The owner opens `https://acme.example.com`, signs in with the password you typed, is asked to choose a new one, and must set up two-step sign-in (and save the eight recovery codes it shows once).
3. Schedule backups (section 5) and run **one restore drill** (section 6) before relying on them.

Options for trying it on one computer: `--local` uses `Caddyfile.local` (Caddy's own test CA, no HSTS), `--http-port` and `--https-port` use other host ports. `--skip-owner` is for automation only.

It refuses to overwrite an existing company, picks a free internal subnet by itself, and never touches another company.

## 4. Settings the app insists on

The `api` container will **refuse to start** (exit code 2 and a plain message) unless all of these hold: `APP_ENV=production`; `AUTH_MODE=on`; `AUTH_COOKIE_SECURE=true`; owners must use two-step sign-in; `AUTH_ALLOWED_ORIGINS` names the exact public `https://` address (the proxy's Host header is never trusted for the origin check); `AUTH_TOTP_KEY_FILE` points at a readable file holding a valid key (`AUTH_TOTP_KEY` as an environment value is refused in production); `AUTH_TRUSTED_PROXIES` names the proxy (not `0.0.0.0/0`). The compose file sets these from `company.env` and the secret file, and stops if `PUBLIC_ORIGIN`, `CADDY_IP` or `INTERNAL_SUBNET` is missing.

The per-address sign-in limit uses the real client address: `X-Forwarded-For` is read only when the connection comes from the configured proxy (Caddy's fixed internal address), and then the right-most address that is not itself a proxy is used. Caddy faces the internet and replaces any `X-Forwarded-For` it receives. **If you put another proxy or load balancer in front of Caddy**, Caddy would see that device's address for everyone and the limit would treat all people as one: configure Caddy's `trusted_proxies` for that device first. That setup was not built or tested.

## 5. Backups (restic, encrypted)

```
deploy/scripts/backup-company.sh --name acme
```

What it does: pauses the `api` container (a few seconds on a small workspace, always resumed, even on failure), reads the data volume read-only in a throw-away restic container with no network, writes an encrypted snapshot to `deploy/companies/acme/backups/repo` using `secrets/restic_password`, resumes the app, applies retention (7 daily, 4 weekly, 6 monthly), and runs `restic check`. The backup holds **the data volume only**; the TOTP key is not in it (checked by the test run by searching every restored file).

**Schedule it** with the units in `deploy/systemd/` (`iq-backup@.service`, `iq-backup@.timer`; copy to `/etc/systemd/system/`, fix the path, `systemctl enable --now iq-backup@acme.timer`) or a cron line: `30 2 * * * /opt/insightiq/deploy/scripts/backup-company.sh --name acme >> /var/log/iq-backup-acme.log 2>&1`. **The scheduler itself was not exercised in the A5 build** (the script was; the unit files are checked only for content). **Monitoring:** a failed run exits non-zero; with systemd use `OnFailure=` to alert you, and check now and then that `restic snapshots` shows a snapshot from the last day or two.

**Off-site copy (your step, not exercised).** A backup on the same machine does not survive losing the machine. Copy the repository elsewhere with restic itself, for example `restic -r /repo copy --from-repo ...` to a second repository on another machine or a storage service you hold the credentials for; the repository stays encrypted with its own password. Until you do this, do not describe the backups as off-site.

## 6. Restore, and the restore drill

Restore into an empty volume:

```
deploy/scripts/restore-company.sh --name acme [--snapshot latest]
```

The app is stopped first. If the data volume holds files the script refuses, unless you add `--wipe`: then it takes one more backup, empties the volume and restores. It does not touch secrets or certificates. Start the stack again afterwards (`docker compose --project-name iq-acme --env-file deploy/companies/acme/company.env -f deploy/compose.yaml up -d`).

The drill proves the whole chain:

```
deploy/scripts/restore-drill.sh --name acme
```

It stops the app, fingerprints every file and the catalog's content (SHA-256 hashes only), backs up, **destroys the data volume**, creates a new empty one, restores, fingerprints again, compares, starts the app and waits for it to be healthy. It prints PASSED only if every file and the catalog content are identical. It means downtime of a minute or two and rebuilds the volume: run it on a test company or in a quiet moment. The A5 run did this on a test company; the numbers are in `docs/ACCOUNTS_A5_REVIEW.md`.

## 7. If a key is lost

* **`totp_key` lost.** The owners' two-step secrets in the catalog cannot be decrypted. The app will not start in hosted mode without a key file. Make a new key (`openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n' > secrets/totp_key`, mode 400), restart, and for **each owner** run `docker compose ... exec api python /app/scripts/accounts_cli.py reset-2fa --data-dir /data --email owner@... --backup <folder>`; they enrol again at next sign-in. Until then, no owner can sign in. Analysts and viewers are not affected.
* **`restic_password` lost.** The backups cannot be opened. There is no recovery. Create a new password and a new repository (move the old one aside) and take a fresh backup at once.
* **Both inside the same place as the data.** Do not keep the offline copies on the same disk as the company's folder.

## 8. Rotate a secret

* **`restic_password`:** `restic key add` (new password), test a restore, then `restic key remove` the old one. Replace `secrets/restic_password` and the offline copy.
* **`totp_key`:** the application has no tool to re-encrypt existing second-step secrets, so rotating it means the same steps as losing it: new key, restart, `reset-2fa` for each owner, they enrol again. Do it in a quiet moment and tell the owners first.
* **A person's password:** the owner creates a one-time link from the People page; the operator can do it from the terminal with `accounts_cli.py reset-link`.

## 9. Update

```
deploy/scripts/update.sh --name acme [--tag 1.2.0] [--build]
```

It prints the current image tags, **backs up first and stops if that fails**, then pulls the images named in `company.env` (or builds this source tree with `--build`), restarts the stack and waits for it to be healthy. To go back, put the old tag in `company.env` (or run the script with `--tag <old>`) after checking the data still opens; the backup taken just before the update is the safety net. Schema changes are additive and make their own backup first, but a rollback after a schema change means restoring the pre-update backup.

## 10. Delete a company

```
deploy/scripts/delete-company.sh --name acme
```

You must type the company name. It removes the containers, the networks, **all volumes** of that company (data, certificates, caddy config) and the folder holding its secrets, backups repository and settings, then prints exactly what it removed. It does **not** remove: your offline copies of the keys, any backup copy you made elsewhere, the images and build cache, logs kept by Docker or the system, DNS records, firewall rules, or certificates already issued (those are public records). Irreversible.

## 11. What each script cannot do

| Script | Cannot |
|---|---|
| `build-images.sh` | publish images anywhere; it builds locally. |
| `provision-company.sh` | request a certificate for a name that does not point at this host; install a firewall; set up DNS; create a second owner (use the People page). |
| `backup-company.sh` | copy off the machine; alert you; restore. |
| `restore-company.sh` | restore into a non-empty volume without `--wipe`; restore secrets (they are not in the backup). |
| `restore-drill.sh` | run without downtime. |
| `update.sh` | roll the data back after a schema change; update the operating system or Docker. |
| `delete-company.sh` | remove copies you made elsewhere or anything outside this folder and Docker. |

## 12. Response headers and the front door

Caddy adds, once, on every answer: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, a `Content-Security-Policy` with `frame-ancestors 'none'` and no inline or eval script (the same policy in both Caddyfiles, proven against the real app by the browser suite run through the proxy), and a `Permissions-Policy`. `Strict-Transport-Security` is in `deploy/Caddyfile` (the real-HTTPS configuration) and deliberately **not** in `Caddyfile.local`. HTTP is redirected to HTTPS with the path kept. HTTP/3 is off (only TCP 80 and 443 are published). Uploads are limited to 6 MB at the proxy.

## 13. Not done in A5 (so nothing here may be claimed)

Real certificates and a real server; `testssl.sh` or any outside scan; an off-site backup copy and a restore from it; the backup scheduler running by itself; per-company AI settings (A6); the two-company isolation suite across all routes and the independent review (A7, A8); disk encryption of the host; monitoring and incident procedures beyond what is written here.
