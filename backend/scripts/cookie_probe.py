"""Throwaway probe: does a browser accept and send the Secure, HttpOnly, SameSite=Lax session cookie over http://localhost?

    cd backend && ../.venv/bin/python scripts/cookie_probe.py --port 8011 --report /tmp/cookie-probe.jsonl

It starts the real application with AUTH_MODE=on and AUTH_COOKIE_SECURE=true on a THROWAWAY folder, seeds one test user,
and serves /probe (a page that signs in and then calls /api/auth/me) and /probe-report (records the page's result).
It never touches the real workspace. Not part of the product.
"""
import argparse
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app import auth  # noqa: E402
from app.main import create_app  # noqa: E402

PAGE = """<!doctype html><meta charset=utf-8><title>cookie probe</title><pre id=out>running</pre>
<script>
(async () => {
  const result = {origin: location.origin, userAgent: navigator.userAgent, secureContext: isSecureContext};
  try {
    const login = await fetch('/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: 'probe@example.com', password: 'a long unusual sentence here'})});
    result.loginStatus = login.status;
    const me = await fetch('/api/auth/me');
    result.meStatusAfterLogin = me.status;           // 200 means the browser stored the Secure cookie and sent it back
    result.cookieReadableByScript = document.cookie.includes('insightiq_session');   // must be false (HttpOnly)
    const out = await fetch('/api/auth/logout', {method: 'POST'});
    result.logoutStatus = out.status;
    result.meStatusAfterLogout = (await fetch('/api/auth/me')).status;
  } catch (e) { result.error = String(e); }
  await fetch('/probe-report', {method: 'POST', body: JSON.stringify(result)});
  document.getElementById('out').textContent = JSON.stringify(result, null, 1);
})();
</script>"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8011)
    parser.add_argument('--report', default='/tmp/cookie-probe.jsonl')
    args = parser.parse_args()
    folder = tempfile.mkdtemp(prefix='insightiq-cookie-probe-')
    application = create_app(folder, auth_config=auth.AuthConfig(mode='on', cookie_secure=True, bind_host='127.0.0.1'))
    service = application.state.auth
    # create the tables by entering the lifespan once, then seed one user
    from fastapi.testclient import TestClient
    with TestClient(application):
        with Session(service.engine) as s:
            company = service.create_company(s, 'Probe')
            service.create_user(s, company.id, 'probe@example.com', 'Probe', 'owner', 'a long unusual sentence here', must_change=False)
            s.commit()

    async def wrapper(scope, receive, send):
        if scope['type'] == 'http' and scope['path'] in ('/probe', '/probe-report'):
            if scope['path'] == '/probe':
                body, kind = PAGE.encode(), b'text/html; charset=utf-8'
            else:
                message = await receive()
                with open(args.report, 'a') as fh:
                    fh.write(message.get('body', b'').decode() + '\n')
                body, kind = b'ok', b'text/plain'
            await send({'type': 'http.response.start', 'status': 200, 'headers': [(b'content-type', kind)]})
            await send({'type': 'http.response.body', 'body': body})
            return
        await application(scope, receive, send)

    uvicorn.run(wrapper, host='127.0.0.1', port=args.port, log_level='warning')


if __name__ == '__main__':
    main()
