"""Prints a JSON fingerprint of a company's data folder: every file's size and SHA-256, plus a hash of the catalog's CONTENT
(its SQL dump, read from a private copy so the original is never opened for writing). Used by the restore drill to prove that a
restored volume is identical to the one that was backed up. Read-only; prints no secret and no row data, only hashes.
    python volume_fingerprint.py /data"""
import hashlib
import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path


def file_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def catalog_hash(root):
    source = root / 'catalog.sqlite'
    if not source.is_file():
        return None
    with tempfile.TemporaryDirectory() as tmp:
        for suffix in ('', '-wal', '-shm'):
            if (root / ('catalog.sqlite' + suffix)).is_file():
                shutil.copy2(root / ('catalog.sqlite' + suffix), Path(tmp) / ('catalog.sqlite' + suffix))
        db = sqlite3.connect(Path(tmp) / 'catalog.sqlite')
        try:
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                return 'INTEGRITY-CHECK-FAILED'
            h = hashlib.sha256()
            for line in db.iterdump():
                h.update(line.encode('utf-8') + b'\n')
            return h.hexdigest()
        finally:
            db.close()


def main(argv):
    root = Path(argv[1]).resolve()
    files = {}
    for path in sorted(root.rglob('*')):
        if path.is_file():
            files[str(path.relative_to(root))] = [path.stat().st_size, file_hash(path)]
    print(json.dumps({'files': files, 'file_count': len(files), 'catalog_content_sha256': catalog_hash(root)}, sort_keys=True))


if __name__ == '__main__':
    main(sys.argv)
