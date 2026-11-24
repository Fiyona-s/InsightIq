import pathlib,sqlite3,json,subprocess,hashlib,datetime
backup=pathlib.Path(pathlib.Path('/tmp/phase7-backup-path').read_text())
with sqlite3.connect(backup/'catalog-consistent.sqlite') as db:
 tables={r[0]:[c[1] for c in db.execute('PRAGMA table_info("'+r[0]+'")')] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
 before={t:db.execute('SELECT '+','.join('"'+c+'"' for c in cols)+' FROM "'+t+'"').fetchall() for t,cols in tables.items()}
 old_schema=list(db.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name"))
script='''import pathlib,sqlite3,json,hashlib
root=pathlib.Path('/data')
with sqlite3.connect('file:/data/catalog.sqlite?mode=ro',uri=True) as db:
 tables=json.loads(%r)
 rows={t:db.execute('SELECT '+','.join('"'+c+'"' for c in cols)+' FROM "'+t+'"').fetchall() for t,cols in tables.items()}
 schema=list(db.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%%' ORDER BY name"))
 versions=[r[0] for r in db.execute('SELECT version FROM schema_migrations ORDER BY version')]
 revisions=list(db.execute('SELECT dataset_id,revision FROM dataset_revisions'))
 review_counts={t:db.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['knowledge_drafts','knowledge_review_examples','dashboard_widget_snapshots']}
files={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file() and 'backups' not in p.relative_to(root).parts and not p.name.startswith('catalog.sqlite')}
backups=[]
for folder in (root/'backups').glob('dashboards-v8-*'):
 with sqlite3.connect('file:'+str(folder/'catalog.sqlite')+'?mode=ro',uri=True) as db:
  preddl=not db.execute("SELECT 1 FROM sqlite_master WHERE name='dashboard_widget_snapshots'").fetchone()
 hashes={str(p.relative_to(folder/'storage')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (folder/'storage').rglob('*') if p.is_file()}
 backups.append(dict(path=str(folder),before_revision_ddl=preddl,hashes=hashes))
print(json.dumps(dict(rows=rows,schema=schema,versions=versions,revisions=revisions,review_counts=review_counts,files=files,backups=backups)))
'''%json.dumps(tables)
current=json.loads(subprocess.check_output(['docker','exec','project-api-1','python','-c',script],text=True))
def canonical(rows):return sorted(json.dumps(list(row),sort_keys=True) for row in rows)
equal={t:canonical(rows)==canonical(current['rows'][t]) for t,rows in before.items() }
assert all(equal.values()),equal
assert set(canonical(before['schema_migrations'])).issubset(canonical(current['rows']['schema_migrations']))
assert current['versions']==[1,2,3,4,5,6,7,8]
assert old_schema==[tuple(r) for r in current['schema']]
files={str(p.relative_to(backup/'data')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (backup/'data').rglob('*') if p.is_file() and 'backups' not in p.relative_to(backup/'data').parts and not p.name.startswith('catalog.sqlite')}
assert files==current['files'],'Original storage must be exactly unchanged.'
assert len(before['datasets'])==13 and len(before['analyst_runs'])==18 and len(before['dashboards'])==1
assert len(files)==97 and len(before['dataset_audit'])==2
assert current['review_counts']=={'knowledge_drafts':0,'knowledge_review_examples':0,'dashboard_widget_snapshots':0},'No original knowledge review writes are permitted.'
assert not current['revisions'],'No snapshot may be captured for an original dataset.'
assert len(current['backups'])==1
migration_backup=current['backups'][0];assert migration_backup['before_revision_ddl'] and migration_backup['hashes']==files
report=dict(original_dashboard_payload_byte_identical=True,checked_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),manual_backup=str(backup),automatic_pre_ddl_backup_created_this_phase=None,retained_phase6_automatic_backup=migration_backup['path'],automatic_backup_original_storage_verified=True,original_dataset_count=13,original_run_count=18,original_dashboard_count=1,preexisting_catalog_tables_unchanged=equal,original_schema_objects_unchanged=True,added_tables=[],migration_versions=current['versions'],original_storage_files_checked=97,original_storage_files_changed=[],added_nonbackup_storage_files=[],original_revision_snapshot_rows=0,original_knowledge_review_rows=current['review_counts'],preexisting_lifecycle_audit_entries=2,new_lifecycle_entries_on_originals=0)
report['original_dashboard_payload_sha256']=hashlib.sha256(before['dashboards'][0][tables['dashboards'].index('payload')].encode()).hexdigest()
report['original_automl_counts']={name:len(before[name]) for name in ['ml_experiments','ml_models','ml_predictions']}
pathlib.Path('docs/phase7/preservation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
