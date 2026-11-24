import subprocess,json,pathlib,sys
script='''import sqlite3,pathlib,hashlib,json
root=pathlib.Path('/data')
with sqlite3.connect('file:/data/catalog.sqlite?mode=ro',uri=True) as db:
 tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
 counts={t:db.execute('SELECT COUNT(*) FROM "'+t+'"').fetchone()[0] for t in tables}
 digest=hashlib.sha256(('\\n'.join(db.iterdump())).encode()).hexdigest()
files={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file() and 'backups' not in p.relative_to(root).parts and not p.name.startswith('catalog.sqlite')}
print(json.dumps(dict(catalog_sha256=digest,counts=counts,storage_hashes=files)))'''
data=json.loads(subprocess.check_output(['docker','exec','project-api-1','python','-c',script],text=True))
path=pathlib.Path('docs/product-stage3/preservation-before.json')
if sys.argv[-1]=='after':
 before=json.loads(path.read_text());assert before==data,'Original catalog or storage changed'
 pathlib.Path('docs/product-stage3/preservation.json').write_text(json.dumps(dict(catalog_byte_values_unchanged=True,storage_files_unchanged=len(data['storage_hashes']),catalog_sha256=data['catalog_sha256'],counts=data['counts']),indent=2));print('Original catalog and',len(data['storage_hashes']),'storage hashes unchanged')
else:path.write_text(json.dumps(data,indent=2));print('Baseline captured:',data['counts']['datasets'],'datasets;',len(data['storage_hashes']),'storage hashes')
