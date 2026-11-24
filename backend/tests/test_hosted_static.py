"""Accounts stage A5: static tests of the hosted package under deploy/. They read the files and fail on anything that weakens the rules
below; they do not start Docker (the stack run does that: deploy/tests/run_stacks.py). Nothing here claims data is separate or protected."""
import os
import re
import stat
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / 'deploy'
COMPOSE_TEXT = (DEPLOY / 'compose.yaml').read_text()
COMPOSE = yaml.safe_load(COMPOSE_TEXT)
SERVICES = COMPOSE['services']


def default(value):
    """A compose value with its ${VAR:-default} resolved to the default (what runs when company.env does not override it)."""
    return re.sub(r'\$\{[A-Z_]+(?::[-?][^}]*)?\}', lambda m: (re.search(r':-([^}]*)', m.group(0)) or [None, ''])[1], str(value))


# ---- 3. reachability -----------------------------------------------------------------------------------------------
def test_only_caddy_publishes_ports_and_only_80_and_443():
    published = {name: svc['ports'] for name, svc in SERVICES.items() if svc.get('ports')}
    assert list(published) == ['caddy']
    targets = {int(str(p).rsplit(':', 1)[1]) for p in published['caddy']}
    assert targets == {80, 443}
    assert {int(default(p).split(':')[0]) for p in published['caddy']} == {80, 443}      # and by default the host ports are 80 and 443 too


def test_nothing_else_opens_the_stack_to_the_host():
    text = COMPOSE_TEXT
    for forbidden in ('network_mode', 'privileged:', 'pid:', 'ipc:', 'devices:', '/var/run/docker.sock', 'cap_add', 'expose:'):
        assert forbidden not in text, forbidden
    for name, svc in SERVICES.items():
        assert not any(str(v).startswith(('/', '~')) and ':' in str(v) and not str(v).startswith('/etc/caddy') for v in svc.get('volumes', [])), name   # no host paths mounted (the Caddyfile is the only bind)


def test_the_app_and_the_front_end_are_on_the_internal_network_only():
    nets = COMPOSE['networks']
    assert nets['internal']['internal'] is True and 'internal' not in nets['edge']
    assert set(SERVICES['api']['networks']) == {'internal'} and set(SERVICES['web']['networks']) == {'internal'}
    assert set(SERVICES['caddy']['networks']) == {'edge', 'internal'}


def test_the_proxy_has_a_fixed_internal_address_that_is_the_only_trusted_proxy():
    env = SERVICES['api']['environment']
    assert SERVICES['caddy']['networks']['internal']['ipv4_address'].startswith('${CADDY_IP')
    assert env['AUTH_TRUSTED_PROXIES'].startswith('${CADDY_IP') and env['AUTH_TRUSTED_PROXIES'].endswith('/32')


# ---- 2. settings and secrets ----------------------------------------------------------------------------------------
def test_the_app_runs_in_hosted_mode_with_every_required_setting():
    env = SERVICES['api']['environment']
    assert env['APP_ENV'] == 'production' and str(env['AUTH_MODE']).lower() == 'on' and str(env['AUTH_COOKIE_SECURE']).lower() == 'true' and str(env['AUTH_OWNER_TOTP']).lower() == 'true'
    assert env['AUTH_ALLOWED_ORIGINS'].startswith('${PUBLIC_ORIGIN:?')          # required, no default: compose stops if it is missing
    assert '${CADDY_IP:?' in env['AUTH_TRUSTED_PROXIES']
    assert env['AUTH_TOTP_KEY_FILE'] == '/run/secrets/totp_key'


def test_the_totp_key_is_a_secret_file_never_an_environment_value_or_a_literal():
    assert 'AUTH_TOTP_KEY' not in {k for svc in SERVICES.values() for k in (svc.get('environment') or {})}
    assert COMPOSE['secrets']['totp_key']['file'].endswith('/secrets/totp_key')
    assert 'totp_key' in SERVICES['api']['secrets'] and 'secrets' not in SERVICES['caddy'] and 'secrets' not in SERVICES['web']
    assert not re.search(r'[A-Za-z0-9_-]{43}=', COMPOSE_TEXT), 'a key-shaped literal is in the compose file'
    for path in (DEPLOY / 'api.Dockerfile', DEPLOY / 'web' / 'Dockerfile'):
        text = path.read_text()
        assert 'TOTP' not in text and 'SECRET' not in text.upper() and 'PASSWORD' not in text.upper(), path.name
    for name, svc in SERVICES.items():
        for k, v in (svc.get('environment') or {}).items():
            assert not re.search(r'KEY|SECRET|PASSWORD|TOKEN', k) or k.endswith('_FILE'), f'{name}.{k}'


def test_the_images_never_copy_secrets_or_settings_files():
    for path in (DEPLOY / 'api.Dockerfile', DEPLOY / 'web' / 'Dockerfile'):
        copied = ' '.join(re.findall(r'^(?:COPY|ADD) .*$', path.read_text(), re.M))
        assert not re.search(r'\.env|secrets|company', copied), path.name
    assert 'tests' not in ' '.join(re.findall(r'^COPY .*$', (DEPLOY / 'api.Dockerfile').read_text(), re.M))      # no test code in the image


# ---- 5. container hardening -----------------------------------------------------------------------------------------
@pytest.mark.parametrize('name', ['caddy', 'web', 'api'])
def test_each_container_is_hardened(name):
    svc = SERVICES[name]
    assert svc['read_only'] is True
    assert svc['cap_drop'] == ['ALL'] and 'cap_add' not in svc
    assert 'no-new-privileges:true' in svc['security_opt']
    assert svc['mem_limit'] and float(svc['cpus']) > 0 and int(svc['pids_limit']) > 0
    assert svc['healthcheck']['test'] and svc['healthcheck']['interval'] and svc['healthcheck']['retries']
    assert svc.get('restart') == 'unless-stopped'


def test_containers_run_as_a_non_root_user():
    for name in ('caddy', 'api'):
        uid = default(SERVICES[name]['user']).split(':')[0]
        assert uid.isdigit() and int(uid) != 0, name
    web = (DEPLOY / 'web' / 'Dockerfile').read_text()
    assert 'nginx-unprivileged' in web                      # runs as a non-root user by design
    api = (DEPLOY / 'api.Dockerfile').read_text()
    assert re.search(r'^USER 10001:10001$', api, re.M)


def test_what_may_be_written_is_listed_and_small():
    assert SERVICES['api']['volumes'] == ['data:/data']
    assert SERVICES['api']['tmpfs'] == ['/tmp:size=512m']
    assert SERVICES['web']['tmpfs'] == ['/tmp'] and SERVICES['caddy']['tmpfs'] == ['/tmp']
    assert 'volumes' not in SERVICES['web']
    assert [v for v in SERVICES['caddy']['volumes'] if not v.endswith(':ro')] == ['caddy_data:/data', 'caddy_config:/config']


def test_the_data_volume_and_secrets_belong_to_this_stack_alone():
    assert set(COMPOSE['volumes']) == {'data', 'caddy_data', 'caddy_config'}
    assert all(v is None or 'external' not in v for v in COMPOSE['volumes'].values())
    assert 'name:' not in COMPOSE_TEXT.split('volumes:')[-1].split('secrets:')[0]      # no fixed volume name that two companies could share


def test_the_api_command_is_the_launcher_that_applies_the_start_up_rules():
    assert 'command' not in SERVICES['api']      # the image's CMD is used
    assert 'app.serve' in (DEPLOY / 'api.Dockerfile').read_text().split('CMD')[-1]


def test_the_development_compose_is_not_part_of_the_hosted_package():
    dev = (ROOT / 'compose.yaml').read_text()
    assert 'deploy' not in dev and 'caddy' not in dev.lower()
    assert '127.0.0.1:8000:8000' in dev and '127.0.0.1:8080:8080' in dev


# ---- 6. response headers at Caddy ----------------------------------------------------------------------------------------
CADDY = {'production': (DEPLOY / 'Caddyfile').read_text(), 'local': (DEPLOY / 'Caddyfile.local').read_text()}


def csp(text):
    return re.search(r'Content-Security-Policy "([^"]+)"', text).group(1)


@pytest.mark.parametrize('which', ['production', 'local'])
def test_the_proxy_sets_the_response_headers_and_redirects_http(which):
    text = CADDY[which]
    assert 'X-Content-Type-Options "nosniff"' in text and 'Referrer-Policy "no-referrer"' in text
    assert "frame-ancestors 'none'" in csp(text) and 'X-Frame-Options "DENY"' in text
    assert re.search(r'http://\{\$PUBLIC_HOST\}:80 \{\s+redir https://\{\$PUBLIC_HOST\}\{\$PUBLIC_PORT_SUFFIX\}\{uri\} permanent', text)
    assert 'handle /api/*' in text and 'reverse_proxy api:8000' in text and 'reverse_proxy web:8080' in text
    assert 'admin localhost:2019' in text                      # only inside the container
    assert 'max_size' in text


def test_hsts_is_only_in_the_real_https_configuration():
    assert 'Strict-Transport-Security "max-age=31536000"' in CADDY['production']
    assert 'Strict-Transport-Security' not in CADDY['local']
    assert 'tls internal' not in CADDY['production'] and 'local_certs' not in CADDY['production']
    assert 'tls internal' in CADDY['local'] and 'local_certs' in CADDY['local']


def test_the_content_security_policy_is_one_policy_and_has_no_script_loosening():
    assert csp(CADDY['production']) == csp(CADDY['local'])
    policy = csp(CADDY['production'])
    directives = dict(d.strip().split(' ', 1) for d in policy.split(';'))
    assert directives['default-src'] == "'self'" and directives['object-src'] == "'none'" and directives['base-uri'] == "'self'"
    assert "'unsafe-eval'" not in policy and '*' not in policy and 'http:' not in policy
    assert "'unsafe-inline'" not in directives['script-src']


def test_the_front_end_server_adds_no_competing_security_headers():
    nginx = (DEPLOY / 'web' / 'nginx.conf').read_text()
    for header in ('Referrer-Policy', 'X-Content-Type-Options', 'Content-Security-Policy', 'Strict-Transport'):
        assert header not in nginx


# ---- 7. scripts -------------------------------------------------------------------------------------------------------------
SCRIPTS = ['provision-company.sh', 'delete-company.sh', 'update.sh', 'backup-company.sh', 'restore-company.sh', 'restore-drill.sh', 'build-images.sh']


@pytest.mark.parametrize('name', SCRIPTS)
def test_scripts_exist_are_executable_and_pass_the_shell_syntax_check(name):
    path = DEPLOY / 'scripts' / name
    assert path.is_file() and os.access(path, os.X_OK)
    import subprocess
    assert subprocess.run(['sh', '-n', str(path)]).returncode == 0


def test_provisioning_generates_secrets_privately_and_never_prints_or_accepts_them():
    text = (DEPLOY / 'scripts' / 'provision-company.sh').read_text()
    assert 'umask 077' in text and 'chmod 700' in text and 'chmod 400 "$DIR/secrets/totp_key" "$DIR/secrets/restic_password"' in text
    assert 'openssl rand' in text
    assert not re.search(r'(echo|printf|cat)[^\n|]*secrets/(totp_key|restic_password)', text.replace('> "$DIR/secrets', ''))     # never printed
    assert not re.search(r'--(password|totp|key|secret)\b', text)                   # no option can carry a secret
    assert 'create-company' in text and '[ -t 0 ]' in text                          # the owner password is typed at a terminal
    assert 'cat > "$DIR/company.env"' in text and not re.search(r'company\.env <<ENVEOF[\s\S]*?(TOTP|RESTIC|PASSWORD)[\s\S]*?ENVEOF', text)


def test_delete_says_what_it_removes_and_what_it_does_not():
    text = (DEPLOY / 'scripts' / 'delete-company.sh').read_text()
    assert 'Type the company name' in text and '--yes-delete-everything' in text
    assert 'Deleted for company' in text and 'NOT removed' in text
    assert 'down --volumes' in text and 'backups' in text and 'secrets' in text
    assert 'offline' in text.lower()


def test_update_backs_up_first_and_stops_if_that_fails():
    text = (DEPLOY / 'scripts' / 'update.sh').read_text()
    assert text.index('backup-company.sh') < text.index('compose pull') < text.index('compose up -d')
    assert 'backup failed; nothing was changed' in text


def test_backups_hold_the_data_volume_only_never_the_totp_key():
    text = (DEPLOY / 'scripts' / 'backup-company.sh').read_text()
    assert 'restic_password' in text and 'totp_key' not in text.replace('(secrets/totp_key)', '').replace('secrets/totp_key', '')
    assert '"$(DATA_VOLUME):/data:ro"' in text and 'backup /data' in text and '--read-only' in text and '--network none' in text
    assert 'docker pause' in text and 'unpause' in text and 'trap' in text            # the app is always resumed
    assert '--keep-daily' in text and '--keep-weekly' in text and '--keep-monthly' in text and 'restic check' in text.replace('check --quiet', 'restic check')
    assert 'restic/restic:0.20.0' in text
    drill = (DEPLOY / 'scripts' / 'restore-drill.sh').read_text()
    assert 'volume rm' in drill and 'catalog_content_sha256' in drill and 'DESTROYING' in drill


def test_the_backup_schedule_units_call_the_backup_script():
    service = (DEPLOY / 'systemd' / 'iq-backup@.service').read_text()
    timer = (DEPLOY / 'systemd' / 'iq-backup@.timer').read_text()
    assert 'backup-company.sh --name %i' in service and 'OnCalendar=' in timer and 'Persistent=true' in timer


def test_generated_company_folders_are_ignored_by_the_release_scan_and_version_control():
    assert 'deploy/companies/' in (ROOT / '.gitignore').read_text()


def test_restores_from_the_read_only_repository_take_no_lock():
    """A read-only repository cannot hold a lock file; without --no-lock restic waits instead of failing (seen once in the A5 build)."""
    assert '--no-lock' in (DEPLOY / 'scripts' / 'restore-company.sh').read_text()
    assert ':/repo:ro' in (DEPLOY / 'scripts' / 'restore-company.sh').read_text()
