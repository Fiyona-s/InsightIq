"""Phase 4 tests use real SQL/reference execution; model boundaries are controlled."""
import json,time,threading
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app.main import create_app,connect
from app.benchmark import authored_cases,equivalent,MAPPING
from app.provider import Generation
from app.execution import ExecutionError
from app.filters import filter_rows,ResultFilter
from app.observability import measured_summary
from tests.test_analyst import ControlledProvider,dataset,submit,finish
from tests.test_phase3 import ControlledEmbedding


def make_app(path,provider=None):return create_app(path,provider=provider or ControlledProvider('SELECT region,SUM(revenue) AS total FROM data GROUP BY region'),embedder=ControlledEmbedding())


def saved(c,dataset_id,kind='bar',policy='manual'):
    run=finish(c,submit(c,dataset_id))
    response=c.post('/api/saved-charts',json={'run_id':run['id'],'title':'Regional revenue','spec':{'kind':kind,'x':0 if kind!='table' else None,'y':1 if kind!='table' else None},'refresh_policy':policy,'persist_snapshot_confirmed':True})
    assert response.status_code==201,response.text
    return response.json(),run


def layout(c,chart):
    d=c.post('/api/dashboards',json={'title':'Sales review','description':'Actual query results'}).json()
    widget={'id':str(uuid4()),'chart_id':chart['id'],'kind':'chart','title':'Revenue by region','width':6,'height':4,'filters':[]}
    response=c.put('/api/dashboards/'+d['id'],json={'title':d['title'],'description':d['description'],'revision':d['revision'],'widgets':[widget],'filters':[]})
    assert response.status_code==200,response.text
    return response.json()


def payload(view):return {key:view[key] for key in ('title','description','revision','filters')}|{'widgets':[{k:v for k,v in w.items() if k in {'id','chart_id','kind','title','text','spec','filters','width','height'}} for w in view['widgets']]}


def test_dashboard_persistence_reorder_resize_duplicate_filters_and_exports(tmp_path):
    app=make_app(tmp_path)
    with TestClient(app) as c:
        identifier=dataset(c);chart,run=saved(c,identifier);view=layout(c,chart)
        update=payload(view);second={**update['widgets'][0],'id':str(uuid4()),'width':12,'height':6};update['widgets'].insert(0,second)
        view=c.put('/api/dashboards/'+view['id'],json=update).json()
        assert view['widgets'][0]['id']==second['id'] and view['widgets'][0]['width']==12 and view['widgets'][0]['height']==6
        assert c.put('/api/dashboards/'+view['id'],json=update).status_code==409
        update=payload(view);update['filters']=[{'column':'region','kind':'category','values':['North']}]
        view=c.put('/api/dashboards/'+view['id'],json=update).json()
        assert view['widgets'][0]['result']['rows']==[['North',10.5]]
        assert view['widgets'][0]['evidence']['facts'][1]['value']=='10.5'
        assert 'output' in view['widgets'][0]['filters_applied']['scope']
        widget_id=view['widgets'][0]['id']
        csv=c.get(f'/api/dashboards/{view["id"]}/widgets/{widget_id}/results.csv')
        assert 'North,10.5' in csv.text and 'South' not in csv.text
        assert app.state.dashboards.report_slots.acquire(False) and app.state.dashboards.report_slots.acquire(False)
        try:assert c.get(f'/api/dashboards/{view["id"]}/report.pdf').status_code==429
        finally:app.state.dashboards.report_slots.release();app.state.dashboards.report_slots.release()
        pdf=c.get(f'/api/dashboards/{view["id"]}/report.pdf')
        assert pdf.status_code==200 and pdf.content.startswith(b'%PDF-') and len(pdf.content)<8*1024*1024
        exported=c.get(f'/api/dashboards/{view["id"]}/report.json').json()
        assert exported['widgets'][0]['source']['sql']==run['executed_sql']
        clone=c.post(f'/api/dashboards/{view["id"]}/duplicate').json()
        assert clone['id']!=view['id'] and clone['widgets'][0]['id']!=widget_id
        assert c.delete('/api/saved-charts/'+chart['id']).status_code==409
        dash_id=view['id']
    with TestClient(make_app(tmp_path)) as c:
        reopened=c.get('/api/dashboards/'+dash_id).json()
        assert reopened['widgets'][0]['result']['rows']==[['North',10.5]]
        assert c.get('/api/saved-charts/'+chart['id']).json()['snapshot']['row_count']==2
        assert c.delete('/api/dashboards/'+dash_id).status_code==204
        assert c.delete('/api/dashboards/'+clone['id']).status_code==204
        assert c.delete('/api/saved-charts/'+chart['id']).status_code==204


def test_safe_refresh_schema_change_and_snapshot_consent(tmp_path):
    app=make_app(tmp_path)
    with TestClient(app) as c:
        identifier=dataset(c);chart,run=saved(c,identifier)
        assert c.post('/api/saved-charts',json={'run_id':run['id'],'title':'Without consent'}).status_code==422
        path=tmp_path/(identifier+'.duckdb')
        with connect(path,False) as db:db.execute("UPDATE records SET revenue='99' WHERE id='001'")
        response=c.post('/api/saved-charts/'+chart['id']+'/refresh')
        assert response.status_code==200,response.text
        assert ['North',99.0] in c.get('/api/saved-charts/'+chart['id']).json()['snapshot']['rows']
        with connect(path,False) as db:db.execute('ALTER TABLE records ADD COLUMN changed VARCHAR')
        assert c.post('/api/saved-charts/'+chart['id']+'/refresh').status_code==409
        state=c.get('/api/saved-charts/'+chart['id']).json()
        assert state['status']=='refresh_failed' and state['snapshot']['row_count']==2
        # Tampering trusted persisted SQL still cannot bypass guard on refresh.
        state['schema_signature']=app.state.dashboards.schema_signature(identifier)[0]
        state['sql']="SELECT * FROM read_csv('/etc/passwd')";app.state.store.save('SavedChart',state)
        assert c.post('/api/saved-charts/'+chart['id']+'/refresh').status_code==422
        assert c.get(f'/api/datasets/{identifier}/preview').status_code==200
        fixed,_=saved(c,identifier,policy='snapshot')
        assert c.post('/api/saved-charts/'+fixed['id']+'/refresh').status_code==409


def test_dashboard_invalid_chart_and_cross_dataset_scope(tmp_path):
    with TestClient(make_app(tmp_path)) as c:
        identifier=dataset(c);chart,run=saved(c,identifier)
        bad=c.post('/api/saved-charts',json={'run_id':run['id'],'title':'Bad axis','persist_snapshot_confirmed':True,'spec':{'kind':'bar','x':0,'y':99}})
        assert bad.status_code==422
        view=layout(c,chart);update=payload(view);update['widgets'][0]['chart_id']=str(uuid4())
        assert c.put('/api/dashboards/'+view['id'],json=update).status_code==404
        update=payload(view);update['widgets'][0]['width']=99
        assert c.put('/api/dashboards/'+view['id'],json=update).status_code==422
        assert c.get('/api/dashboards/'+str(uuid4())).status_code==404
        assert c.post('/api/dashboards',content=b'x'*140000).status_code==413
        c.request('DELETE','/api/datasets/'+identifier,json={'confirm_name':c.get('/api/datasets/'+identifier).json()['name'],'acknowledge_dependencies':True,'acknowledge_benchmark':True})
        assert c.post('/api/saved-charts/'+chart['id']+'/refresh').status_code==404
        assert c.get('/api/dashboards/'+view['id']).json()['widgets'][0]['source']['status']=='refresh_failed'


def test_filter_types_aggregation_scope_nulls_and_resets():
    result={'columns':[{'name':'region','type':'VARCHAR'},{'name':'month','type':'DATE'},{'name':'total','type':'DOUBLE'}], 'rows':[['N','2026-01-01',100],['S','2026-02-01',200],['N',None,None]],'row_count':3}
    filtered,info=filter_rows(result,[{'column':'total','kind':'numeric','minimum':'150'},{'column':'missing','kind':'category','values':['N']}])
    assert filtered['rows']==[['S','2026-02-01',200]] and len(info['unavailable'])==1
    filtered,_=filter_rows(result,[{'column':'month','kind':'date','minimum':'2026-02-01','maximum':'2026-02-28'}]);assert filtered['row_count']==1
    filtered,info=filter_rows(result,[{'column':'total','kind':'category','values':['200']}]);assert filtered['row_count']==3 and info['unavailable']
    assert filter_rows(result,[])[0]['row_count']==3
    with pytest.raises(ValueError):ResultFilter(column='total',kind='numeric',minimum='NaN')
    with pytest.raises(ValueError):ResultFilter(column='month',kind='date',minimum='not-a-date')
    with pytest.raises(ValueError):ResultFilter(column='total',kind='numeric',minimum='3',maximum='1')


@pytest.mark.parametrize('actual,expected,ordered,ok',[
 ([[1],[1]],[[1],[2]],False,False),([[None]],[[0]],False,False),([[1],[2]],[[2],[1]],False,True),([[1],[2]],[[2],[1]],True,False),
 ([[1.00000001]],[[1]],False,True),([[1.01]],[[1]],False,False),([[None]],[[None]],False,True)])
def test_typed_result_equivalence(actual,expected,ordered,ok):
    make=lambda rows:{'columns':[{'name':'n','type':'DOUBLE'}],'rows':rows,'row_count':len(rows)}
    assert equivalent(make(actual),make(expected),ordered)[0] is ok
    wrong=make(actual);wrong['columns'][0]['name']='different_meaning'
    assert not equivalent(wrong,make(expected),ordered)[0]


class BenchmarkProvider:
    model='controlled-phase4-test'
    def __init__(self,repair=False,pause=None):self.calls=[];self.repair=repair;self.pause=pause
    def generate(self,question,context):
        self.calls.append(context)
        if self.pause:self.pause.wait(3)
        case=next(c for c in authored_cases() if c['question']==question)
        if self.repair and 'repair_untrusted' not in context:sql='SELECT ghost FROM data'
        else:sql=case['reference_sql']
        return Generation(sql=sql,clarification='Please clarify the metric or provide the missing authorized data.' if sql is None else None,explanation='Controlled benchmark boundary.'),{'model':self.model,'total_tokens':10,'prompt_tokens':6,'completion_tokens':4,'estimated_cost_usd':.000014}


def prepare(c):
    installed=c.post('/api/benchmarks/retail-v1/install').json()
    verification=c.post('/api/benchmarks/retail-v1/verify',params={'dataset_id':installed['dataset_id']})
    assert verification.status_code==200,verification.text
    info=verification.json();assert info['case_count']==45
    assert info['verified_count']==45,[(q['id'],q.get('verification_reason')) for q in info['cases'] if q['verification']!='verified']
    return installed['dataset_id']


def eval_finish(c,identifier):
    end=time.monotonic()+20
    while time.monotonic()<end:
        job=c.get('/api/evaluations/'+identifier).json()
        if job['status'] in {'completed','failed','cancelled'}:return job
        time.sleep(.05)
    raise AssertionError('Evaluation did not finish')


def test_authored_benchmark_verified_modes_metrics_and_history(tmp_path,monkeypatch):
    monkeypatch.setenv('LLM_INPUT_USD_PER_MILLION','1');monkeypatch.setenv('LLM_OUTPUT_USD_PER_MILLION','2')
    provider=BenchmarkProvider(repair=True);app=make_app(tmp_path,provider)
    with TestClient(app) as c:
        identifier=prepare(c)
        for pipeline in ('baseline','rag','agentic'):
            response=c.post('/api/evaluations',json={'dataset_id':identifier,'case_ids':['q06','q41'],'pipeline':pipeline,'max_spend_usd':1,'max_total_tokens':100000,'confirm_paid_calls':True})
            assert response.status_code==202,response.text
            job=eval_finish(c,response.json()['id']);assert job['status']=='completed',job
            assert job['metrics']['completed_cases']==2
            assert job['metrics']['difficulties']['easy']['total']==1 and job['metrics']['difficulties']['medium']['total']==1
            assert job['metrics']['accuracy']==(1 if pipeline=='agentic' else 0)
            assert all(r['run']['activity_kind']=='evaluation' for r in job['results'])
            assert all(r['run']['pipeline']==pipeline for r in job['results'])
            assert c.get('/api/analytics/runs').json()['total_questions']==0
            assert c.get('/api/evaluations/'+job['id']+'/report.csv').status_code==200
            assert c.get('/api/evaluations/'+job['id']+'/report.json').json()['results']
            review=c.put('/api/evaluations/'+job['id']+'/cases/q06/review',json={'reviewed':True,'labels':[] if pipeline=='agentic' else ['hallucinated_column'],'reason':'Independent controlled-test reviewer annotation.'})
            assert review.status_code==200,review.text
            assert review.json()['metrics']['reviewed_cases']==1
            assert review.json()['metrics']['hallucinated_column_rate']==(0 if pipeline=='agentic' else 1)
        # Gold SQL and expected results never appear as context keys, or in stored knowledge docs.
        assert all('reference_sql' not in json.dumps(context) and 'expected' not in context for context in provider.calls)
        docs,_,_=app.state.knowledge.documents(identifier,MAPPING)
        assert not any(d['kind']=='sql_example' for d in docs)
        assert not provider.calls[0]['retrieved_context_untrusted']
        assert all(not context['retrieved_context_untrusted'] for context in provider.calls)
        assert len(c.get('/api/evaluations').json())==3
        job_id=job['id']
    with TestClient(make_app(tmp_path,provider)) as c:assert c.get('/api/evaluations/'+job_id).json()['status']=='completed'


def test_evaluation_limits_cancellation_budget_and_incompatible_dataset(tmp_path,monkeypatch):
    monkeypatch.setenv('LLM_INPUT_USD_PER_MILLION','1');monkeypatch.setenv('LLM_OUTPUT_USD_PER_MILLION','2')
    release=threading.Event();provider=BenchmarkProvider(pause=release);app=make_app(tmp_path,provider)
    with TestClient(app) as c:
        identifier=prepare(c)
        body={'dataset_id':identifier,'case_ids':['q06'],'pipeline':'agentic','max_spend_usd':1,'confirm_paid_calls':True}
        bad={**body,'dataset_id':dataset(c)};assert c.post('/api/evaluations',json=bad).status_code==409
        assert c.post('/api/evaluations',json={**body,'confirm_paid_calls':False}).status_code==422
        assert c.post('/api/evaluations',json={**body,'case_ids':['q06']*11}).status_code==422
        assert c.post('/api/evaluations',json={**body,'case_ids':['missing']}).status_code==422
        response=c.post('/api/evaluations',json=body);assert response.status_code==202,response.text
        identifier_job=response.json()['id'];assert c.post('/api/evaluations',json=body).status_code==429
        c.delete('/api/evaluations/'+identifier_job);release.set()
        assert eval_finish(c,identifier_job)['status']=='cancelled'
        calls=len(provider.calls)
        tiny=c.post('/api/evaluations',json={**body,'max_spend_usd':.000001}).json()
        assert eval_finish(c,tiny['id'])['status']=='failed';assert len(provider.calls)==calls
        monkeypatch.delenv('LLM_INPUT_USD_PER_MILLION');assert c.post('/api/evaluations',json=body).status_code==409


def test_migrations_and_operational_analytics(tmp_path):
    with TestClient(make_app(tmp_path)) as c:
        run=finish(c,submit(c,dataset(c)))
        analytics=c.get('/api/analytics/runs').json();assert analytics['total_questions']==1 and analytics['execution_success_rate']==1
        assert 'Not measured' in analytics['correctness']
        assert c.get('/api/analytics/runs?status=failed').json()['total_questions']==0
        assert c.get('/api/analytics/runs?search=unmatched').json()['total_questions']==0
        assert c.get('/api/analytics/runs?start=invalid').status_code==422
    import sqlite3
    with sqlite3.connect(tmp_path/'catalog.sqlite') as db:assert db.execute('SELECT version FROM schema_migrations ORDER BY version').fetchall()==[(i,) for i in range(1,18)]
    with TestClient(make_app(tmp_path)) as c:assert c.get('/api/analytics/runs').json()['total_questions']==1


def test_guard_boolean_predicates_and_date_filter_end_day(tmp_path):
    from app.sql_guard import validate_sql,GuardError
    schema={'region':'VARCHAR','revenue':'DOUBLE'}
    assert 'AND' in validate_sql("SELECT region FROM data WHERE revenue>0 AND (region='North' OR region='South')",schema)
    with pytest.raises(GuardError):validate_sql("SELECT region FROM data WHERE revenue>0 AND read_file('/etc/passwd')='x'",schema)
    result={'columns':[{'name':'at','type':'TIMESTAMP'}],'rows':[['2026-01-01 18:30:00'],['2026-01-02 01:00:00']],'row_count':2}
    filtered,_=filter_rows(result,[{'column':'at','kind':'date','minimum':'2026-01-01','maximum':'2026-01-01'}])
    assert filtered['rows']==[['2026-01-01 18:30:00']]


def test_invalid_benchmark_payload_and_pricing_limits(tmp_path,monkeypatch):
    from app.evaluation import EvalRequest,BudgetProvider
    from app.provider import ModelError
    from app.benchmark import authored_cases
    identifiers=[c['id'] for c in authored_cases()]
    assert len(set(identifiers))==45
    with pytest.raises(ValueError):EvalRequest(dataset_id=uuid4(),case_ids=['q01'],pipeline='baseline',max_spend_usd=1,confirm_paid_calls=True,reference_sql='SELECT 1')
    class NeverCall:
        model='test-only'
        def generate(self,*args):raise AssertionError('Provider must not be called after budget exhaustion.')
    for field,value in [('provider_calls',30),('reserved_tokens',100000),('reserved_cost_usd',1)]:
        job={'_deadline':time.monotonic()+10,'provider_calls':0,'reserved_tokens':0,'reserved_cost_usd':0,'max_total_tokens':100000,'max_spend_usd':1,'pricing':{'input':'1','output':'2'}}
        job[field]=value
        with pytest.raises(ModelError,match='budget'):BudgetProvider(NeverCall(),job,threading.Event(),lambda:None).generate('question',{})
    stamp=lambda value:{'columns':[{'name':'at','type':'TIMESTAMP'}],'rows':[[value]],'row_count':1}
    assert equivalent(stamp('2026-01-01 12:00:00'),stamp('2026-01-01T12:00:00'))[0]
    assert equivalent(stamp('2026-01-01T12:00:00+00:00'),stamp('2026-01-01T17:30:00+05:30'))[0]
    assert not equivalent({'columns':[{'name':'x','type':'DOUBLE'}],'rows':[[]]}, {'columns':[{'name':'x','type':'DOUBLE'}],'rows':[[1]]})[0]


def test_additive_upgrade_preserves_legacy_catalog_and_rows(tmp_path):
    import sqlite3
    identifier=str(uuid4())
    columns=[{'name':'id','type':'VARCHAR','null_count':0}]
    with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
        db.execute('CREATE TABLE datasets (id VARCHAR(36) PRIMARY KEY,name VARCHAR(255) NOT NULL,rows INTEGER NOT NULL,bytes INTEGER NOT NULL,created_at VARCHAR(40) NOT NULL,schema_json TEXT NOT NULL)')
        db.execute('INSERT INTO datasets VALUES (?,?,?,?,?,?)',(identifier,'legacy-controlled.csv',1,7,'2026-01-01',json.dumps(columns)))
    with connect(tmp_path/(identifier+'.duckdb'),False) as db:
        db.execute('CREATE TABLE records(id VARCHAR)');db.execute('INSERT INTO records VALUES (?)',['001'])
    with TestClient(make_app(tmp_path)) as c:
        assert c.get('/api/datasets').json()[0]['id']==identifier
        assert c.get('/api/datasets/'+identifier+'/preview').json()['rows']==[['001']]
        assert c.get('/api/dashboards').json()==[]
    with sqlite3.connect(tmp_path/'catalog.sqlite') as db:assert db.execute('SELECT COUNT(*) FROM schema_migrations').fetchone()==(17,)


def test_integer_contracts_are_exact_even_at_large_magnitudes():
    def result(value):return {'columns':[{'name':'id','type':'BIGINT'}],'rows':[[value]],'row_count':1}
    assert not equivalent(result(1000000001),result(1000000000))[0]
    assert equivalent(result('9007199254740993'),result(9007199254740993))[0]
