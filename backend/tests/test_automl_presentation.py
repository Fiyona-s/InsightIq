"""Read-only Phase 7 presentation: throwaway sources and local temporary models."""
import hashlib,sqlite3
from tests.test_automl import workspace,upload,regression_csv,start,finish,csv_bytes

def state(root):
    database=next(root.rglob('catalog.sqlite'))
    with sqlite3.connect(database) as db:
        catalog=list(db.iterdump())
    hashes={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file() and p.suffix not in {'.sqlite','-wal','-shm'} and not str(p).endswith(('-wal','-shm'))}
    return catalog,hashes

def test_presentation_reads_never_train_or_modify_catalog_and_artifacts(workspace,monkeypatch):
    app,c,root=workspace
    identifier=upload(c,regression_csv());job=finish(c,start(c,identifier));assert job['status']=='completed',job
    model=job['result']['selected_model_id'];batch=upload(c,csv_bytes(['x','region'],[['bad','A'],['2','B']]))
    from app.automl import service,engine,forecasting
    from sklearn.pipeline import Pipeline
    import joblib
    def forbidden(*args,**kwargs):raise AssertionError('Read path attempted training or prediction')
    monkeypatch.setattr(service.AutoMLService,'submit',forbidden)
    monkeypatch.setattr(service.AutoMLService,'predict',forbidden)
    monkeypatch.setattr(engine,'train_supervised',forbidden)
    monkeypatch.setattr(engine,'train_unsupervised',forbidden)
    monkeypatch.setattr(forecasting,'train_forecast',forbidden)
    monkeypatch.setattr(service,'run_process',forbidden)
    monkeypatch.setattr(Pipeline,'fit',forbidden)
    monkeypatch.setattr(joblib,'load',forbidden)
    before=state(root)
    hints=c.get(f'/api/automl/models/{model}/input-schema');assert hints.status_code==200,hints.text
    hints=hints.json();assert hints['source_status']=='matches recorded fingerprint'
    features={f['name']:f for f in hints['features']};assert features['region']['categories']==['A','B']
    from math import sin
    indices=job['result']['split']['train']['row_indices']
    expected=[round(sin(i)*3+i*.11,5) for i in indices]
    assert features['x']['minimum']==min(expected) and features['x']['maximum']==max(expected)
    configuration=job['configuration']
    checked=c.post('/api/automl/validate-configuration',json=configuration)
    assert checked.status_code==200 and checked.json()=={'ready':True,'reasons':[]},checked.text
    for task in ['classification','clustering','anomaly','forecasting']:
        config={**configuration,'task':task,'target':'region' if task=='classification' else None,'features':[{'name':'x','kind':'numeric'}],'rfm':None,'forecast':None}
        if task=='forecasting':config.update(features=[],forecast={'date_column':'day','measure':'amount','frequency':'day','horizon':7,'seasonal_period':7,'missing_periods':'error'})
        checked=c.post('/api/automl/validate-configuration',json=config)
        assert checked.status_code==200 and checked.json()['ready'],(task,checked.text)

    for record in [{'x':'2','region':'UNSEEN'},{'x':'','region':'A'}]:
        valid=c.post(f'/api/automl/models/{model}/validate-input',json={'records':[record]})
        assert valid.status_code==200 and valid.json()['valid'],valid.text
    bad=c.post(f'/api/automl/models/{model}/validate-input',json={'dataset_id':batch}).json()
    assert not bad['valid'] and bad['rows']==2 and bad['rejected_row_count']==1 and bad['rejected_rows'][0]['row']==1
    missing=c.post(f'/api/automl/models/{model}/validate-input',json={'records':[{'region':'A'}]}).json()
    assert not missing['valid'] and missing['rejected_rows'][0]['field']=='x'
    assert state(root)==before

def test_readonly_configuration_reports_existing_split_and_feature_blockers(workspace):
    app,c,root=workspace;identifier=upload(c,regression_csv())
    configuration={'dataset_id':identifier,'task':'regression','target':'amount','features':[{'name':'constant','kind':'categorical'}],'confirm_feature_availability':True}
    before=state(root)
    result=c.post('/api/automl/validate-configuration',json=configuration)
    assert result.status_code==200 and not result.json()['ready'] and result.json()['reasons']
    assert state(root)==before

def test_legacy_missing_split_hints_and_archived_prediction_admission(workspace):
    app,c,root=workspace;identifier=upload(c,regression_csv());job=finish(c,start(c,identifier));assert job['status']=='completed'
    model=job['result']['selected_model_id']
    # A legacy result without retained train row identities cannot claim training ranges.
    legacy=app.state.automl.store.get('MLExperiment',job['id'])
    legacy['result']['split']['train'].pop('row_indices',None)
    app.state.automl.store.save('MLExperiment',legacy)
    before=state(root);hints=c.get(f'/api/automl/models/{model}/input-schema').json()
    assert all(not f['hints_recorded'] and f['minimum'] is None and not f['categories'] for f in hints['features'])
    assert state(root)==before
    from app.main import connect
    with connect(root/(identifier+'.duckdb'),False) as db:db.execute("UPDATE records SET x='99.123' WHERE record_id='ID0000'")
    before=state(root)
    assert c.get(f'/api/automl/models/{model}/input-schema').json()['source_status']=='changed'
    assert c.post(f'/api/automl/models/{model}/validate-input',json={'records':[{'x':1,'region':'A'}]}).status_code==409
    assert state(root)==before
    assert c.post(f'/api/datasets/{identifier}/archive').status_code==200
    before=state(root)
    rejected=c.post(f'/api/automl/models/{model}/validate-input',json={'records':[{'x':1,'region':'A'}]})
    assert rejected.status_code in {409,422} and 'archiv' in rejected.text.lower()
    assert state(root)==before
