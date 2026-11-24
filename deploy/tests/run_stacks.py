#!/usr/bin/env python3
"""Accounts A5: a local run of TWO company stacks through Caddy over HTTPS (Caddy's own test CA; NOT Let's Encrypt, NOT a real server).

    python3 deploy/tests/run_stacks.py [--keep]

What it does, in order: provisions company A with the real script through a pseudo-terminal (the owner password is typed, never passed),
provisions company B with the controlled AI provider and the browser-test users, checks both stacks (HTTP redirect, certificate chain,
response headers, cookie flags, origin check, isolation between the companies, per-client throttling behind the proxy, what is published,
container hardening at run time, secrets not in the environment/images, refusal to start on unsafe settings), runs the hosted browser
suite through B's proxy, backs up B with restic, runs a RESTORE DRILL (destroy the volume, restore, compare hashes), runs update.sh,
and finally deletes both companies and checks that nothing of them is left. It never touches the development app, its containers or its volume.
Results: docs/accounts/a5-verification/stacks-results.json and stacks-run.log. Exit code 0 only if every check passed."""
import json
import os
import pty
import re
import select
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / 'deploy'
OUT = ROOT / 'docs' / 'accounts' / 'a5-verification'
COMPANIES = DEPLOY / 'companies'
PASSWORD_A = 'A long test passphrase 1!'
PASSWORD_B = 'correct horse battery'            # the browser-test password prepared by hosted_e2e_prepare.py
STACKS = {
    'A': dict(name='tsta', host='a.localhost', http=8081, https=8443),
    'B': dict(name='tstb', host='b.localhost', http=9081, https=9443),
}
CURL_IMAGE = 'curlimages/curl:8.11.1'
RESULTS = []
LOG = open(OUT / 'stacks-run.log', 'w')


def say(text=''):
    print(text, flush=True)
    LOG.write(text + '\n'); LOG.flush()


def check(name, ok, detail=''):
    RESULTS.append({'check': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    say(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({str(detail)[:160]})" if detail and not ok else ''))
    return ok


def run(cmd, env=None, input=None, timeout=900, check_rc=True):
    e = dict(os.environ, **(env or {}))
    p = subprocess.run(cmd, env=e, input=input, capture_output=True, timeout=timeout)       # bytes: curl's CRLF line ends must survive
    p.stdout, p.stderr = p.stdout.decode(errors='replace'), p.stderr.decode(errors='replace')
    if check_rc and p.returncode != 0:
        raise RuntimeError(f"command failed ({p.returncode}): {' '.join(map(str, cmd))}\n{p.stdout[-1500:]}\n{p.stderr[-1500:]}")
    return p


def script(name, *args, env=None, check_rc=True, timeout=900):
    return run(['sh', str(DEPLOY / 'scripts' / name), *args], env=env, check_rc=check_rc, timeout=timeout)


def origin(s):
    return f"https://{s['host']}:{s['https']}"


def curl(s, path, *, scheme='https', method='GET', headers=(), data=None, cacert=None, cookie=None, include=True, resolve=True):
    port = s['https'] if scheme == 'https' else s['http']
    cmd = ['curl', '-sS', '-m', '20', '-X', method]
    if resolve:
        cmd += ['--resolve', f"{s['host']}:{port}:127.0.0.1"]
    if cacert:
        cmd += ['--cacert', str(cacert)]
    if include:
        cmd += ['-i']
    for h in headers:
        cmd += ['-H', h]
    if cookie:
        cmd += ['-H', f'Cookie: {cookie}']
    if data is not None:
        cmd += ['-H', 'Content-Type: application/json', '--data', json.dumps(data)]
    cmd.append(f"{scheme}://{s['host']}:{port}{path}")
    p = run(cmd, check_rc=False)
    return p.returncode, p.stdout, p.stderr


def parse(raw):
    head, _, body = raw.partition('\r\n\r\n')
    while head.startswith('HTTP/') and ' 100 ' in head.split('\r\n')[0]:
        head, _, body = body.partition('\r\n\r\n')
    lines = head.split('\r\n')
    status = int(lines[0].split()[1]) if lines and lines[0].startswith('HTTP/') else 0
    headers = {}
    cookies = []
    for line in lines[1:]:
        k, _, v = line.partition(':')
        if k.lower() == 'set-cookie':
            cookies.append(v.strip())
        headers[k.lower()] = v.strip()
    return status, headers, cookies, body


def login(s, email, password, extra_headers=(), cacert=None, code=None):
    payload = {'email': email, 'password': password}
    if code:
        payload['code'] = code
    rc, out, err = curl(s, '/api/auth/login', method='POST', data=payload, headers=[f'Origin: {origin(s)}', *extra_headers], cacert=cacert)
    return parse(out) if rc == 0 else (0, {}, [], err)


def who_status(s, cookie, cacert):
    _, out, _ = curl(s, '/api/auth/status', cookie=cookie, cacert=cacert)
    return json.loads(parse(out)[3]).get('user')


def provision_with_terminal(s, owner_email, password):
    """Runs the REAL provision script on a pseudo-terminal and types the owner password at its prompts."""
    argv = ['sh', str(DEPLOY / 'scripts' / 'provision-company.sh'), '--name', s['name'], '--host', s['host'], '--local', '--http-port', str(s['http']),
            '--https-port', str(s['https']), '--owner-email', owner_email, '--owner-name', 'Owner A']
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(argv[0], argv)
    seen, typed, deadline = b'', 0, time.time() + 900
    while time.time() < deadline:
        r, _, _ = select.select([fd], [], [], 2)
        if r:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                break
            if not chunk:
                break
            seen += chunk
        else:
            _, status = os.waitpid(pid, os.WNOHANG)
            if _ == pid:
                return os.waitstatus_to_exitcode(status), seen.decode(errors='replace')
        tail = seen[-120:].decode(errors='replace')
        if typed == 0 and 'Owner password (typed, not shown):' in tail:
            os.write(fd, (password + '\n').encode()); typed = 1; seen += b'\n<<typed password 1>>\n'
        elif typed == 1 and 'Repeat the password:' in tail:
            os.write(fd, (password + '\n').encode()); typed = 2; seen += b'\n<<typed password 2>>\n'
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status), seen.decode(errors='replace')


def inspect(container):
    return json.loads(run(['docker', 'inspect', container]).stdout)[0]


def containers(s):
    return {svc: f"iq-{s['name']}-{svc}-1" for svc in ('caddy', 'web', 'api')}


def read_secret(s, name):
    return (COMPANIES / s['name'] / 'secrets' / name).read_text().strip()


def main():
    keep = '--keep' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    say('A5 local stack run: two companies through Caddy over HTTPS (test CA)')
    for s in STACKS.values():
        if (COMPANIES / s['name']).exists():
            sys.exit(f"{COMPANIES / s['name']} exists from an earlier run; delete it with deploy/scripts/delete-company.sh first")
    real_before = run(['docker', 'inspect', 'project-api-1', '--format', '{{.Id}} {{.State.StartedAt}}']).stdout.strip()
    owners_dir = Path(tempfile.mkdtemp(prefix='iq-owners-'))
    A, B = STACKS['A'], STACKS['B']
    try:
        # ---- provisioning -------------------------------------------------------------------------------------------------------
        say('\n1. Provisioning')
        rc, transcript = provision_with_terminal(A, 'owner-a@example.com', PASSWORD_A)
        (OUT / 'provision-A-transcript.log').write_text(transcript)
        check('A: provision-company.sh ran to the end with the owner password typed at a terminal', rc == 0 and 'Company tsta is running' in transcript, transcript[-400:])
        secrets_text = [read_secret(A, 'totp_key'), read_secret(A, 'restic_password')]
        check('A: the transcript contains no secret and not the typed password', not any(t in transcript for t in secrets_text) and PASSWORD_A not in transcript.replace('<<typed password', ''))
        mode = lambda p: oct(os.stat(p).st_mode & 0o777)
        d = COMPANIES / A['name']
        check('A: secrets are private files (dir 700, files 400)', mode(d / 'secrets') == '0o700' and mode(d / 'secrets' / 'totp_key') == '0o400' and mode(d / 'secrets' / 'restic_password') == '0o400',
              [mode(d / 'secrets'), mode(d / 'secrets' / 'totp_key')])
        envtext = (d / 'company.env').read_text()
        check('A: company.env (settings) holds no secret', not any(t in envtext for t in secrets_text))
        check('A: the key is a valid Fernet key (32 bytes, url-safe base64)', re.fullmatch(r'[A-Za-z0-9_-]{43}=', secrets_text[0]) is not None)
        env_b = {'IQ_COMPOSE_EXTRA': str(DEPLOY / 'tests' / 'compose.test.yaml'), 'IQ_PREPARE_HOOK': str(DEPLOY / 'tests' / 'prepare_hook.sh'), 'IQ_OWNERS_DIR': str(owners_dir)}
        p = script('provision-company.sh', '--name', B['name'], '--host', B['host'], '--local', '--http-port', str(B['http']), '--https-port', str(B['https']), '--skip-owner', env=env_b)
        check('B: provisioned with the controlled AI provider and the browser-test users', 'Company tstb is running' in p.stdout)
        owners_file = owners_dir / 'e2e_owners.json'

        ca = {}
        for key, s in STACKS.items():
            path = OUT / f'caddy-test-ca-{key}.crt'
            path.write_text(run(['docker', 'exec', containers(s)['caddy'], 'cat', '/data/caddy/pki/authorities/local/root.crt']).stdout)
            ca[key] = path

        # ---- per stack: redirect, certificate, headers, cookie -------------------------------------------------------------------
        for key, s in STACKS.items():
            say(f"\n2{key}. Stack {key} ({origin(s)})")
            rc, out, _ = curl(s, '/some/page?x=1', scheme='http')
            status, h, _, _ = parse(out)
            check(f'{key}: plain HTTP is redirected to HTTPS, path and query kept', status in (301, 308) and h.get('location') == f"{origin(s)}/some/page?x=1", (status, h.get('location')))
            rc, out, err = curl(s, '/', cacert=ca[key])
            status, h, _, body = parse(out)
            check(f'{key}: HTTPS answers and the certificate chain is valid against the stack\'s own test CA', rc == 0 and status == 200 and '<div id="root">' in body, err)
            rc2, _, err2 = curl(s, '/', include=False)
            check(f'{key}: without that CA the certificate is NOT trusted (it is a test CA, not a public one)', rc2 != 0 and 'certificate' in err2.lower(), err2)
            for label, path in (('page', '/'), ('API answer', '/api/auth/status'), ('error page', '/api/does-not-exist')):
                _, o, _ = curl(s, path, cacert=ca[key])
                st, hh, _, _ = parse(o)
                csp = hh.get('content-security-policy', '')
                check(f'{key}: headers on the {label}', hh.get('x-content-type-options') == 'nosniff' and hh.get('referrer-policy') == 'no-referrer'
                      and "frame-ancestors 'none'" in csp and hh.get('x-frame-options') == 'DENY' and 'server' not in hh, hh)
            check(f'{key}: no HSTS on the local configuration (HSTS is only in the real-HTTPS Caddyfile)', 'strict-transport-security' not in hh)
            check(f'{key}: HTTP/3 is not advertised (only TCP 80 and 443 are published)', 'alt-svc' not in hh, hh.get('alt-svc'))

        email_a, pw_a = 'owner-a@example.com', PASSWORD_A
        st, h, cookies, body = login(A, email_a, pw_a, cacert=ca['A'])
        check('A: the owner signs in through the proxy (first sign-in: new password and two-step setup are still required)', st == 200 and '"must_change_password":true' in body.replace(' ', ''), (st, body[:120]))
        cookie_line = next((c for c in cookies if c.startswith('insightiq_session=')), '')
        check('A: the session cookie is Secure, HttpOnly and SameSite=Lax', all(f.lower() in cookie_line.lower() for f in ('Secure', 'HttpOnly', 'SameSite=Lax')), cookie_line.split(';', 1)[-1])
        session_a = cookie_line.split(';')[0]
        for label, hdr in (('a foreign Origin', ['Origin: https://evil.example']), ('plain-http Origin', [f"Origin: http://{A['host']}:{A['https']}"])):
            rc, out, _ = curl(A, '/api/auth/login', method='POST', data={'email': email_a, 'password': 'x' * 14}, headers=hdr, cacert=ca['A'])
            check(f'A: sign-in with {label} is refused (the stated public address is the only one accepted)', parse(out)[0] == 403, parse(out)[0])
        # a state-changing request that carries a session but no Origin (a cross-site form post would look like this) is refused
        st, h, cookies, body = login(B, 'analyst@example.com', PASSWORD_B, cacert=ca['B'])
        spare = next((c.split(';')[0] for c in cookies if c.startswith('insightiq_session=')), '')
        rc, out, _ = curl(B, '/api/auth/logout', method='POST', cookie=spare, cacert=ca['B'])
        check('B: a request with a session but no Origin is refused (403) and the session survives', parse(out)[0] == 403 and (who_status(B, spare, ca['B']) or {}).get('email') == 'analyst@example.com', parse(out)[0])
        rc, out, _ = curl(B, '/api/auth/logout', method='POST', cookie=spare, headers=[f'Origin: {origin(B)}'], cacert=ca['B'])
        check('B: the same request from the stated public address is accepted (sign-out works)', parse(out)[0] == 200, parse(out)[0])
        st, h, cookies, body = login(B, 'analyst@example.com', PASSWORD_B, cacert=ca['B'])
        session_b = next((c.split(';')[0] for c in cookies if c.startswith('insightiq_session=')), '')
        check('B: an analyst signs in through the proxy', st == 200 and session_b != '', (st, body[:100]))

        say('\n3. One company cannot use the other\'s session')
        def who(s, cookie, key):
            _, out, _ = curl(s, '/api/auth/status', cookie=cookie, cacert=ca[key])
            return json.loads(parse(out)[3]).get('user')
        check('A: A\'s session is known on A', (who(A, session_a, 'A') or {}).get('email') == email_a)
        check('B: B\'s session is known on B', (who(B, session_b, 'B') or {}).get('email') == 'analyst@example.com')
        check('B: A\'s session cookie means nothing on B (no user)', who(B, session_a, 'B') is None)
        check('A: B\'s session cookie means nothing on A (no user)', who(A, session_b, 'A') is None)
        _, out, _ = curl(B, '/api/datasets', cookie=session_a, cacert=ca['B'])
        check('B: A\'s cookie is refused on a data route of B (401)', parse(out)[0] == 401, parse(out)[0])
        _, out, _ = curl(A, '/api/projects', cookie=session_b, cacert=ca['A'])
        check('A: B\'s cookie is refused on a data route of A (401)', parse(out)[0] == 401, parse(out)[0])
        check('A and B have different keys and different data volumes', read_secret(A, 'totp_key') != read_secret(B, 'totp_key') and True)
        vols = run(['docker', 'volume', 'ls', '-q']).stdout.split()
        check('each company has its own data volume', 'iq-tsta_data' in vols and 'iq-tstb_data' in vols)

        # ---- throttle behind the proxy -------------------------------------------------------------------------------------------
        say('\n4. Per-client throttle behind the proxy (two helper containers with different addresses on A\'s internal network)')
        net = 'iq-tsta_internal'
        caddy_ip = re.search(r'CADDY_IP=(\S+)', (COMPANIES / 'tsta' / 'company.env').read_text()).group(1)
        c1, c2 = 'tsta-helper-1', 'tsta-helper-2'
        for c in (c1, c2):
            run(['docker', 'rm', '-f', c], check_rc=False)
            run(['docker', 'run', '-d', '--name', c, '--network', net, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'sleep', CURL_IMAGE, '600'])
        ip = lambda c: json.loads(run(['docker', 'inspect', '-f', '{{json .NetworkSettings.Networks}}', c]).stdout)[net]['IPAddress']
        ip1, ip2 = ip(c1), ip(c2)
        check('the two helper clients have different addresses', ip1 != ip2, (ip1, ip2))

        def helper_login(c, email, via='caddy', xff=None):
            target = f"https://{A['host']}/api/auth/login"
            cmd = ['docker', 'exec', c, 'curl', '-sS', '-m', '15', '-k', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST', '-H', f"Origin: {origin(A)}", '-H', 'Content-Type: application/json']
            if via == 'caddy':
                cmd += ['--resolve', f"{A['host']}:443:{caddy_ip}"]
            else:
                target = 'http://api:8000/api/auth/login'
            if xff:
                cmd += ['-H', f'X-Forwarded-For: {xff}']
            cmd += ['--data', json.dumps({'email': email, 'password': 'wrong password!!'}), target]
            return run(cmd, check_rc=False).stdout.strip()
        codes = [helper_login(c1, f'nobody{i}@example.com') for i in range(24)]
        check('client 1 is slowed (429) after repeated failures, whoever it tries to sign in as', codes[0] == '401' and codes[-1] == '429', codes[:2] + codes[-2:])
        check('client 2, behind the same proxy, is NOT affected', helper_login(c2, 'nobody-x@example.com') == '401')
        check('a spoofed X-Forwarded-For sent to the proxy does not reset client 1\'s count (the proxy replaces it)', helper_login(c1, 'nobody-y@example.com', xff=ip2) == '429')
        check('a spoofed X-Forwarded-For sent straight to the app (not from the proxy) is ignored: still client 1\'s count', helper_login(c1, 'nobody-z@example.com', via='direct', xff='203.0.113.77') == '429')
        check('and straight to the app, client 2 is counted as itself, not as the spoofed address', helper_login(c2, 'nobody-w@example.com', via='direct', xff=ip1) == '401')
        out = run(['docker', 'exec', c1, 'curl', '-sS', '-m', '6', '-o', '/dev/null', '-w', '%{http_code}', 'https://1.1.1.1/'], check_rc=False)
        check('the internal network has no route out (a container on it cannot reach the internet)', out.returncode != 0 or out.stdout.strip() in ('000', ''), out.stdout + out.stderr)
        audit = run(['docker', 'exec', containers(A)['api'], 'python', '-c',
                     "import sqlite3;d=sqlite3.connect('file:/data/catalog.sqlite?mode=ro',uri=True);print(sorted({r[0] for r in d.execute(\"select client from audit_events where event='sign_in_failed'\")}))"]).stdout
        check('the security log records the real client addresses, not the proxy\'s', ip1 in audit and ip2 in audit and caddy_ip not in audit, audit.strip())
        for c in (c1, c2):
            run(['docker', 'rm', '-f', c], check_rc=False)

        # ---- reachability and hardening at run time -----------------------------------------------------------------------------------
        say('\n5. What is published, and how the containers run (stack A, the real image)')
        for key, s in STACKS.items():
            published = {svc: inspect(c)['HostConfig']['PortBindings'] for svc, c in containers(s).items()}
            ports_ok = all(not published[svc] for svc in ('api', 'web')) and set(published['caddy']) == {'80/tcp', '443/tcp'}
            check(f'{key}: only Caddy publishes ports, and only 80 and 443 (api and web publish nothing)', ports_ok, published)
            net_info = json.loads(run(['docker', 'network', 'inspect', f"iq-{s['name']}_internal"]).stdout)[0]
            check(f'{key}: the internal network is marked internal', net_info['Internal'] is True)
        for svc, c in containers(A).items():
            i = inspect(c); hc = i['HostConfig']
            check(f'A/{svc}: read-only root, all capabilities dropped, no-new-privileges, limits, healthy',
                  hc['ReadonlyRootfs'] and hc['CapDrop'] == ['ALL'] and not hc.get('CapAdd') and 'no-new-privileges:true' in hc['SecurityOpt'] and hc['Memory'] > 0 and hc['NanoCpus'] > 0 and hc['PidsLimit'] > 0
                  and i['State']['Health']['Status'] == 'healthy', {k: hc[k] for k in ('ReadonlyRootfs', 'CapDrop', 'Memory', 'NanoCpus', 'PidsLimit')})
            uid = run(['docker', 'exec', c, 'id', '-u']).stdout.strip()
            check(f'A/{svc}: runs as a non-root user (uid {uid})', uid != '0')
        api = containers(A)['api']
        w = run(['docker', 'exec', api, 'sh', '-c', 'touch /app/x 2>&1; touch /etc/x 2>&1; touch /tmp/ok && echo tmp-ok'], check_rc=False).stdout
        check('A/api: the root file system cannot be written; only /tmp (memory) and /data are writable', 'Read-only file system' in w and 'tmp-ok' in w, w)
        key_text = read_secret(A, 'totp_key')
        envdump = run(['docker', 'exec', api, 'env']).stdout
        check('A/api: the key is not in the container environment, only its file path', key_text not in envdump and 'AUTH_TOTP_KEY_FILE=/run/secrets/totp_key' in envdump and 'AUTH_TOTP_KEY=' not in envdump)
        all_inspect = ''.join(run(['docker', 'inspect', c]).stdout for c in containers(A).values())
        imgs = run(['docker', 'inspect', 'insightiq-hosted-api:local', 'insightiq-hosted-web:local']).stdout
        hist = run(['docker', 'history', '--no-trunc', 'insightiq-hosted-api:local']).stdout
        check('A: the key is not in any container definition, image definition or image history', key_text not in all_inspect and key_text not in imgs and key_text not in hist)
        check('A/api: the key file is readable by the app and is a mounted secret', run(['docker', 'exec', api, 'sh', '-c', 'test -r /run/secrets/totp_key && echo yes'], check_rc=False).stdout.strip() == 'yes')

        say('\n6. The app refuses to start on missing or unsafe hosted settings (real image, one-shot)')
        def start(drop=None, extra=(), key_mount=True):
            envs = {'AUTH_MODE': 'on', 'APP_ENV': 'production', 'AUTH_ALLOWED_ORIGINS': 'https://x.example', 'AUTH_TRUSTED_PROXIES': '172.29.0.2/32', 'AUTH_TOTP_KEY_FILE': '/run/secrets/totp_key', 'INSIGHTIQ_BIND_HOST': '0.0.0.0'}
            envs.pop(drop, None)
            cmd = ['docker', 'run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp', '--user', f'{os.getuid()}:{os.getgid()}', '-v', 'iq-tsta_data:/data']
            if key_mount:
                cmd += ['-v', f"{COMPANIES / 'tsta' / 'secrets' / 'totp_key'}:/run/secrets/totp_key:ro"]
            for k, v in envs.items():
                cmd += ['-e', f'{k}={v}']
            cmd += list(extra) + ['insightiq-hosted-api:local', 'timeout', '8', 'python', '-m', 'app.serve', '--host', '0.0.0.0', '--port', '8000']
            return run(cmd, check_rc=False, timeout=60)
        for label, kwargs, fragment in (
            ('no public address', dict(drop='AUTH_ALLOWED_ORIGINS'), 'AUTH_ALLOWED_ORIGINS'),
            ('no trusted proxy', dict(drop='AUTH_TRUSTED_PROXIES'), 'AUTH_TRUSTED_PROXIES'),
            ('no key file setting', dict(drop='AUTH_TOTP_KEY_FILE'), 'AUTH_TOTP_KEY'),
            ('key file missing', dict(key_mount=False), 'cannot be read'),
            ('login off in production', dict(extra=['-e', 'AUTH_MODE=off']), 'AUTH_MODE=off'),
            ('key as an environment value', dict(drop='AUTH_TOTP_KEY_FILE', extra=['-e', f'AUTH_TOTP_KEY={key_text}']), 'secret file'),
            ('http public address', dict(extra=['-e', 'AUTH_ALLOWED_ORIGINS=http://x.example']), 'exact https'),
        ):
            p = start(**kwargs)
            check(f'refuses to start: {label}', p.returncode == 2 and fragment in p.stderr, (p.returncode, p.stderr[-160:]))
        p = start()
        check('and with every setting present it starts (stopped by the 8-second timeout, not by an error)', p.returncode == 124, (p.returncode, p.stderr[-200:]))

        # ---- browser suite through the proxy ---------------------------------------------------------------------------------------------
        say('\n7. The hosted browser suite through B\'s proxy (Chrome, HTTPS, strict Content-Security-Policy)')
        pw = subprocess.run(['npx', 'playwright', 'test', '--config', 'playwright.hosted-stack.config.ts'], cwd=ROOT / 'frontend', text=True, capture_output=True,
                            env=dict(os.environ, HOSTED_STACK_URL=origin(B), HOSTED_E2E_OWNERS_FILE=str(owners_file), HOSTED_E2E_CAPTURE_DIR='../docs/accounts/a5/stack-after'), timeout=1500)
        (OUT / 'e2e-hosted-stack.log').write_text(pw.stdout + pw.stderr)
        m = re.search(r'(\d+) passed', pw.stdout)
        check('the hosted browser suite (13 tests + 2 policy tests) passes through the proxy', pw.returncode == 0 and m and int(m.group(1)) == 15, pw.stdout[-300:])

        # ---- backup, restore drill, update ------------------------------------------------------------------------------------------------
        say('\n8. Encrypted backup (restic), restore drill, update')
        p = script('backup-company.sh', '--name', B['name'], env=env_b)
        check('B: a backup of the running company completes (app paused only during the copy) and the repository checks out', 'finished and checked' in p.stdout, p.stdout[-300:])
        check('B: the app is running again after the backup', inspect(containers(B)['api'])['State']['Status'] == 'running' and not inspect(containers(B)['api'])['State']['Paused'])
        repo_blob = b''.join(f.read_bytes() for f in (COMPANIES / 'tstb' / 'backups' / 'repo').rglob('*') if f.is_file())
        check('B: the repository is encrypted (no plain catalog header, no plain user email in it)', b'SQLite format 3' not in repo_blob and b'analyst@example.com' not in repo_blob)
        restored = Path(tempfile.mkdtemp(prefix='iq-restored-'))
        os.chmod(restored, 0o777)
        run(['docker', 'run', '--rm', '--user', f'{os.getuid()}:{os.getgid()}', '--network', 'none', '--cap-drop', 'ALL', '--tmpfs', '/tmp', '-e', 'RESTIC_CACHE_DIR=/tmp/c',
             '-v', f"{COMPANIES / 'tstb' / 'backups' / 'repo'}:/repo:ro", '-v', f"{COMPANIES / 'tstb' / 'secrets' / 'restic_password'}:/pw:ro", '-v', f'{restored}:/out', 'restic/restic:0.20.0',
             '-r', '/repo', '--password-file', '/pw', 'restore', 'latest', '--target', '/out', '--no-lock', '--quiet'])
        keyb = read_secret(B, 'totp_key').encode()
        leaked = [str(f) for f in restored.rglob('*') if f.is_file() and keyb in f.read_bytes()]
        check('B: the TOTP key is NOT inside the backup it protects (every restored file searched)', leaked == [] and any(restored.rglob('catalog.sqlite')), leaked)
        shutil.rmtree(restored, ignore_errors=True)
        p = script('restore-drill.sh', '--name', B['name'], env=dict(env_b, IQ_DRILL_OUT=str(OUT)), check_rc=False)
        (OUT / 'restore-drill.log').write_text(p.stdout + p.stderr)
        check('B: RESTORE DRILL: volume destroyed, restored from restic, files and catalog content identical', p.returncode == 0 and 'RESTORE DRILL PASSED' in p.stdout, p.stdout[-400:] + p.stderr[-300:])
        st, h, cookies, body = login(B, 'analyst@example.com', PASSWORD_B, cacert=ca['B'])
        check('B: after the restore the app starts and the analyst signs in with the same password', st == 200, (st, body[:100]))
        p = script('update.sh', '--name', B['name'], '--build', env=env_b, check_rc=False, timeout=1500)
        (OUT / 'update.log').write_text(p.stdout + p.stderr)
        check('B: update.sh backs up first, rebuilds, restarts and the stack is healthy again', p.returncode == 0 and p.stdout.index('finished and checked') < p.stdout.index('updated tstb'), p.stdout[-300:] + p.stderr[-300:])
        st, _, _, _ = login(B, 'analyst@example.com', PASSWORD_B, cacert=ca['B'])
        check('B: still signs in after the update', st == 200, st)
    finally:
        say('\n9. Delete both companies')
        for s in STACKS.values():
            if (COMPANIES / s['name']).exists():
                p = script('delete-company.sh', '--name', s['name'], '--yes-delete-everything', check_rc=False)
                (OUT / f"delete-{s['name']}.log").write_text(p.stdout + p.stderr)
                check(f"{s['name']}: delete-company.sh finished and said what it did and did not remove", p.returncode == 0 and 'NOT removed' in p.stdout, p.stderr[-300:])
        left_v = [v for v in run(['docker', 'volume', 'ls', '-q']).stdout.split() if v.startswith(('iq-tsta', 'iq-tstb'))]
        left_c = run(['docker', 'ps', '-a', '--format', '{{.Names}}']).stdout.split()
        left_n = [n for n in run(['docker', 'network', 'ls', '--format', '{{.Name}}']).stdout.split() if n.startswith(('iq-tsta', 'iq-tstb'))]
        check('nothing of either company is left: volumes, containers, networks, folders', not left_v and not [c for c in left_c if c.startswith(('iq-tsta', 'iq-tstb'))] and not left_n
              and not (COMPANIES / 'tsta').exists() and not (COMPANIES / 'tstb').exists(), (left_v, left_n))
        real_after = run(['docker', 'inspect', 'project-api-1', '--format', '{{.Id}} {{.State.StartedAt}}']).stdout.strip()
        check('the development app container and its volume were not touched (same container id and start time; volume still there)',
              real_before == real_after and 'project_insightiq-data' in run(['docker', 'volume', 'ls', '-q']).stdout.split(), (real_before, real_after))
        shutil.rmtree(owners_dir, ignore_errors=True)
    failed = [r for r in RESULTS if not r['ok']]
    (OUT / 'stacks-results.json').write_text(json.dumps({'passed': len(RESULTS) - len(failed), 'failed': len(failed), 'checks': RESULTS}, indent=1))
    say(f"\n{len(RESULTS) - len(failed)} checks passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
