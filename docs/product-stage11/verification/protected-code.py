import pathlib,json,hashlib
root=pathlib.Path('.')
backup=pathlib.Path('/tmp/insightiq-stage11-backup').read_text().strip()
baseline=json.loads((pathlib.Path(backup)/'sha256.json').read_text())
addition='<p>Sensitive values in questions, definitions, approved examples, SQL/error context or computed results can reach the provider. No automatic masking is applied.</p>'
checks={}
for name,digest in baseline.items():
 if not (name.startswith('backend/') or name.startswith('frontend/src/')):continue
 data=pathlib.Path(name).read_bytes()
 if name=='frontend/src/components/Analyst.tsx':
  assert data.count(addition.encode())==1
  data=data.replace(addition.encode(),b'')
 checks[name]=hashlib.sha256(data).hexdigest()==digest
assert all(checks.values()),[p for p,v in checks.items() if not v]
output={'only_application_change':'One paragraph inside the existing Analyst Data sharing disclosure','reversing_disclosure_restores_original_Analyst_bytes':True,'unchanged_or_exactly_reconstructed_files':checks,'source_recovery':backup}
pathlib.Path('docs/product-stage11/protected-code.json').write_text(json.dumps(output,indent=2))
print(len(checks),'backend/frontend source files match, with the single paragraph reversed for Analyst')
