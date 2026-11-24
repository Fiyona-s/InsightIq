import tempfile,pathlib,csv,io,json,hashlib,time
from fastapi.testclient import TestClient
from app.main import create_app
from tests.test_phase3 import ControlledEmbedding
buf=io.StringIO(newline='');writer=csv.writer(buf);writer.writerow(['account','revenue','quantity','region','channel','day','product','customer','discount','cost','status','note'])
for i in range(2400):writer.writerow([str(i+1).zfill(6),f'{100+(i%1000)}.50',str(1+i%5),['East','West','North','South'][i%4],['Online','Store'][i%2],f'2026-01-{i%28+1:02}',f'P{i%40:03}',f'C{i%300:03}',str(i%10),f'{60+i%500}.25','Recognized',f'Controlled row {i+1}'])
raw=buf.getvalue().encode();start=time.monotonic()
with tempfile.TemporaryDirectory(prefix='phase4-size-verification-') as folder:
 root=pathlib.Path(folder)
 with TestClient(create_app(root,embedder=ControlledEmbedding())) as c:
  result=c.post('/api/datasets',files={'file':('SYNTHETIC-retail-size-verification.csv',raw)});assert result.status_code==201,result.text
  identifier=result.json()['id'];url='/api/datasets/'+identifier
  initial=c.get(url+'/rows').json();rid=initial['rows'][0]['id']
  for version in range(1,20):
   saved=c.post(url+'/edits',json={'expected_version':version,'updates':[{'id':rid,'values':{'revenue':f'{200+version}.50'}}]});assert saved.status_code==200,saved.text
  history=c.get(url+'/revisions').json();files=list((root/'revisions'/identifier).glob('*.duckdb.gz'))
  assert len(files)==20 and all(r['status']=='available' for r in history['revisions'])
  assert all(hashlib.sha256(__import__('gzip').decompress((root/'revisions'/identifier/(str(r['revision'])+'.duckdb.gz')).read_bytes())).hexdigest()==r['sha256'] for r in history['revisions'])
  uncompressed=sum(r['uncompressed_size_bytes'] for r in history['revisions'])
  evidence=dict(uncompressed_bytes_same_snapshots=uncompressed,uncompressed_mib=round(uncompressed/1048576,3),phase4_prior_measured_bytes=63422464,dataset='disposable synthetic retail-shaped data, not original customer rows',rows=2400,columns=12,csv_bytes=len(raw),revisions=20,snapshot_limit=history['snapshot_limit'],snapshot_bytes=history['snapshot_bytes'],snapshot_mib=round(history['snapshot_bytes']/1048576,3),smallest_snapshot_bytes=min(p.stat().st_size for p in files),largest_snapshot_bytes=max(p.stat().st_size for p in files),live_duckdb_bytes=(root/(identifier+'.duckdb')).stat().st_size,all_snapshot_hashes_verified=True,live_ai_calls=0,elapsed_seconds=round(time.monotonic()-start,2))
pathlib.Path('docs/phase9/compression-measurement.json').write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence,indent=2))
