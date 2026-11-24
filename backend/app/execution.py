import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path


class ExecutionError(ValueError):
    def __init__(self, message, code='execution_error'):
        super().__init__(message)
        self.code = code


def execute_isolated(database, sql, mapping=None, cancel=None, timeout=5.0):
    cancel = cancel or threading.Event()
    if cancel.is_set():
        raise ExecutionError('Run cancelled.', 'cancelled')
    worker = Path(__file__).with_name('query_worker.py')
    # Do not inherit LLM keys, proxy credentials, Python hooks or application state.
    process = subprocess.Popen([sys.executable, '-I', str(worker)], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               env={'PATH': '/usr/bin:/bin', 'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1'},
                               cwd='/tmp', start_new_session=True)
    request = json.dumps({'database': str(database), 'sql': sql, 'mapping': mapping or {}})
    started = time.monotonic()
    first = True
    try:
        while True:
            if cancel.is_set():
                raise ExecutionError('Run cancelled.', 'cancelled')
            if time.monotonic() - started >= timeout:
                raise ExecutionError('Query exceeded the 5-second execution deadline.', 'timeout')
            try:
                output, _ = process.communicate(input=request.encode() if first else None, timeout=.05)
                break
            except subprocess.TimeoutExpired:
                first = False
        if process.returncode != 0 or len(output) > 8 * 1024 * 1024:
            raise ExecutionError('Query worker exited or exceeded its resource budget.', 'resource_limit')
        try:
            result = json.loads(output)
        except (ValueError, TypeError) as exc:
            raise ExecutionError('Query worker returned an invalid response.') from exc
        if 'error' in result:
            raise ExecutionError(result['error'], result['code'])
        return result
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
