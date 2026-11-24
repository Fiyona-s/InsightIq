"""Launcher that applies the fail-closed rule before the server starts (Accounts A1).

    python -m app.serve --host 127.0.0.1 --port 8000

It records the address the server is about to listen on (INSIGHTIQ_BIND_HOST) and refuses to start when
AUTH_MODE=off would be exposed on anything but a loopback address, or when APP_ENV=production. The application
repeats the same check when it is created, so starting uvicorn directly with unsafe settings also stops.
"""
import argparse
import os
import sys

from .auth import AuthConfig, ConfigError


def main(argv=None, run=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args(argv)
    os.environ['INSIGHTIQ_BIND_HOST'] = args.host
    try:
        AuthConfig.from_env().check()
    except ConfigError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if run is None:
        import uvicorn
        run = uvicorn.run
    run('app.main:app', host=args.host, port=args.port, proxy_headers=False)     # the app itself decides which proxy to trust (AUTH_TRUSTED_PROXIES)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
