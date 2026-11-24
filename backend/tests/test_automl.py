"""Actual local ML/SQL integration with no LLM or embedding inference."""
import copy,csv,hashlib,io,json,math,threading,time
from datetime import datetime,timedelta
from pathlib import Path
from uuid import uuid4
import numpy as np
import pytest
from fastapi.testclient import TestClient
from app.main import create_app,connect
from app.automl.data import profile,validate_features,MLFailure,read_dataset
from app.automl.preprocessing import preprocessor
from app.automl.engine import supervised_split,reg_metrics,cls_metrics
from app.automl.forecasting import ForecastModel,aggregate,train_forecast,metrics
from app.automl.process import run_process

class NoProvider:
    model='NO-PROVIDER-ALLOWED'
    def generate(self,*args,**kwargs):pytest.fail('AutoML called a provider.')
    def narrate(self,*args,**kwargs):pytest.fail('AutoML called a provider.')
class NoEmbeddings:
    identity='NO-EMBEDDINGS-ALLOWED'
    def encode(self,*args,**kwargs):pytest.fail('AutoML called embeddings.')

def csv_bytes(header,rows):
    s=io.StringIO();w=csv.writer(s);w.writerow(header);w.writerows(rows);return s.getvalue().encode()
def upload(c,raw):
    r=c.post('/api/datasets',files={'file':('SYNTHETIC-AutoML-FIXTURE.csv',raw)})
    assert r.status_code==201,r.text
    return r.json()['id']
@pytest.fixture
def workspace(tmp_path,monkeypatch):
    monkeypatch.setenv('LLM_API_KEY','PRIVATE-TEST-DO-NOT-INHERIT')
    app=create_app(tmp_path,provider=NoProvider(),embedder=NoEmbeddings())
    with TestClient(app) as client:yield app,client,tmp_path

def regression_csv(n=120):
    return csv_bytes(['record_id','x','region','day','amount','target_copy','future_outcome','constant'],[[f'ID{i:04}',round(math.sin(i)*3+i*.11,5),'A' if i%2 else 'B',(datetime(2026,1,1)+timedelta(days=i)).isoformat(),round((math.sin(i)*3+i*.11)*2.5+(i%2)*3,5),round((math.sin(i)*3+i*.11)*2.5+(i%2)*3,5),i,'fixed'] for i in range(n)])

def start(c,identifier,task='regression',**extra):
    body={'dataset_id':identifier,'task':task,'target':'amount' if task in {'regression','classification'} else None,'features':[{'name':'x','kind':'numeric'},{'name':'region','kind':'categorical'}] if task!='anomaly' else [{'name':'x','kind':'numeric'}],'confirm_feature_availability':True,**extra}
    r=c.post('/api/automl/experiments',json=body);assert r.status_code==202,r.text
    return r.json()
def finish(c,job):
    deadline=time.monotonic()+45
    while time.monotonic()<deadline:
        job=c.get('/api/automl/experiments/'+job['id']).json()
        if job['status'] in {'completed','failed','cancelled'}:return job
        time.sleep(.05)
    pytest.fail('ML job did not finish within integration deadline.')


def test_profiling_readiness_types_duplicates_missing_target_and_leakage(workspace):
    app,c,root=workspace
    data=regression_csv();identifier=upload(c,data)
    p=c.get(f'/api/automl/datasets/{identifier}/profile?task=regression&target=amount').json()
    by={v['name']:v for v in p['columns']}
    assert p['readiness']['ready'] and p['sampled_rows']==p['total_rows']==120
    assert by['x']['kind']=='numeric' and by['day']['kind']=='datetime' and by['region']['kind']=='categorical'
    assert by['record_id']['potential_identifier'] and by['target_copy']['potential_leakage'] and by['future_outcome']['potential_leakage'] and by['constant']['constant']
    assert p['target_distribution']['observed']==120
    duplicate=upload(c,csv_bytes(['a','b'],[['1',''],['1',''],['2','bad']]))
    p=c.get(f'/api/automl/datasets/{duplicate}/profile?task=regression&target=b').json()
    assert not p['readiness']['ready'] and p['duplicate_rows']==1
    assert next(v for v in p['columns'] if v['name']=='b')['missing']==2
    codes=upload(c,csv_bytes(['account','measurement'],[[str(i).zfill(5),math.sin(i)] for i in range(40)]))
    codes_profile=c.get(f'/api/automl/datasets/{codes}/profile?task=clustering').json()
    code=next(v for v in codes_profile['columns'] if v['name']=='account')
    assert code['kind']=='categorical' and code['potential_identifier']
    assert c.get('/api/automl/datasets/'+str(uuid4())+'/profile').status_code==404


def test_train_only_pipeline_unknown_category_date_and_missing_values():
    specs=[{'name':'n','kind':'numeric'},{'name':'c','kind':'categorical'},{'name':'d','kind':'datetime'}]
    prepare=preprocessor(specs,'robust')
    train=np.array([['1','A','2026-01-01'],['3','B',None],[None,'A','2026-02-01']],dtype=object)
    transformed=prepare.fit_transform(train)
    numeric=prepare.named_transformers_['numeric']
    assert numeric.named_steps['impute'].statistics_[0]==2
    assert numeric.named_steps['scale'].center_[0]==2
    assert list(prepare.named_transformers_['categorical'].named_steps['encode'].categories_[0])==['A','B']
    future=prepare.transform(np.array([['10000','UNSEEN','2027-01-01']],dtype=object))
    assert future.shape[1]==transformed.shape[1]
    assert numeric.named_steps['impute'].statistics_[0]==2
    assert future[0,0]>1000


def test_duplicate_safe_splits_and_stratification():
    x=np.array([[f'v{i//2}',str(i%5)] for i in range(120)],dtype=object);x[1::2]=x[::2]
    y=np.array([str((i//2)%3) for i in range(120)])
    for task in ['regression','classification']:
        tr,va,te,groups=supervised_split(x,y,task,42)
        assert not(set(groups[tr])&set(groups[va]) or set(groups[tr])&set(groups[te]) or set(groups[va])&set(groups[te]))
        if task=='classification':assert set(y[tr])==set(y[va])==set(y[te])==set(y)
        assert np.array_equal(tr,supervised_split(x,y,task,42)[0])
    with pytest.raises(MLFailure):supervised_split(np.array([['same']]*120,dtype=object),y,'classification',42)


def test_real_regression_registry_prediction_persistence_and_input_validation(workspace,monkeypatch):
    app,c,root=workspace;identifier=upload(c,regression_csv())
    from app.automl import process
    popen=process.subprocess.Popen;seen=[]
    def protected(*args,**kwargs):
        assert 'LLM_API_KEY' not in kwargs.get('env',{})
        seen.append(True);return popen(*args,**kwargs)
    monkeypatch.setattr(process.subprocess,'Popen',protected)
    job=finish(c,start(c,identifier))
    assert job['status']=='completed',job
    result=job['result'];assert len(result['leaderboard'])==5
    assert {r['algorithm'] for r in result['leaderboard']}=={'DummyRegressor','LinearRegression','Ridge','RandomForestRegressor','HistGradientBoostingRegressor'}
    assert sum(r['test_metrics'] is not None for r in result['leaderboard'])==1
    assert all(r['validation_metrics'] is not None for r in result['leaderboard'])
    selected=next(r for r in result['leaderboard'] if r['selected']);assert selected['test_metrics']['rmse']<1
    assert result['split']['train']['count']+result['split']['validation']['count']+result['split']['test']['count']==120
    model_id=result['selected_model_id'];model=c.get('/api/automl/models/'+model_id).json()
    assert model['dataset_fingerprint']==job['dataset_fingerprint'] and model['versions']['sklearn']=='1.6.1'
    assert (root/model['artifact_path']).exists() and seen
    prediction=c.post('/api/automl/models/'+model_id+'/predict',json={'records':[{'x':'2.5','region':'A'}]})
    assert prediction.status_code==200,prediction.text
    prediction=prediction.json();assert math.isfinite(prediction['rows'][0]['prediction'])
    exported=c.get('/api/automl/predictions/'+prediction['id']+'/export.csv')
    assert exported.status_code==200 and 'prediction' in exported.text
    for records in [[{'x':1}],[{'x':'not numeric','region':'A'}],[{'x':1,'region':'A','extra':1}],[{'x':{'__reduce__':'bad'},'region':'A'}]]:
        assert c.post('/api/automl/models/'+model_id+'/predict',json={'records':records}).status_code==422
    batch=c.post('/api/automl/models/'+model_id+'/predict',json={'dataset_id':identifier})
    assert batch.status_code==200,batch.text
    assert batch.json()['row_count']==120 and len(batch.json()['rows'])==50 and 'not held-out' in batch.json()['scope']
    assert len(c.get('/api/automl/predictions/'+batch.json()['id']+'?offset=50').json()['rows'])==50
    # Registry and prediction survive an application restart; no retraining.
    with TestClient(create_app(root,provider=NoProvider(),embedder=NoEmbeddings())) as fresh:
        again=fresh.post('/api/automl/models/'+model_id+'/predict',json={'records':[{'x':'2.5','region':'A'}]})
        assert again.status_code==200 and again.json()['rows']==prediction['rows']
        assert fresh.get('/api/automl/experiments/'+job['id']).json()['status']=='completed'
    # A source data change invalidates inference, even if schema remains identical.
    with connect(root/(identifier+'.duckdb'),False) as db:db.execute("UPDATE records SET x='99.123' WHERE record_id='ID0000'")
    assert c.post('/api/automl/models/'+model_id+'/predict',json={'records':[{'x':1,'region':'A'}]}).status_code==409


@pytest.mark.parametrize('classes',[2,3])
def test_real_binary_and_multiclass_training(workspace,classes):
    app,c,root=workspace
    rows=[[round(math.sin(i)*5+i*.071,5),'A' if i%2 else 'B',str(i%classes)] for i in range(150)]
    identifier=upload(c,csv_bytes(['x','region','amount'],rows))
    job=finish(c,start(c,identifier,'classification'))
    assert job['status']=='completed',job
    assert len(job['result']['leaderboard'])==4
    selected=next(r for r in job['result']['leaderboard'] if r['selected']);m=selected['test_metrics']
    assert all(0<=m[k]<=1 for k in ['accuracy','precision_macro','recall_macro','f1_macro','roc_auc'])
    assert len(job['result']['details']['confusion_matrix'])==classes
    pred=c.post('/api/automl/models/'+selected['model_id']+'/predict',json={'records':[{'x':'2.5','region':'UNKNOWN'}]})
    assert pred.status_code==200,pred.text
    assert len(pred.json()['rows'][0]['probabilities'])==classes
    assert abs(sum(pred.json()['rows'][0]['probabilities'].values())-1)<1e-10


def test_kmeans_rfm_pca_and_customer_batch_prediction(workspace):
    app,c,root=workspace
    rows=[]
    for i in range(30):
        for j in range(3):rows.append([f'C{i:03}',f'O{i:03}-{j}','2026-01-'+str(1+i%20).zfill(2),10+i*2+j])
    identifier=upload(c,csv_bytes(['customer_id','order_id','order_date','net_revenue_inr'],rows))
    cfg={'customer':'customer_id','date':'order_date','amount':'net_revenue_inr','order':'order_id','reference_date':'2026-02-01'}
    job=finish(c,start(c,identifier,'clustering',features=[],rfm=cfg))
    assert job['status']=='completed',job
    r=job['result'];assert r['rows_used']==30
    assert sum(p['count'] for p in r['details']['cluster_profiles'])==30
    assert all(p['features']['frequency']==3 for p in r['details']['cluster_profiles'])
    assert r['details']['reference_date'].startswith('2026-02-01')
    assert -1<=r['leaderboard'][0]['training_metrics']['silhouette']<=1
    model=c.get('/api/automl/models/'+r['selected_model_id']).json()
    assert all('customer' not in f['name'] for f in model['feature_schema'])
    pred=c.post('/api/automl/models/'+model['id']+'/predict',json={'dataset_id':identifier})
    assert pred.status_code==200,pred.text
    assert pred.json()['row_count']==30 and 'customer' in pred.json()['rows'][0] and 'cluster_profile' in pred.json()['rows'][0]
    assert 'PCA' in r['details']['pca_note'] and len(r['plots']['clusters'])==30


def test_isolation_forest_real_scores_distribution_and_no_fraud_claim(workspace):
    app,c,root=workspace
    identifier=upload(c,csv_bytes(['x'],[[round(math.sin(i)+i*.003,6)] for i in range(90)]+[[1000]]))
    job=finish(c,start(c,identifier,'anomaly'))
    assert job['status']=='completed',job
    r=job['result'];assert r['details']['fraud_accuracy'] is None
    assert sum(b['count'] for b in r['plots']['anomaly_distribution'])==91
    assert 'not ground-truth fraud' in r['scope']
    pred=c.post('/api/automl/models/'+r['selected_model_id']+'/predict',json={'records':[{'x':1000}]})
    assert pred.status_code==200 and pred.json()['rows'][0]['anomaly'] is True


def test_chronological_forecast_baselines_backtests_and_horizon_validation(workspace):
    app,c,root=workspace
    rows=[[(datetime(2025,1,1)+timedelta(days=i)).isoformat(),round(100+math.sin(i*2*math.pi/7)*10+i*.1,4)] for i in range(100)]
    identifier=upload(c,csv_bytes(['order_date','net_revenue_inr'],rows))
    cfg={'date_column':'order_date','measure':'net_revenue_inr','horizon':7,'frequency':'day','missing_periods':'error','seasonal_period':7}
    job=finish(c,start(c,identifier,'forecasting',features=[],forecast=cfg))
    assert job['status']=='completed',job
    r=job['result'];assert {c['algorithm'] for c in r['leaderboard']}=={'Naive','SeasonalNaive','LagRidge'}
    assert r['split']['test_never_used_for_selection'] and r['split']['test_origin']==93
    assert all(b['train_end']<b['evaluation_start'] for b in r['details']['backtests'])
    assert sum(c['test_metrics'] is not None for c in r['leaderboard'])==1
    predicted=c.post('/api/automl/models/'+r['selected_model_id']+'/predict',json={'horizon':7})
    assert predicted.status_code==200 and predicted.json()['row_count']==7
    assert predicted.json()['rows'][0]['date']>'2025-04-10'
    assert c.post('/api/automl/models/'+r['selected_model_id']+'/predict',json={'horizon':8}).status_code==422


def test_forecast_gaps_history_zero_wape_and_past_only_lags():
    data={'columns':['date','value'],'rows':[['2026-01-01','10'],['2026-01-03','20']]}
    spec={'date_column':'date','measure':'value','frequency':'day','missing_periods':'error'}
    with pytest.raises(MLFailure):aggregate(data,spec)
    dates,y,imputed=aggregate(data,{**spec,'missing_periods':'zero'});assert y.tolist()==[10,0,20]
    _,y,_=aggregate(data,{**spec,'missing_periods':'forward_fill'});assert y.tolist()==[10,10,20]
    assert metrics(np.array([0.,0.]),np.array([1.,2.]))['wape'] is None
    history=np.arange(50,dtype=float)+np.sin(np.arange(50));a=ForecastModel('LagRidge',7).fit(history)
    p=a.forecast(5);assert len(p)==5 and np.isfinite(p).all()
    assert a.history_==history.tolist()  # recursive inference does not mutate fitted history


def test_request_feature_cardinality_size_and_rare_class_limits(workspace):
    app,c,root=workspace;identifier=upload(c,regression_csv())
    for feature in ['record_id','target_copy','future_outcome','constant','amount']:
        r=c.post('/api/automl/experiments',json={'dataset_id':identifier,'task':'regression','target':'amount','features':[{'name':feature,'kind':'numeric'}],'confirm_feature_availability':True})
        assert r.status_code==422,r.text
    assert c.post('/api/automl/experiments',json={'dataset_id':identifier,'task':'regression','target':'amount','features':[{'name':'x','kind':'numeric'}],'confirm_feature_availability':False}).status_code==422
    assert c.post('/api/automl/experiments',json={'dataset_id':identifier,'task':'anomaly','target':'amount','features':[{'name':'x','kind':'numeric'}],'confirm_feature_availability':True,'python':'import os'}).status_code==422
    big=upload(c,csv_bytes(['x','amount'],[[i*.127+math.sin(i),i*.3] for i in range(5001)]))
    assert c.get(f'/api/automl/datasets/{big}/profile?task=regression&target=amount').json()['sampled']
    assert c.post('/api/automl/experiments',json={'dataset_id':big,'task':'regression','target':'amount','features':[{'name':'x','kind':'numeric'}],'confirm_feature_availability':True}).status_code==422
    rare=upload(c,csv_bytes(['x','amount'],[[i*.17,'minority' if i<3 else 'majority'] for i in range(100)]))
    p=c.get(f'/api/automl/datasets/{rare}/profile?task=classification&target=amount').json();assert not p['readiness']['ready']


def test_cancellation_concurrency_dataset_delete_and_timeout(workspace,monkeypatch):
    app,c,root=workspace;identifier=upload(c,regression_csv());entered=threading.Event()
    from app.automl import service
    def blocked(payload,directory,cancel,**kwargs):
        entered.set();assert cancel.wait(5);raise MLFailure('Cancelled test.','cancelled')
    monkeypatch.setattr(service,'run_process',blocked)
    j=start(c,identifier);assert entered.wait(5)
    response=c.post('/api/automl/experiments',json=j['configuration']);assert response.status_code==429
    assert c.delete('/api/datasets/'+identifier).status_code==409
    assert c.post('/api/automl/experiments/'+j['id']+'/cancel').status_code==200
    assert finish(c,j)['status']=='cancelled'
    # Actual subprocess boundary enforces deadline; fixture never reaches algorithms.
    with pytest.raises(MLFailure) as failure:run_process({'operation':'invalid'},root/'deadline-test',threading.Event(),timeout=.001)
    assert failure.value.code=='timeout'
    with pytest.raises(MLFailure) as memory:run_process({'operation':'invalid'},root/'memory-test',threading.Event(),timeout=10,memory_mib=1)
    assert memory.value.code=='resource_limit'
    cancel=threading.Event();timer=threading.Timer(.02,cancel.set);timer.start()
    try:
        with pytest.raises(MLFailure) as stopped:run_process({'operation':'invalid'},root/'cancel-real-worker',cancel,timeout=10)
        assert stopped.value.code=='cancelled'
    finally:timer.cancel()


def test_model_artifact_integrity_and_deletion(workspace):
    app,c,root=workspace;identifier=upload(c,csv_bytes(['x'],[[math.sin(i)+i*.004] for i in range(80)]))
    j=finish(c,start(c,identifier,'anomaly'));assert j['status']=='completed',j
    model=c.get('/api/automl/models/'+j['result']['selected_model_id']).json()
    stored=app.state.store.get('MLModel',model['id']);original_versions=dict(stored['versions']);stored['versions']['sklearn']='untrusted-version';app.state.store.save('MLModel',stored)
    assert c.post('/api/automl/models/'+model['id']+'/predict',json={'records':[{'x':1.2}]}).status_code==409
    stored['versions']=original_versions;app.state.store.save('MLModel',stored)
    # A crash/interrupted publish must not expose partially registered models.
    experiment=app.state.store.get('MLExperiment',j['id']);experiment['status']='failed';app.state.store.save('MLExperiment',experiment)
    assert all(m['id']!=model['id'] for m in c.get('/api/automl/models').json())
    assert c.get('/api/automl/models/'+model['id']).status_code==409
    assert c.post('/api/automl/models/'+model['id']+'/predict',json={'records':[{'x':1.2}]}).status_code==409
    experiment['status']='completed';app.state.store.save('MLExperiment',experiment)
    path=root/model['artifact_path'];path.write_bytes(b'not trusted joblib')
    response=c.post('/api/automl/models/'+model['id']+'/predict',json={'records':[{'x':1.2}]})
    assert response.status_code==409 and 'checksum' in response.text
    assert c.delete('/api/automl/experiments/'+j['id']).status_code==204
    assert c.get('/api/automl/models/'+model['id']).status_code==404
    assert not path.exists()


def test_duplicate_groups_follow_confirmed_numeric_and_calendar_semantics():
    # Different VARCHAR spellings/times become identical configured predictors.
    x=np.array([[str((i//2)/8) if i%2==0 else format((i//2)/8,'.8e'),f'2026-01-{i//2%28+1:02}T{8+i%2:02}:00:00'] for i in range(120)],dtype=object)
    y=np.arange(120,dtype=float)
    schema=[{'name':'x','kind':'numeric'},{'name':'day','kind':'datetime'}]
    tr,va,te,groups=supervised_split(x,y,'regression',42,schema)
    assert all(groups[i]==groups[i+1] for i in range(0,120,2))
    assert not(set(groups[tr])&set(groups[te]) or set(groups[tr])&set(groups[va]))


def test_training_fingerprint_change_rejects_registration(workspace,monkeypatch):
    app,c,root=workspace;identifier=upload(c,regression_csv())
    from app.automl import service
    def changed(payload,directory,cancel,**kwargs):
        with connect(root/(identifier+'.duckdb'),False) as db:db.execute("UPDATE records SET x='999' WHERE record_id='ID0000'")
        return {'models':[]}
    monkeypatch.setattr(service,'run_process',changed)
    job=finish(c,start(c,identifier))
    assert job['status']=='failed' and job['error_code']=='fingerprint_mismatch'
    assert not c.get('/api/automl/models').json()


def test_wall_deadline_also_applies_when_worker_already_exited(tmp_path,monkeypatch):
    from app.automl import process
    class Exited:
        pid=123456
        def poll(self):return 0
        def wait(self):return 0
    monkeypatch.setattr(process.subprocess,'Popen',lambda *args,**kwargs:Exited())
    ticks=iter([0,2])
    monkeypatch.setattr(process.time,'monotonic',lambda:next(ticks))
    with pytest.raises(MLFailure) as failure:run_process({'operation':'invalid'},tmp_path/'late',threading.Event(),timeout=1)
    assert failure.value.code=='timeout'
