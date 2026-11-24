"""Standalone controlled measurement; never opens the production data directory."""
import json,sqlite3,tempfile,sys,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'backend'))
from fastapi.testclient import TestClient
from app.main import create_app
from tests.test_phase3 import ControlledEmbedding,SequenceProvider
from tests.test_analyst import submit,finish

results=[]
for kind,sql in [('kpi','SELECT SUM(revenue) AS total FROM data'),('bar','SELECT category,SUM(revenue) AS total FROM data GROUP BY category ORDER BY category')]:
    with tempfile.TemporaryDirectory(prefix='phase6-history-measurement-') as directory:
        root=Path(directory);provider=SequenceProvider([sql])
        raw='id,revenue,category,day,customer,channel,units,price,discount,tax,region,note\n'+''.join(f'{i:04},{i+0.25},Category {i%12},2026-11-01,C{i%100},web,2,10,0,1,North,controlled\n' for i in range(2400))
        with TestClient(create_app(root,provider=provider,embedder=ControlledEmbedding())) as c:
            identifier=c.post('/api/datasets',files={'file':('synthetic-retail-size-measurement.csv',raw.encode())}).json()['id']
            run=finish(c,submit(c,identifier,mapping={'revenue':'DOUBLE'},question='Controlled history measurement'));assert run['status']=='succeeded'
            chart=c.post('/api/saved-charts',json={'run_id':run['id'],'title':'Controlled revenue','spec':{'kind':kind,'x':0 if kind=='bar' else None,'y':1 if kind=='bar' else 0},'persist_snapshot_confirmed':True}).json()
            doc=c.post('/api/dashboards',json={'title':'Disposable measurement'}).json()
            doc=c.post('/api/dashboards/'+doc['id']+'/charts',json={'chart_id':chart['id'],'revision':1}).json()['dashboard']
            source_before=hashlib.sha256((root/(identifier+'.duckdb')).read_bytes()).hexdigest()
            before=(root/'catalog.sqlite').stat().st_size
            with sqlite3.connect(root/'catalog.sqlite') as db:baseline_audits=db.execute('SELECT COUNT(*) FROM dataset_audit').fetchone()[0]
            for _ in range(6):
                r=c.post('/api/dashboards/'+doc['id']+'/widgets/'+doc['widgets'][0]['id']+'/refresh',json={'confirm_refresh':True,'revision':doc['revision']});assert r.status_code==200,r.text;doc=r.json()
            with sqlite3.connect(root/'catalog.sqlite') as db:
                sizes=[r[0] for r in db.execute('SELECT LENGTH(CAST(payload AS BLOB)) FROM dashboard_widget_snapshots ORDER BY generation DESC')]
                audits=db.execute('SELECT COUNT(*) FROM dataset_audit').fetchone()[0]-baseline_audits
            assert len(sizes)==4 and len(provider.calls)==1
            assert hashlib.sha256((root/(identifier+'.duckdb')).read_bytes()).hexdigest()==source_before
            results.append(dict(chart_type=kind,source_rows=2400,source_columns=12,source_csv_bytes=len(raw.encode()),result_rows=doc['widgets'][0]['result']['row_count'],refreshes=6,retained_prior=3,current_snapshot_records=1,retained_records=4,record_payload_bytes=sizes,total_snapshot_payload_bytes=sum(sizes),prior_snapshot_payload_bytes=sum(sizes[1:]),catalog_allocated_growth_bytes=(root/'catalog.sqlite').stat().st_size-before,refresh_audits=audits,model_generation_calls=1,model_calls_for_refresh=0,original_source_bytes_unchanged=True))
Path('docs/phase6/history-disk-impact.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
