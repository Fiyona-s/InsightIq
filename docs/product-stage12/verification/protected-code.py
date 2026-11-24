import pathlib,json,hashlib
backup=pathlib.Path('/tmp/insightiq-stage12-backup').read_text().strip()
baseline=json.loads((pathlib.Path(backup)/'sha256.json').read_text())
checks={name:hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()==digest for name,digest in baseline.items() if name.startswith(('backend/','frontend/src/'))}
assert all(checks.values()),[p for p,v in checks.items() if not v]
pathlib.Path('docs/product-stage12/protected-code.json').write_text(json.dumps({'application_code_unchanged':True,'source_recovery':backup,'unchanged_files':checks},indent=2))
print(len(checks),'backend/frontend source files unchanged')
