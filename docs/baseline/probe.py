import sqlite3,pathlib,hashlib,json
root=pathlib.Path('/data')
db=sqlite3.connect('file:/data/catalog.sqlite?mode=ro',uri=True)
tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
counts={t:db.execute('SELECT COUNT(*) FROM "'+t+'"').fetchone()[0] for t in tables}
catalog_digest=hashlib.sha256(('\n'.join(db.iterdump())).encode()).hexdigest()
dash=[]
for i,p in db.execute('SELECT id,payload FROM dashboards ORDER BY id'):
    try: title=json.loads(p).get('title') or json.loads(p).get('name')
    except Exception: title=None
    dash.append(dict(id=i,title=title,payload_sha256=hashlib.sha256(p.encode()).hexdigest()))
migr=[r[0] for r in db.execute('SELECT version FROM schema_migrations ORDER BY version')]
db.close()
files={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*')) if p.is_file() and 'backups' not in p.relative_to(root).parts and not p.name.startswith('catalog.sqlite')}
backups=sorted(str(p.relative_to(root)) for p in (root/'backups').iterdir()) if (root/'backups').exists() else []
cat_file=hashlib.sha256((root/'catalog.sqlite').read_bytes()).hexdigest()
print(json.dumps(dict(counts=counts,catalog_logical_sha256=catalog_digest,catalog_file_sha256=cat_file,schema_versions=migr,dashboards=dash,storage_file_count=len(files),storage_hashes=files,backup_dirs=backups),indent=1))
