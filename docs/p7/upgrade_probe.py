"""Read-only fingerprint of a workspace folder mounted at /data: per catalog table (row count + hash of its rows),
the schema registry, and the sha256 of every other file. Used to compare the real workspace before and after the upgrade."""
import hashlib, json, os, sqlite3, sys
root = sys.argv[1] if len(sys.argv) > 1 else '/data'
out = {'tables': {}, 'registry': [], 'files': {}, 'integrity': None}
cat = os.path.join(root, 'catalog.sqlite')
con = sqlite3.connect('file:%s?mode=ro' % cat, uri=True)
out['integrity'] = con.execute('PRAGMA integrity_check').fetchone()[0]
for (name,) in con.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").fetchall():
    rows = sorted(repr(r) for r in con.execute('select * from "%s"' % name))
    out['tables'][name] = {'count': len(rows), 'sha256': hashlib.sha256('\n'.join(rows).encode()).hexdigest()}
if 'schema_migrations' in out['tables']:
    out['registry'] = sorted(r[0] for r in con.execute('select version from schema_migrations'))
con.close()
for d, _, fs in os.walk(root):
    for f in sorted(fs):
        p = os.path.join(d, f); rel = os.path.relpath(p, root)
        if rel.startswith('catalog.sqlite'): continue
        h = hashlib.sha256()
        with open(p, 'rb') as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b''): h.update(chunk)
        out['files'][rel] = h.hexdigest()
try:
    import duckdb
    bad = []
    for rel in out['files']:
        if rel.endswith('.duckdb'):
            try:
                c = duckdb.connect(os.path.join(root, rel), read_only=True); c.execute('select count(*) from information_schema.tables').fetchone(); c.close()
            except Exception as e: bad.append(rel + ': ' + str(e)[:80])
    out['duckdb_unreadable'] = bad
except ImportError:
    out['duckdb_unreadable'] = 'duckdb not available'
print(json.dumps(out, sort_keys=True))
