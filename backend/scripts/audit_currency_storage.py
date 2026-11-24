"""Read-only artifact and original snapshot/run hashes for a local currency audit."""
import hashlib
import json
import sqlite3
from pathlib import Path
root = Path('/data')
paths = sorted({*root.rglob('*.duckdb'), *(p for p in (root/'automl'/'models').rglob('*') if p.is_file())})
result = {'files': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths if p.is_file()}}
with sqlite3.connect('file:/data/catalog.sqlite?mode=ro', uri=True) as db:
    result['historical_runs'] = {row[0]: hashlib.sha256(row[1].encode()).hexdigest() for row in db.execute('SELECT id, payload FROM analyst_runs')}
    result['saved_raw_snapshots'] = {}
    for identifier, payload in db.execute('SELECT id, payload FROM saved_charts'):
        data = json.loads(payload)
        raw = {'snapshot':data['snapshot'],'sql':data['sql'],'source_run_id':data['source_run_id']}
        result['saved_raw_snapshots'][identifier] = hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest()
print(json.dumps(result, sort_keys=True))
