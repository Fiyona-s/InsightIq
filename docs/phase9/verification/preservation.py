"""Read-only comparison against the initial Phase 9 full backup; v9 is allowlisted."""
import pathlib,sqlite3,json,subprocess,hashlib,datetime
backup=pathlib.Path(pathlib.Path('/tmp/phase9-backup-path').read_text().strip())
with sqlite3.connect(backup/'catalog-consistent.sqlite') as db:
    tables={r[0]:[c[1] for c in db.execute('PRAGMA table_info("'+r[0]+'")')] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    before={t:db.execute('SELECT '+','.join('"'+c+'"' for c in cols)+' FROM "'+t+'"').fetchall() for t,cols in tables.items()}
    schema=list(db.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name"))
script='''import pathlib,sqlite3,json,hashlib
root=pathlib.Path('/data')
with sqlite3.connect('file:/data/catalog.sqlite?mode=ro',uri=True) as db:
 tables=json.loads(%r)
 rows={t:db.execute('SELECT '+','.join('"'+c+'"' for c in cols)+' FROM "'+t+'"').fetchall() for t,cols in tables.items()}
 schema=list(db.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%%' ORDER BY name"))
 columns={t:[r[1] for r in db.execute('PRAGMA table_info('+t+')')] for t in tables}
 actors=list(db.execute('SELECT id,actor FROM dataset_audit'))
 formats=list(db.execute('SELECT dataset_id,revision,snapshot_format,uncompressed_size_bytes FROM dataset_revisions'))
files={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file() and 'backups' not in p.relative_to(root).parts and not p.name.startswith('catalog.sqlite')}
backups=[]
for folder in (root/'backups').glob('polish-v9-*'):
 with sqlite3.connect('file:'+str(folder/'catalog.sqlite')+'?mode=ro',uri=True) as db:
  preddl='actor' not in [r[1] for r in db.execute('PRAGMA table_info(dataset_audit)')] and 'snapshot_format' not in [r[1] for r in db.execute('PRAGMA table_info(dataset_revisions)')]
  registry=list(db.execute('SELECT version FROM schema_migrations ORDER BY version'))
 hashes={str(p.relative_to(folder/'storage')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (folder/'storage').rglob('*') if p.is_file()}
 backups.append(dict(path=str(folder),before_ddl=preddl,hashes=hashes,versions=registry))
print(json.dumps(dict(rows=rows,schema=schema,columns=columns,actors=actors,formats=formats,files=files,backups=backups)))
'''%json.dumps(tables)
current=json.loads(subprocess.check_output(['docker','exec','project-api-1','python','-c',script],text=True))
def canonical(rows):return sorted(json.dumps(list(r),sort_keys=True) for r in rows)
equal={t:canonical(rows)==canonical(current['rows'][t]) for t,rows in before.items() if t!='schema_migrations'}
assert all(equal.values()),equal
assert set(canonical(before['schema_migrations'])).issubset(canonical(current['rows']['schema_migrations']))
assert [r[0] for r in current['rows']['schema_migrations']]==list(range(1,10))
assert len(current['rows']['schema_migrations'])==len(before['schema_migrations'])+1
added={'dataset_audit':['actor'],'dataset_revisions':['snapshot_format','uncompressed_size_bytes']}
for table,cols in tables.items():assert current['columns'][table]==cols+added.get(table,[])
assert [r for r in schema if r[1] not in added]==[tuple(r) for r in current['schema'] if r[1] not in added]
assert all(actor is None for _,actor in current['actors']) and len(current['actors'])==2
assert not current['formats'],'No snapshot or provenance may be backfilled for an original dataset.'
files={str(p.relative_to(backup/'data')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (backup/'data').rglob('*') if p.is_file() and 'backups' not in p.relative_to(backup/'data').parts and not p.name.startswith('catalog.sqlite')}
assert len(files)==97 and files==current['files']
assert len(before['datasets'])==13 and len(before['analyst_runs'])==18 and len(before['dashboards'])==1
assert len(current['backups'])==1
migration=current['backups'][0];assert migration['before_ddl'] and migration['hashes']==files and migration['versions']==[[i] for i in range(1,9)]
report=dict(checked_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),manual_baseline=str(backup),fresh_pre_deployment_backup=pathlib.Path('docs/phase9/verification/pre-deployment-backup.log').read_text().strip(),automatic_pre_ddl_backup=migration['path'],automatic_backup_storage_verified=True,automatic_backup_before_actor_and_format_ddl=True,original_dataset_count=13,original_run_count=18,original_dashboard_count=1,original_dashboard_payload_byte_identical=True,original_dashboard_sha256=hashlib.sha256(before['dashboards'][0][tables['dashboards'].index('payload')].encode()).hexdigest(),original_catalog_columns_and_rows_unchanged=equal,only_added_catalog_row='schema_migrations version 9',nullable_columns_added=added,all_other_schema_objects_unchanged=True,original_audit_actors_all_null=True,new_audit_entries=0,original_snapshot_rows=0,storage_files_verified=97,storage_files_changed=[],storage_files_added=[],evaluation_jobs=len(before['evaluation_jobs']),benchmark_installs=len(before['benchmark_installs']),automl_counts={t:len(before[t]) for t in ['ml_experiments','ml_models','ml_predictions']})
pathlib.Path('docs/phase9/preservation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
