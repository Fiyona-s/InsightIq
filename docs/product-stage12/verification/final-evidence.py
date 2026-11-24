from pathlib import Path
import hashlib,json,re
out=Path('docs/product-stage12')
checks={
 'frontend':('frontend.log','197 passed'),
 'backend':('backend.log','361 passed'),
 'browser':('browser-final.log','49 passed'),
 'smoke':('smoke.log','1 passed'),
 'focused_visual':('visual-focused-final.log','1 passed'),
 'focused_model_capture':('model-screenshot-final.log','1 passed'),
}
for name,(file,expected) in checks.items():
 assert expected in (out/'verification'/file).read_text(),(name,expected)
visual=json.loads((out/'visual-review.json').read_text());assert len(visual['checks'])==30
assert not visual['pageErrors'] and not visual['mutatingRequests']
assert all(not row['overflow'] and not row['axeViolations'] for row in visual['checks'])
live=json.loads((out/'live-readonly-review.json').read_text());assert not live['writes'] and not live['errors']
assert json.loads((out/'protected-code.json').read_text())['application_code_unchanged']
preservation=json.loads((out/'preservation.json').read_text());assert preservation['storage_files_unchanged']==102
backup=Path('/tmp/insightiq-stage12-backup').read_text().strip();baseline=json.loads((Path(backup)/'sha256.json').read_text());changed=[name for name,digest in baseline.items() if Path(name).exists() and hashlib.sha256(Path(name).read_bytes()).hexdigest()!=digest]
(out/'changed-files.json').write_text(json.dumps({'baseline_frontend_backend_files_changed':changed,'new_files':['frontend/e2e/16-product-stage12-final.spec.ts','frontend/scripts/product-stage12-readonly-review.mjs'],'documentation':['README.md','docs/PRODUCT_UX_AUDIT.md','docs/PRODUCT_STAGE12_REVIEW.md','docs/product-stage12/'],'note':'Existing screenshot outputs can be refreshed by the regression suites.'},indent=2))
report=Path('docs/PRODUCT_STAGE12_REVIEW.md');missing=[link for link in re.findall(r'\]\(([^)]+)\)',report.read_text()) if not link.startswith(('http','/')) and not (report.parent/link).exists()];assert missing in ([],['product-stage12/final-evidence.json']),missing
(out/'final-evidence.json').write_text(json.dumps({'tests':{'frontend':197,'backend':361,'browser':49,'smoke':1,'focused_visual':1,'focused_model_capture':1},'visual_checks':30,'axe_violations':0,'page_errors':0,'original_workspace_mutations':0,'original_storage_hashes_unchanged':102,'all_report_links_resolve':True,'application_source_changed':False},indent=2));print('Final evidence verified')
