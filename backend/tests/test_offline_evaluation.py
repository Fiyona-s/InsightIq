"""Real SQL replay, with provider/RAG/embedding tripwires and persisted prediction provenance."""
import copy,json,shutil,time
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app.main import create_app,connect
from app.benchmark import MAPPING
from tests.test_phase3 import ControlledEmbedding
from tests.test_phase4 import BenchmarkProvider,prepare,eval_finish


@pytest.fixture(scope='module')
def saved_predictions(tmp_path_factory):
    root=tmp_path_factory.mktemp('offline-source')
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv('LLM_INPUT_USD_PER_MILLION','1');mp.setenv('LLM_OUTPUT_USD_PER_MILLION','2')
        provider=BenchmarkProvider()
        with TestClient(create_app(root,provider=provider,embedder=ControlledEmbedding())) as client:
            identifier=prepare(client)
            response=client.post('/api/evaluations',json={'dataset_id':identifier,'case_ids':['q06','q35','q41'],'pipeline':'agentic','max_spend_usd':1,'confirm_paid_calls':True})
            assert response.status_code==202,response.text
            source=eval_finish(client,response.json()['id']);assert source['metrics']['accuracy']==1
            assert len(provider.calls)==3
    return root,identifier,source['id']


@pytest.fixture
def offline(saved_predictions,tmp_path,monkeypatch):
    base,identifier,source_id=saved_predictions
    root=tmp_path/'workspace';shutil.copytree(base,root)
    def forbidden(*args,**kwargs):pytest.fail('Offline mode invoked a provider, embedding, retrieval or agent boundary.')
    class NoProvider:
        generate=forbidden;narrate=forbidden
        @property
        def model(self):pytest.fail('Offline mode consulted the configured provider.')
    class NoEmbeddings:
        identity='offline-tripwire'
        encode=forbidden
    monkeypatch.delenv('LLM_API_KEY',raising=False);monkeypatch.delenv('LLM_MODEL',raising=False)
    monkeypatch.delenv('LLM_INPUT_USD_PER_MILLION',raising=False);monkeypatch.delenv('LLM_OUTPUT_USD_PER_MILLION',raising=False)
    app=create_app(root,provider=NoProvider(),embedder=NoEmbeddings())
    monkeypatch.setattr(app.state.knowledge,'retrieve',forbidden)
    monkeypatch.setattr(app.state.knowledge,'settings',forbidden)
    monkeypatch.setattr(app.state.analyst,'submit',forbidden)
    from app import workflow
    monkeypatch.setattr(workflow,'run_graph',forbidden)
    with TestClient(app) as client:yield app,client,identifier,source_id,root


def run_offline(client,identifier,**extra):
    response=client.post('/api/evaluations/offline',json={'dataset_id':identifier,**extra})
    assert response.status_code==202,response.text
    job=eval_finish(client,response.json()['id'])
    assert job['status']=='completed',job
    assert job['provider_calls']==0 and job['metrics']['total_tokens']==0 and job['metrics']['estimated_cost_usd']==0
    return job


def test_offline_real_replay_empty_results_abstention_and_missing(offline):
    app,c,identifier,source_id,root=offline
    job=run_offline(c,identifier,source_evaluation_id=source_id)
    m=job['metrics']
    assert m['completed_cases']==45 and m['evaluated_count']==3
    assert m['correct_count']==3 and m['incorrect_count']==0 and m['missing_predictions']==42 and m['accuracy']==1
    assert m['execution_failures']==m['reference_failures']==0
    records={r['case_id']:r for r in job['results']}
    assert records['q06']['actual']['rows']==[[1000.0]]
    assert records['q35']['actual']['rows']==[] and records['q35']['correct'] is True
    assert records['q41']['correct'] is True and records['q41']['actual'] is None
    assert records['q05']['correct'] is None and records['q05']['run'] is None
    assert records['q05']['comparison']=='Not evaluated — no saved prediction'
    assert records['q06']['source_evaluation_id']==source_id and records['q06']['source_run_id']
    assert c.get('/api/benchmarks').json()['verified_count']==45  # distinct reference verification
    assert c.get(f'/api/evaluations/{job["id"]}/report.json').json()['mode']=='offline'
    exported=c.get(f'/api/evaluations/{job["id"]}/report.csv')
    assert exported.status_code==200 and 'missing_prediction' in exported.text and 'offline' in exported.text
    assert c.post('/api/evaluations',json={'dataset_id':identifier,'case_ids':['q06'],'pipeline':'agentic','max_spend_usd':1,'confirm_paid_calls':False}).status_code==422


def test_offline_missing_does_not_run_gold_as_prediction_or_invent_accuracy(offline,monkeypatch):
    app,c,identifier,source_id,root=offline
    from app import evaluation
    def no_query(*args,**kwargs):pytest.fail('No saved prediction: no reference/prediction query should execute.')
    monkeypatch.setattr(evaluation,'execute_isolated',no_query)
    job=run_offline(c,identifier,case_ids=['q01','q02'])
    assert job['metrics']['accuracy'] is None and job['metrics']['evaluated_count']==0
    assert job['metrics']['missing_predictions']==2 and job['metrics']['correct_count']==job['metrics']['incorrect_count']==0
    assert all(r['status']=='missing_prediction' and r['correct'] is None and r['actual'] is None for r in job['results'])


@pytest.mark.parametrize('change',['version','dataset','fingerprint','case_id','question','run_dataset','mapping','run_id','offline_source','reference_only','sql_mismatch'])
def test_saved_prediction_provenance_must_match(offline,change):
    app,c,identifier,source_id,root=offline
    source=app.state.store.get('Evaluation',source_id)
    row=next(r for r in source['results'] if r['case_id']=='q06')
    if change=='version':source['version']='retail-v0'
    elif change=='dataset':source['dataset_id']=str(uuid4())
    elif change=='fingerprint':source['dataset_fingerprint']='0'*64
    elif change=='case_id':row['case_id']='q99'
    elif change=='question':row['question']='Unrelated question'
    elif change=='run_dataset':row['run']['dataset_id']=str(uuid4())
    elif change=='mapping':row['run']['type_mapping']={'revenue':'VARCHAR'}
    elif change=='run_id':row['run']['id']=str(uuid4())
    elif change=='offline_source':source['mode']='offline';source['pipeline']='offline'
    elif change=='reference_only':row.pop('run')
    elif change=='sql_mismatch':row['run']['sql']='SELECT SUM(revenue)+1 FROM data'
    app.state.store.save('Evaluation',source)
    job=run_offline(c,identifier,case_ids=['q06'],source_evaluation_id=source_id)
    assert job['metrics']['missing_predictions']==1 and job['metrics']['accuracy'] is None
    assert job['results'][0]['source_run_id'] is None


@pytest.mark.parametrize('sql,status,actual',[
 ('SELECT SUM(revenue)+1 AS total_revenue FROM data','incorrect',[[1001.0]]),
 ("SELECT CAST('invalid' AS DOUBLE) AS total_revenue FROM data",'execution_failed',None),
 ("SELECT * FROM read_csv('/etc/passwd')",'execution_failed',None),
])
def test_saved_bad_predictions_are_replayed_and_scored_not_replaced_by_gold(offline,sql,status,actual):
    app,c,identifier,source_id,root=offline
    source=app.state.store.get('Evaluation',source_id)
    row=next(r for r in source['results'] if r['case_id']=='q06')
    # Simulate a persisted wrong/failed agent prediction; both durable copies agree.
    row['run'].update(sql=sql,executed_sql=None,status='failed',error='Controlled saved failure.',error_code='execution_error')
    app.state.analyst.save(row['run']);app.state.store.save('Evaluation',source)
    job=run_offline(c,identifier,case_ids=['q06'],source_evaluation_id=source_id)
    assert job['results'][0]['status']==status and job['results'][0]['actual']==(None if actual is None else {'columns':[{'name':'total_revenue','type':'DOUBLE'}],'rows':actual,'row_count':1})
    assert job['metrics']['evaluated_count']==1 and job['metrics']['incorrect_count']==1 and job['metrics']['accuracy']==0
    assert job['metrics']['execution_failures']==int(status=='execution_failed')
    assert job['results'][0]['expected']['rows']==[[1000.0]]


def test_offline_fingerprint_drift_and_invalid_requests(offline):
    app,c,identifier,source_id,root=offline
    assert c.post('/api/evaluations/offline',json={'dataset_id':identifier,'case_ids':['q06','q06']}).status_code==422
    assert c.post('/api/evaluations/offline',json={'dataset_id':identifier,'case_ids':['unknown']}).status_code==422
    assert c.post('/api/evaluations/offline',json={'dataset_id':identifier,'version':'retail-v0'}).status_code==422
    assert c.post('/api/evaluations/offline',json={'dataset_id':identifier,'confirm_paid_calls':True,'sql':'SELECT 1'}).status_code==422
    with connect(root/(identifier+'.duckdb'),False) as db:db.execute("UPDATE records SET revenue='101' WHERE id='1'")
    assert c.post('/api/evaluations/offline',json={'dataset_id':identifier}).status_code==409


def test_offline_replays_persisted_predictions_without_result_cache(offline):
    app,c,identifier,source_id,root=offline
    assert not app.state.analyst.results
    first=run_offline(c,identifier,case_ids=['q06'],source_evaluation_id=source_id)
    second=run_offline(c,identifier,case_ids=['q06'])
    assert second['results'][0]['source_evaluation_id']==source_id  # never selects its own offline/gold replay
    assert second['metrics']['correct_count']==1
    assert app.state.store.get('Evaluation',first['id'])['mode']=='offline'


def test_reference_failure_is_separate_from_model_accuracy(offline):
    app,c,identifier,source_id,root=offline
    install=next(e for e in app.state.store.list('BenchmarkInstall') if e['dataset_id']==identifier)
    case=next(case for case in install['verification']['cases'] if case['id']=='q06')
    case['expected']['rows']=[[999.0]]  # invalid reference contract, not a bad agent prediction
    app.state.store.save('BenchmarkInstall',install)
    job=run_offline(c,identifier,case_ids=['q06'])
    assert job['metrics']['reference_failures']==1
    assert job['metrics']['evaluated_count']==job['metrics']['incorrect_count']==0
    assert job['metrics']['accuracy'] is None
    assert job['results'][0]['status']=='reference_failed' and job['results'][0]['correct'] is None
    assert 'prediction not scored' in job['results'][0]['comparison']


def test_offline_cancellation_and_shared_job_admission(offline,monkeypatch):
    import threading
    app,c,identifier,source_id,root=offline
    started=threading.Event()
    def blocked(job,sql,cancel):
        started.set()
        assert cancel.wait(5),'Offline cancellation signal did not reach SQL replay.'
        from app.execution import ExecutionError
        raise ExecutionError('Controlled cancellation.','cancelled')
    monkeypatch.setattr(app.state.evaluations,'execute_saved',blocked)
    response=c.post('/api/evaluations/offline',json={'dataset_id':identifier,'case_ids':['q06']})
    assert response.status_code==202 and started.wait(5)
    assert c.post('/api/evaluations/offline',json={'dataset_id':identifier,'case_ids':['q06']}).status_code==429
    assert c.delete('/api/evaluations/'+response.json()['id']).status_code==200
    job=eval_finish(c,response.json()['id'])
    assert job['status']=='cancelled' and job['provider_calls']==0
    assert job['metrics']['evaluated_count']==0 and job['metrics']['accuracy'] is None


def test_offline_alias_diagnostic_does_not_inflate_accuracy_or_call_provider(offline):
    app,c,identifier,source_id,root=offline
    source=app.state.store.get('Evaluation',source_id)
    row=next(r for r in source['results'] if r['case_id']=='q06')
    row['run'].update(sql='SELECT SUM(revenue) AS different_name FROM data',executed_sql='SELECT SUM(revenue) AS different_name FROM data')
    app.state.analyst.save(row['run']);app.state.store.save('Evaluation',source)
    job=run_offline(c,identifier,case_ids=['q06'],source_evaluation_id=source_id)
    assert job['metrics']['accuracy']==0 and job['metrics']['incorrect_count']==1
    assert job['results'][0]['comparison_details']['alias_only_mismatch']
    assert job['results'][0]['actual']['rows']==job['results'][0]['expected']['rows']==[[1000.0]]
    assert job['metrics']['rates']['sql_validity']['value']==1
    assert job['metrics']['rates']['result_correctness']['value']==0
    assert job['metrics']['rates']['correct_abstention']['denominator']==0
    assert job['metrics']['usage_sample_size']==0 and job['metrics']['total_tokens']==0


def test_evaluation_predictions_cannot_be_seeded_as_retrieval_examples(offline):
    app,c,identifier,source_id,root=offline
    source=app.state.store.get('Evaluation',source_id)
    row=next(r for r in source['results'] if r['case_id']=='q06')
    response=c.post(f'/api/datasets/{identifier}/knowledge/examples',json={'run_id':row['run']['id'],'expected_result_digest':row['run']['result_digest']})
    assert response.status_code==409 and 'independent reference check' in response.text
