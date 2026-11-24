"""Phase 3 integration uses real FAISS/DuckDB/graph; only embedding/model boundaries controlled."""
import asyncio
import json
import os
import threading
from pathlib import Path
from uuid import uuid4
import numpy as np
import pytest
from fastapi.testclient import TestClient
from app.main import create_app, connect
from app.embeddings import SentenceEmbedder
from app.knowledge import digest
from app.charts import chart_options, validate_chart
from app.evidence import compute_evidence, ground_narrative
from app.provider import Generation, LLMProvider, ModelError
from tests.test_analyst import dataset, submit, finish, ControlledProvider


class ControlledEmbedding:
    """Explicit test boundary, never imported by production code."""
    identity = 'test-only-keyword-v1'
    def __init__(self): self.calls = []
    def encode(self, texts):
        self.calls.append(texts)
        return np.array([[float(word in text.casefold()) for word in ('revenue', 'region', 'order', 'customer', 'metric', 'id')] + [0.1] for text in texts], dtype='float32')


class SequenceProvider(ControlledProvider):
    def __init__(self, sqls, selection=None):
        super().__init__()
        self.sqls, self.calls, self.selection = sqls, [], selection
    def generate(self, question, context):
        self.calls.append(context)
        return Generation(sql=self.sqls[min(len(self.calls)-1,len(self.sqls)-1)], clarification=None, explanation='Controlled test query.'), {'total_tokens': 10, 'prompt_tokens': 6, 'completion_tokens': 4, 'estimated_cost_usd': .01}
    def narrate(self, question, evidence):
        return self.selection or {'fact_ids': ['f1','f2'] if len(evidence['facts']) > 1 else ['f1']}, {'total_tokens': 3, 'prompt_tokens': 2, 'completion_tokens': 1, 'estimated_cost_usd': .003}


def retrieve(client, identifier, question='revenue', mapping=None):
    response = client.post(f'/api/datasets/{identifier}/knowledge/retrieve', json={'question':question,'type_mapping':mapping or {},'top_k':3})
    assert response.status_code == 200, response.text
    return response.json()


def test_faiss_relevance_persistence_corruption_mapping_and_namespace(tmp_path):
    embedder = ControlledEmbedding()
    app = create_app(tmp_path, embedder=embedder)
    with TestClient(app) as c:
        a = dataset(c); b = dataset(c, b'private_payroll\nconfidential\n')
        first = retrieve(c,a)
        assert first['status'] == 'ready' and first['rebuilt']
        assert first['documents'][0]['title'] == 'revenue'
        assert all(d['dataset_id']==a and 'private_payroll' not in d['text'] for d in first['documents'])
        assert all(-1<=d['score']<=1 and d['provenance'] and d['reason'] for d in first['documents'])
        assert not retrieve(c,a)['rebuilt']
        folder = app.state.knowledge.directory(a)
        index = next(folder.glob('*.faiss')); index.write_bytes(b'corrupt')
        assert retrieve(c,a)['rebuilt']
        changed = retrieve(c,a,mapping={'revenue':'DOUBLE'})
        assert changed['fingerprint'] != first['fingerprint']
        assert 'SQL type DOUBLE' in next(d for d in changed['documents'] if d['title']=='revenue')['text']
        assert retrieve(c,b)['dataset_id'] == b
        assert c.post(f'/api/datasets/{uuid4()}/knowledge/retrieve', json={'question':'revenue'}).status_code == 404
        scope = first['workspace_id']
    before = len(embedder.calls)
    with TestClient(create_app(tmp_path,embedder=embedder)) as c:
        assert retrieve(c,a)['workspace_id']==scope
        assert not retrieve(c,a)['rebuilt']
    # Separate workspace rejects IDs even if an attacker knows a private dataset UUID.
    with TestClient(create_app(tmp_path/'other', embedder=embedder)) as c:
        assert c.get(f'/api/datasets/{a}/knowledge').status_code == 404
        other = dataset(c)
        assert retrieve(c,other)['workspace_id'] != scope
    assert len(embedder.calls)>before


def test_knowledge_settings_schema_change_deletion_and_unavailable(tmp_path):
    app = create_app(tmp_path,embedder=ControlledEmbedding())
    with TestClient(app) as c:
        identifier = dataset(c)
        original=retrieve(c,identifier)
        settings={'description':'Retail transactions. Untrusted business context.', 'columns':{'revenue':'Gross sales before refunds.'}, 'metrics':[{'name':'Gross revenue','description':'Sum converted revenue values','sql':'SELECT SUM(TRY_CAST(revenue AS DOUBLE)) FROM data'}]}
        assert c.put(f'/api/datasets/{identifier}/knowledge',json=settings).status_code==200
        updated=retrieve(c,identifier)
        assert updated['fingerprint']!=original['fingerprint']
        docs,_,_=app.state.knowledge.documents(identifier)
        assert any(d['kind']=='metric' for d in docs)
        assert all(d['provenance'] for d in docs)
        with connect(tmp_path/(identifier+'.duckdb'),False) as db:
            db.execute('ALTER TABLE records ADD COLUMN customer_id VARCHAR')
            db.execute('ALTER TABLE records ADD COLUMN customer_name VARCHAR')
        schema=retrieve(c,identifier,question='customer')
        assert schema['fingerprint']!=updated['fingerprint']
        assert 'customer_id' in c.get(f'/api/datasets/{identifier}/knowledge').json()['columns']
        docs,_,_=app.state.knowledge.documents(identifier)
        assert any(d['kind']=='relationship' and d['provenance']['confirmed'] is False for d in docs)
        settings['columns']={'unknown':'bad'}
        assert c.put(f'/api/datasets/{identifier}/knowledge',json=settings).status_code==422
        folder=app.state.knowledge.directory(identifier)
        assert folder.exists()
        assert c.request('DELETE',f'/api/datasets/{identifier}',json={'confirm_name':c.get(f'/api/datasets/{identifier}').json()['name'],'acknowledge_dependencies':True,'acknowledge_benchmark':True}).status_code==204
        assert not folder.exists() and not (tmp_path/(identifier+'.duckdb')).exists()
        assert c.get(f'/api/datasets/{identifier}/knowledge').status_code==404
    with TestClient(create_app(tmp_path/'unprovisioned',embedder=SentenceEmbedder(tmp_path/'missing-model'))) as c:
        result=retrieve(c,dataset(c))
        assert result['status']=='unavailable' and not result['documents'] and 'provision' in result['warning']


@pytest.mark.parametrize('sqls,attempts,status',[
    (['SELECT ghost FROM data','SELECT SUM(revenue) AS total FROM data'],2,'succeeded'),
    (["SELECT * FROM read_csv('/etc/passwd')"],2,'failed'),
    (['SELECT id FROM data WHERE revenue > 100000'],1,'succeeded'),
    (["SELECT TRY_CAST(id AS BIGINT) AS n FROM data"],1,'succeeded'),
    (["SELECT CAST('invalid' AS DOUBLE) AS n FROM data",'SELECT SUM(revenue) AS total FROM data'],2,'succeeded'),
])
def test_graph_retry_budget_guard_execution_and_empty(tmp_path,sqls,attempts,status):
    provider=SequenceProvider(sqls)
    with TestClient(create_app(tmp_path,provider=provider,embedder=ControlledEmbedding())) as c:
        run=finish(c,submit(c,dataset(c)))
        assert run['status']==status,run
        assert run['attempts']==attempts and len(provider.calls)==attempts
        assert len(run['events'])<=96
        steps={e['step'] for e in run['events']}
        assert {'retrieve_context','plan','generate_sql','validate'}<=steps
        if status=='failed':
            assert run['executed_sql'] is None and run['error_code']=='repeated_sql'
        else:
            assert {'execute','chart','explain','finish'}<=steps
            analysis=c.get(f'/api/analyst/runs/{run["id"]}/analysis').json()
            assert analysis['evidence']['result_digest']==run['result_digest']
            # Verify persisted event replay and native reconnect header semantics.
            response=c.get(f'/api/analyst/runs/{run["id"]}/events')
            assert response.headers['content-type'].startswith('text/event-stream')
            assert 'event: complete' in response.text and 'id: 1\n' in response.text
            replay=c.get(f'/api/analyst/runs/{run["id"]}/events',headers={'Last-Event-ID':'2'})
            assert 'id: 1\n' not in replay.text and 'id: 3\n' in replay.text
            assert c.get(f'/api/analyst/runs/{run["id"]}/events',headers={'Last-Event-ID':'garbage'}).status_code==422
            assert c.get(f'/api/analyst/runs/{run["id"]}/events?after=96').status_code==409
            if not analysis['charts']['recommended']['points']:
                assert analysis['charts']['recommended']['spec']['kind']=='table'


def test_narrative_rejects_fabricated_numbers_and_replay_verified_examples(tmp_path):
    provider=SequenceProvider(['SELECT SUM(revenue) AS total FROM data'], {'fact_ids':['invented'], 'claim':'profit doubled because advertising'})
    app=create_app(tmp_path,provider=provider,embedder=ControlledEmbedding())
    with TestClient(app) as c:
        identifier=dataset(c)
        run=finish(c,submit(c,identifier))
        analysis=c.get(f'/api/analyst/runs/{run["id"]}/analysis').json()
        assert analysis['warning'] and analysis['narrative_source']=='computed'
        assert 'advertising' not in json.dumps(analysis)
        known={f['id']:f['statement'] for f in analysis['evidence']['facts']}
        assert all(n['text']==known[n['fact_id']] for n in analysis['narrative'])
        endpoint=f'/api/datasets/{identifier}/knowledge/examples'
        assert c.post(endpoint,json={'run_id':run['id'],'expected_result_digest':'0'*64}).status_code==409
        body={'run_id':run['id'],'expected_result_digest':run['result_digest']}
        response=c.post(endpoint,json=body)
        assert response.status_code==409,response.text
        assert 'independent reference check' in response.json()['detail']
        docs,_,_=app.state.knowledge.documents(identifier,run['type_mapping'])
        assert not any(d['kind']=='sql_example' for d in docs)
        docs,_,_=app.state.knowledge.documents(identifier,{})
        assert not any(d['kind']=='sql_example' for d in docs)
        other=dataset(c)
        assert c.post(f'/api/datasets/{other}/knowledge/examples',json=body).status_code==409
        with connect(tmp_path/(identifier+'.duckdb'),False) as db: db.execute("UPDATE records SET revenue='99' WHERE id='001'")
        assert c.post(endpoint,json=body).status_code==409
        docs,_,_=app.state.knowledge.documents(identifier,run['type_mapping'])
        assert not any(d['kind']=='sql_example' for d in docs)


def test_cancel_during_retrieval_disconnect_cleanup_and_delete_conflict(tmp_path):
    entered, release=threading.Event(),threading.Event()
    class PausedEmbedding(ControlledEmbedding):
        def encode(self,texts):
            entered.set(); release.wait(4); return super().encode(texts)
    app=create_app(tmp_path,provider=SequenceProvider(['SELECT COUNT(*) FROM data']),embedder=PausedEmbedding())
    with TestClient(app) as c:
        identifier=dataset(c); run_id=submit(c,identifier)
        assert entered.wait(2)
        assert c.delete(f'/api/datasets/{identifier}').status_code==409
        c.delete(f'/api/analyst/runs/{run_id}'); release.set()
        assert finish(c,run_id)['status']=='cancelled'
        class Disconnected:
            async def is_disconnected(self): return True
        async def disconnect():
            assert app.state.analyst.subscribers.acquire(False)
            stream=app.state.analyst.event_stream(run_id,Disconnected(),0)
            assert [event async for event in stream]==[]
        asyncio.run(disconnect())
        assert app.state.analyst.subscribers._value==16


def make_result(types,rows):
    return {'columns':[{'name':name,'type':typ} for name,typ in types], 'rows':rows,'row_count':len(rows)}


@pytest.mark.parametrize('kind,types,rows,x,y',[
 ('bar',[('region','VARCHAR'),('revenue','DOUBLE')],[['A',10],['B',20],['C',None]],0,1),
 ('donut',[('region','VARCHAR'),('revenue','DOUBLE')],[['A',10],['B',20]],0,1),
 ('line',[('period','DATE'),('revenue','DOUBLE')],[['2026-02-01',20],['2026-01-01',10]],0,1),
 ('scatter',[('x','DOUBLE'),('y','DOUBLE')],[[1,3],[2,5]],0,1),
 ('kpi',[('revenue','DOUBLE')],[[30.5]],None,0),
 ('table',[('name','VARCHAR')],[['A']],None,None),
])
def test_chart_supported_types_actual_values(kind,types,rows,x,y):
    result=make_result(types,rows)
    chart=validate_chart({'kind':kind,'x':x,'y':y},result)
    assert chart['spec']['zero_baseline']
    assert kind in [o['kind'] for o in chart_options(result)['options']]
    for point in chart['points']:
        assert point['value']==rows[point['row']][y]
    if kind=='bar':assert chart['omitted_rows']==1
    if kind=='line':assert chart['points'][0]['row']==1


@pytest.mark.parametrize('spec,rows',[
 ({'kind':'bar','x':0,'y':9},[['A',1]]),
 ({'kind':'bar','x':1,'y':0},[['A',1]]),
 ({'kind':'line','x':0,'y':1},[['A',1]]),
 ({'kind':'donut','x':0,'y':1},[['A',-1]]),
 ({'kind':'bar','x':0,'y':1},[['A',1],['A',2]]),
 ({'kind':'bar','x':0,'y':1},[[str(i),i] for i in range(21)]),
 ({'kind':'bar','x':0,'y':1},[['A','9007199254740993'],['B',1]]),
 ({'kind':'bar','x':0,'y':1},[['A',None]]),
 ({'kind':'kpi','y':1},[['A',1],['B',2]]),
 ({'kind':'bar','x':0,'y':1,'zero_baseline':False},[['A',1]]),
 ({'kind':'table','x':0},[['A',1]]),
])
def test_invalid_chart_axes_cardinality_null_precision(spec,rows):
    with pytest.raises(ValueError):validate_chart(spec,make_result([('label','VARCHAR'),('value','DOUBLE')],rows))


def test_evidence_arithmetic_top_share_period_and_grounding():
    result=make_result([('month','DATE'),('sales','DOUBLE')],[['2026-01-01',10],['2026-02-01',20],['2026-03-01',30]])
    evidence=compute_evidence(result)
    facts=evidence['facts']
    by_method={f['method']:f for f in facts}
    assert by_method['total']['value']=='60'
    assert by_method['average']['value']=='20'
    assert by_method['minimum']['value']=='10'
    assert by_method['maximum']['value']=='30'
    assert by_method['period_change']['value']=='10'
    assert by_method['period_change_percent']['value']=='50'
    assert by_method['trend']['value']=='nondecreasing'
    top=next(f for f in facts if f['method']=='top_n')
    assert top['value']=='30' and top['source']['rows']==[2]
    assert next(f for f in facts if f['method']=='share_percent')['value']=='50'
    assert all(f['source']['result_digest']==digest({'columns':result['columns'],'rows':result['rows']}) for f in facts)
    for invalid in ({'fact_ids':['f999']},{'fact_ids':['f1','f1']},{'fact_ids':['f1'],'text':'made up 99%'},{'fact_ids':[]}):
        with pytest.raises(ValueError):ground_narrative(invalid,evidence)
    assert ground_narrative({'fact_ids':['f1']},evidence)[0]['text']==facts[0]['statement']
    negative=compute_evidence(make_result([('x','DOUBLE')],[[-1],[2]]))
    assert not any(f['method']=='share_percent' for f in negative['facts'])
    irregular=compute_evidence(make_result([('at','DATE'),('n','DOUBLE')],[['2026-01-01',0],['2026-01-03',10],['2026-02-09',20]]))
    assert not any(f['method'].startswith('period_') or f['method']=='trend' for f in irregular['facts'])
    zero=compute_evidence(make_result([('at','DATE'),('n','DOUBLE')],[['2026-01-01',0],['2026-01-02',10]]))
    assert not any(f['method']=='period_change_percent' for f in zero['facts'])


def test_chart_endpoint_uses_cached_actual_results(tmp_path):
    with TestClient(create_app(tmp_path,provider=SequenceProvider(['SELECT region, SUM(revenue) AS total FROM data GROUP BY region']),embedder=ControlledEmbedding())) as c:
        run=finish(c,submit(c,dataset(c)))
        endpoint=f'/api/analyst/runs/{run["id"]}/chart'
        assert c.post(endpoint,json={'kind':'bar','x':0,'y':1}).status_code==200
        assert c.post(endpoint,json={'kind':'bar','x':0,'y':8}).status_code==422
        assert c.post(endpoint,json={'kind':'bar','x':0,'y':1,'data':[['invented',999]]}).status_code==422


def test_narrative_provider_strict_contract(monkeypatch):
    import httpx
    monkeypatch.setenv('LLM_API_KEY','test-only')
    monkeypatch.setenv('LLM_MODEL','test-model')
    def boundary(request):
        body=json.loads(request.content)
        assert body['response_format']['json_schema']['name']=='evidence_selection'
        assert body['response_format']['json_schema']['strict']
        return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':'{"fact_ids":["f1"]}'}}], 'usage':{'total_tokens':3,'prompt_tokens':2,'completion_tokens':1}})
    selection,metrics=LLMProvider(httpx.MockTransport(boundary)).narrate('How many?',{'facts':[{'id':'f1','value':'4'}]})
    assert selection=={'fact_ids':['f1']} and metrics['total_tokens']==3


def test_real_local_embeddings_if_provisioned(tmp_path):
    model=Path(os.getenv('EMBEDDING_MODEL_PATH',str(Path(__file__).resolve().parents[2]/'data/models/all-MiniLM-L6-v2')))
    if not (model/'insightiq-model.json').exists():pytest.skip('Local MiniLM assets not provisioned; run provisioning script to enable real embedding smoke.')
    with TestClient(create_app(tmp_path,embedder=SentenceEmbedder(model))) as c:
        identifier=dataset(c)
        result=retrieve(c,identifier,'sales revenue money')
        assert result['status']=='ready',result
        assert any(d['title']=='revenue' for d in result['documents'])


@pytest.mark.parametrize('code',['resource_limit','timeout','sandbox_unavailable','worker_error'])
def test_nonrecoverable_worker_errors_never_retry(tmp_path,monkeypatch,code):
    from app import workflow
    from app.execution import ExecutionError
    calls=[]
    def fail(*args):
        calls.append(1)
        raise ExecutionError('Controlled resource or worker failure.',code)
    monkeypatch.setattr(workflow,'execute_isolated',fail)
    provider=SequenceProvider(['SELECT COUNT(*) FROM data'])
    with TestClient(create_app(tmp_path,provider=provider,embedder=ControlledEmbedding())) as c:
        run=finish(c,submit(c,dataset(c)))
        assert run['status']=='failed' and run['error_code']==code
        assert run['attempts']==1 and len(calls)==1 and len(provider.calls)==1
        assert not any(e['step']=='repair' for e in run['events'])
