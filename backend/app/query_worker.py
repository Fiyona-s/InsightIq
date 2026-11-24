"""One-shot worker, launched with python -I and a credential-free environment."""
import ctypes
import ctypes.util
import errno
import json
import math
import os
import resource
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import duckdb

# -I excludes the CWD; only our trusted source directory is added for revalidation.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sql_guard import TYPES, validate_sql, GuardError


def q(name):
    return '"' + name.replace('"', '""') + '"'


def restrict_os(database):
    """Deny network and new filesystem capabilities after trusted initialization."""
    if sys.platform == 'linux':
        lib = ctypes.CDLL('libseccomp.so.2', use_errno=True)
        lib.seccomp_init.argtypes = [ctypes.c_uint32]
        lib.seccomp_init.restype = ctypes.c_void_p
        lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
        lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
        lib.seccomp_attr_set.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_uint32]
        lib.seccomp_load.argtypes = [ctypes.c_void_p]
        lib.seccomp_release.argtypes = [ctypes.c_void_p]
        ctx = lib.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW
        if not ctx:
            raise RuntimeError('Could not initialize OS sandbox.')
        try:
            if lib.seccomp_attr_set(ctx, 4, 1) != 0:  # SCMP_FLTATR_CTL_TSYNC
                raise RuntimeError('Could not synchronize OS sandbox across threads.')
            # Database is already open read-only. No further opens or networking.
            for name in ('open', 'openat', 'openat2', 'creat', 'socket', 'connect', 'socketpair',
                         'bind', 'listen', 'accept', 'accept4', 'execve', 'execveat', 'ptrace',
                         'unlink', 'unlinkat', 'rename', 'renameat', 'renameat2', 'mkdir', 'mkdirat',
                         'link', 'linkat', 'symlink', 'symlinkat', 'mount', 'io_uring_setup'):
                number = lib.seccomp_syscall_resolve_name(name.encode())
                if number >= 0 and lib.seccomp_rule_add(ctx, 0x00050000 | errno.EPERM, number, 0) != 0:
                    raise RuntimeError('Could not configure OS sandbox.')
            if lib.seccomp_load(ctx) != 0:
                raise RuntimeError('Could not activate OS sandbox.')
        finally:
            lib.seccomp_release(ctx)
    elif sys.platform == 'darwin':
        lib = ctypes.CDLL('/usr/lib/libsandbox.dylib')
        lib.sandbox_init.argtypes = [ctypes.c_char_p, ctypes.c_uint64, ctypes.POINTER(ctypes.c_char_p)]
        # Permit only the selected database after all Python/native imports.
        profile = '(version 1)(allow default)(deny network*)(deny file-write*)(deny file-read*)(allow file-read* (literal ' + json.dumps(str(database)) + '))'
        error = ctypes.c_char_p()
        if lib.sandbox_init(profile.encode(), 0, ctypes.byref(error)) != 0:
            raise RuntimeError('OS sandbox unavailable. Run the API using Docker Compose.')
    else:
        raise RuntimeError('Unsupported sandbox platform. Use Docker Compose on Linux.')


def json_value(value):
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > 9007199254740991:
        return str(value)  # preserve exact values across JavaScript's numeric boundary
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, (Decimal, date, datetime)):
        return str(value)
    raise ValueError('Unsupported result type.')


def main():
    request = json.loads(sys.stdin.read(262144))
    resource.setrlimit(resource.RLIMIT_CPU, (3, 4))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if sys.platform == 'linux':
        resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
    database = Path(request['database']).resolve()
    with duckdb.connect(str(database), read_only=True, config={
        'enable_external_access': 'false', 'autoinstall_known_extensions': 'false',
        'autoload_known_extensions': 'false', 'allow_unsigned_extensions': 'false',
        'memory_limit': '128MB', 'threads': '1', 'max_temp_directory_size': '0B',
    }) as db:
        # Retrieve actual physical metadata; never trust a browser-supplied schema.
        physical = db.execute('DESCRIBE records').fetchall()
        mapping = request.get('mapping', {})
        schema = {c[0]: mapping.get(c[0], 'VARCHAR') for c in physical}
        if set(mapping) - set(schema) or any(t not in TYPES for t in schema.values()):
            raise ValueError('Invalid type mapping.')
        projections = []
        for name, typ in schema.items():
            expr = q(name) if typ == 'VARCHAR' else 'TRY_CAST(' + q(name) + ' AS ' + typ + ')'
            if typ == 'BIGINT':
                expr = 'CASE WHEN regexp_full_match(trim(' + q(name) + "), '[+-]?[0-9]+') THEN " + expr + ' ELSE NULL END'
            if typ == 'DOUBLE':
                expr = 'CASE WHEN isfinite(' + expr + ') THEN ' + expr + ' ELSE NULL END'
            projections.append(expr + ' AS ' + q(name))
        db.execute('CREATE TEMP VIEW data AS SELECT ' + ', '.join(projections) + ' FROM records')
        sql = validate_sql(request['sql'], schema)
        db.execute('SET lock_configuration = true')
        try:
            restrict_os(database)
        except (OSError, RuntimeError):
            return {'error': 'OS query sandbox could not start. Use Docker Compose on Linux or a macOS environment that permits sandbox initialization.', 'code': 'sandbox_unavailable'}
        columns = [{'name': c[0], 'type': c[1]} for c in db.execute('DESCRIBE ' + sql).fetchall()]
        cursor = db.execute(sql)
        if len(columns) > 100:
            return {'error': 'Result exceeds 100 columns. Select fewer columns.', 'code': 'result_limit'}
        rows, used = [], 0
        # Fetch cap+1; reject the whole result rather than return a misleading prefix.
        for _ in range(1001):
            row = cursor.fetchone()
            if row is None:
                return {'columns': columns, 'rows': rows, 'row_count': len(rows), 'executed_sql': sql}
            encoded = [json_value(v) for v in row]
            used += len(json.dumps(encoded, ensure_ascii=True).encode())
            if len(rows) == 1000 or used > 1024 * 1024:
                return {'error': 'Result exceeds 1,000 rows or 1 MiB. Ask for an aggregation or explicit filter/LIMIT.', 'code': 'result_limit'}
            rows.append(encoded)


if __name__ == '__main__':
    try:
        result = main()
    except (duckdb.OutOfMemoryException, MemoryError, duckdb.InterruptException):
        result = {'error': 'Query exceeded its memory or execution resource budget.', 'code': 'resource_limit'}
    except (GuardError, ValueError):
        result = {'error': 'Worker SQL or mapping validation failed.', 'code': 'validation_error'}
    except duckdb.Error:
        # Query errors may contain cell values or paths; return only a bounded category.
        result = {'error': 'SQL execution failed. Check explicit conversions, grouping and result types.', 'code': 'execution_error'}
    except Exception:
        # Do not echo database errors that can contain paths or raw cell values.
        result = {'error': 'Query worker could not initialize or complete safely.', 'code': 'worker_error'}
    print(json.dumps(result, ensure_ascii=True), flush=True)
