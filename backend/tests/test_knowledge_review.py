"""Controlled Phase 5 trust boundaries; no external model requests."""
import json
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.provider import LLMProvider
from app.knowledge_review import DraftOutput
from tests.test_phase3 import ControlledEmbedding, SequenceProvider
from tests.test_analyst import dataset, submit, finish


class DraftProvider(SequenceProvider):
    def __init__(self):
        super().__init__(['SELECT SUM(revenue) AS total FROM data'])
        self.output={'description':'DRAFT PRIVATE MARKER', 'columns':[{'name':'revenue','description':'Reviewed amount definition'}],
            'metrics':[{'name':'Draft total','description':'DRAFT METRIC MARKER','sql':'SELECT SUM(TRY_CAST(revenue AS DOUBLE)) AS total FROM data'}]}
    def draft_knowledge(self,payload):
        return self.output,{'model':'controlled-only'}


def setup(tmp_path):
    provider=DraftProvider()
    return TestClient(create_app(tmp_path,provider=provider,embedder=ControlledEmbedding())),provider


def route(c):
    identifier=dataset(c)
    return identifier,f'/api/datasets/{identifier}/knowledge'


def overview(c,path):return c.get(path+'/review').json()
def draft(c,path):
    r=c.post(path+'/drafts',json={'confirm_sharing':True});assert r.status_code==200,r.text
    return r.json()
def review(c,path,row,action='approve',**extra):
    return c.patch(path+'/drafts/'+row['id'],json={'action':action,'confirm_revision':overview(c,path)['revision'],**extra})
def candidate(c,identifier,path):
    run=finish(c,submit(c,identifier,question='Compute revenue for my independently reviewed example',mapping={'revenue':'DOUBLE'}))
    assert run['status']=='succeeded',run
    r=c.post(path+'/candidates',json={'run_id':run['id']});assert r.status_code==200,r.text
    return r.json(),run

def expected(value=30.5):return {'columns':[{'name':'total','type':'DOUBLE'}],'rows':[[value]],'row_count':1}
def check(c,path,row,**extra):
    return c.post(path+'/candidates/'+row['id']+'/check',json={'reference_type':'expected','independently_authored':True,'expected':expected(),**extra})
def approve(c,path,row):return c.post(path+'/candidates/'+row['id']+'/approve',json={'approve':True,'revision':overview(c,path)['revision']})


def test_drafts_excluded_from_retrieval_prompts_and_suggestions_until_approval(tmp_path):
    client,provider=setup(tmp_path)
    with client as c:
        identifier,path=route(c)
        before=c.app.state.knowledge.documents(identifier)[1]
        rows=draft(c,path)
        assert c.get(path).json()['settings']['description']==''
        docs,fp,_=c.app.state.knowledge.documents(identifier)
        assert before==fp and 'DRAFT PRIVATE MARKER' not in json.dumps(docs)
        assert 'DRAFT METRIC MARKER' not in json.dumps(c.app.state.analyst.ux.suggestions(identifier))
        run=finish(c,submit(c,identifier));assert run['status']=='succeeded'
        assert 'DRAFT PRIVATE MARKER' not in json.dumps(provider.calls)
        assert review(c,path,rows[0]).status_code==200
        assert c.get(path).json()['settings']['description']=='DRAFT PRIVATE MARKER'
        assert c.app.state.knowledge.documents(identifier)[1]!=before
        assert review(c,path,rows[1],action='reject').status_code==200
        assert c.get(path).json()['settings']['columns']=={}


def test_draft_payload_allowlist_and_serialized_messages_exclude_samples_quality_and_rows(tmp_path,monkeypatch):
    monkeypatch.setenv('LLM_API_KEY','controlled');monkeypatch.setenv('LLM_MODEL','controlled');monkeypatch.setenv('LLM_BASE_URL','https://controlled.invalid/v1')
    captured=[]
    def transport(request):
        payload=json.loads(request.content);captured.append(payload)
        return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps({'description':'Unconfirmed context','columns':[],'metrics':[]})}}]})
    with TestClient(create_app(tmp_path,provider=LLMProvider(httpx.MockTransport(transport)))) as c:
        result=c.post('/api/datasets',files={'file':('throwaway.csv',b'account,revenue\nSECRET_SAMPLE_SENTINEL,12\nQUALITY_SENTINEL,bad\n')})
        path='/api/datasets/'+result.json()['id']
        c.get(path+'/profile-details');c.get(path+'/quality');assert not captured
        draft(c,path+'/knowledge')
        assert len(captured)==1
        value=json.loads(captured[0]['messages'][1]['content'])
        assert set(value)=={'dataset_name','row_count','columns'}
        assert all(set(col)=={'name','inferred_type','count','null_count','unique_count'} for col in value['columns'])
        serialized=json.dumps(captured[0]['messages'])
        assert not any(v in serialized for v in ['SECRET_SAMPLE_SENTINEL','QUALITY_SENTINEL'])
        assert value['row_count']==2 and value['columns'][0]['unique_count']==2


@pytest.mark.parametrize('change',[lambda x:x.update(currency='INR'),lambda x:x['columns'].append({'name':'unknown','description':'x'}),lambda x:x['metrics'][0].update(unit='USD'),lambda x:x.update(columns=[{'name':'revenue','description':'a'},{'name':'revenue','description':'b'}])])
def test_invalid_draft_leaves_no_partial_writes(tmp_path,change):
    client,provider=setup(tmp_path)
    with client as c:
        _,path=route(c);change(provider.output)
        assert c.post(path+'/drafts',json={'confirm_sharing':True}).status_code in {422,502}
        assert overview(c,path)['drafts']==[] and c.get(path).json()['settings']['description']==''


@pytest.mark.parametrize('sql,passes',[("DELETE FROM data",False),("SELECT CAST('bad' AS DOUBLE) AS total FROM data",False),("SELECT SUM(TRY_CAST(revenue AS DOUBLE)) AS total FROM data",True)])
def test_metric_guard_execution_and_edit_recheck(tmp_path,sql,passes):
    client,provider=setup(tmp_path)
    with client as c:
        _,path=route(c);provider.output['metrics'][0]['sql']=sql
        row=draft(c,path)[-1];assert row['check']['passed']==passes
        assert (review(c,path,row).status_code==200)==passes
        if not passes:
            content={**row['content'],'name':'Edited count','sql':'SELECT COUNT(*) AS total FROM data'}
            assert review(c,path,row,action='edit',content=content).status_code==200
            assert review(c,path,row).status_code==200


def test_human_overwrite_requires_replace_and_shared_column_store(tmp_path):
    client,_=setup(tmp_path)
    with client as c:
        identifier,path=route(c);settings=c.get(path).json()['settings'];settings['description']='Human original'
        assert c.put(path,json=settings).status_code==200
        rows=draft(c,path)
        assert review(c,path,rows[0]).status_code==409
        assert c.get(path).json()['settings']['description']=='Human original'
        assert review(c,path,rows[0],replace_existing=True).status_code==200
        assert review(c,path,rows[1]).status_code==200
        assert c.get(f'/api/datasets/{identifier}/profile-details').json()['columns'][1]['description']=='Reviewed amount definition'


def test_replay_only_and_no_reference_cannot_create_trusted_example(tmp_path):
    client,_=setup(tmp_path)
    with client as c:
        identifier,path=route(c);row,run=candidate(c,identifier,path)
        assert approve(c,path,row).status_code==409
        response=c.post(path+'/candidates/'+row['id']+'/check',json={'reference_type':'sql','independently_authored':True,'reference_sql':run['executed_sql']})
        assert response.status_code==422 and 'independent' in response.text
        assert not c.app.state.knowledge.review.trusted(identifier)
        assert not any(d['kind']=='example' for d in c.app.state.knowledge.documents(identifier)[0])


def test_reference_match_mismatch_approval_revision_and_delete(tmp_path):
    client,_=setup(tmp_path)
    with client as c:
        identifier,path=route(c);row,_=candidate(c,identifier,path)
        assert row['revision_number']==1
        bad=check(c,path,row,expected=expected(999));assert bad.status_code==200 and bad.json()['status']=='reference_failed'
        good=check(c,path,row);assert good.status_code==200 and good.json()['check']['passed'],good.text
        assert approve(c,path,row).status_code==200
        assert any(d['kind']=='example' for d in c.app.state.knowledge.documents(identifier)[0])
        base=f'/api/datasets/{identifier}';first=c.get(base+'/rows').json()['rows'][0]
        assert c.post(base+'/edits',json={'expected_version':1,'updates':[{'id':first['id'],'values':{'revenue':'11'}}]}).status_code==200
        assert overview(c,path)['examples'][0]['status']=='needs_recheck'
        assert overview(c,path)['revision_number']==2
        assert not any(d['kind']=='example' for d in c.app.state.knowledge.documents(identifier)[0])
        assert c.request('DELETE',path+'/candidates/'+row['id'],json={'confirm':True}).status_code==200
        assert not overview(c,path)['examples']


def test_independent_sql_reference_passes_numeric_comparison(tmp_path):
    client,_=setup(tmp_path)
    with client as c:
        identifier,path=route(c);row,_=candidate(c,identifier,path)
        response=c.post(path+'/candidates/'+row['id']+'/check',json={'reference_type':'sql','independently_authored':True,'reference_sql':'SELECT SUM(revenue + 0) AS total FROM data'})
        assert response.status_code==200 and response.json()['check']['passed'],response.text
        assert approve(c,path,row).status_code==200


def test_stale_drafts_archived_readonly_and_helpful_does_not_promote(tmp_path):
    client,_=setup(tmp_path)
    with client as c:
        identifier,path=route(c);rows=draft(c,path);row,run=candidate(c,identifier,path)
        before=overview(c,path)['examples']
        assert c.put('/api/analyst/runs/'+run['id']+'/feedback',json={'rating':'helpful'}).status_code==200
        assert overview(c,path)['examples']==before
        base=f'/api/datasets/{identifier}';cell=c.get(base+'/rows').json()['rows'][0]
        c.post(base+'/edits',json={'expected_version':1,'updates':[{'id':cell['id'],'values':{'revenue':'11'}}]})
        assert all(d['stale'] for d in overview(c,path)['drafts'])
        assert c.patch(path+'/drafts/'+rows[0]['id'],json={'action':'approve','confirm_revision':rows[0]['revision']}).status_code==409
        c.post(base+'/archive')
        assert c.get(path+'/review').status_code==200
        assert c.post(path+'/drafts',json={'confirm_sharing':True}).status_code==409
        assert review(c,path,rows[0]).status_code==409
        assert c.put(path,json=c.get(path).json()['settings']).status_code==409


def test_one_active_draft_per_dataset_and_failure_cleanup(tmp_path):
    client,provider=setup(tmp_path);entered=threading.Event();release=threading.Event()
    def blocked(payload):entered.set();release.wait(10);raise ValueError('Controlled provider failure')
    provider.draft_knowledge=blocked
    with client as c:
        _,path=route(c)
        with ThreadPoolExecutor(1) as pool:
            first=pool.submit(c.post,path+'/drafts',json={'confirm_sharing':True})
            assert entered.wait(5)
            assert c.post(path+'/drafts',json={'confirm_sharing':True}).status_code==429
            release.set();assert first.result().status_code==502
        assert overview(c,path)['drafts']==[]
        assert not c.app.state.knowledge.review.active


def test_legacy_rows_preserved_excluded_and_explicit_reverification(tmp_path):
    from sqlalchemy.orm import Session
    from app.knowledge import stamp
    client,_=setup(tmp_path)
    with client as c:
        identifier,path=route(c);key=str(uuid4());legacy={'question':'My legacy record question','sql':'SELECT COUNT(*) AS total FROM data'}
        k=c.app.state.knowledge
        with Session(k.engine) as session:
            session.add(k.Example(id=key,workspace_id=k.workspace_id,dataset_id=identifier,payload=json.dumps(legacy)));session.commit()
        rows=overview(c,path)['examples'];assert rows[0]['id']==key and rows[0]['status']=='legacy'
        assert not any(d['kind']=='example' for d in k.documents(identifier)[0])
        result=c.post(path+'/legacy/'+key+'/reverify');assert result.status_code==200,result.text
        row=result.json();assert row['status']=='candidate'
        assert check(c,path,row,expected={'columns':[{'name':'total','type':'BIGINT'}],'rows':[[4]],'row_count':1}).json()['check']['passed']
        assert approve(c,path,row).status_code==200
        assert len(k.review.trusted(identifier))==1
        with sqlite3.connect(tmp_path/'catalog.sqlite') as db:assert json.loads(db.execute('SELECT payload FROM knowledge_examples WHERE id=?',(key,)).fetchone()[0])==legacy


def test_benchmark_dataset_and_benchmark_qa_always_outside_rag(tmp_path):
    from app.benchmark import authored_cases
    from sqlalchemy.orm import Session
    client,_=setup(tmp_path)
    with client as c:
        identifier,path=route(c);row,run=candidate(c,identifier,path);service=c.app.state.knowledge.review
        record=service.find(service.Example,identifier,row['id']);record['question']=authored_cases()[0]['question']
        with Session(service.k.engine) as session:service.save(service.Example,record,session);session.commit()
        assert check(c,path,row).status_code==409
        assert approve(c,path,row).status_code==409
        store=service.k.analyst.store
        store.save('BenchmarkInstall',{'id':str(uuid4()),'dataset_id':identifier,'updated_at':'now'})
        assert c.post(path+'/candidates',json={'run_id':run['id']}).status_code==409
        assert service.k.documents(identifier)[0]==[]
        assert service.k.retrieve(identifier,'benchmark gold')['documents']==[]


def test_additive_migration_backup_preserves_original_rows_and_storage(tmp_path):
    from hashlib import sha256
    client,_=setup(tmp_path)
    with client as c:
        identifier,path=route(c)
        settings=c.get(path).json()['settings'];settings['description']='Original human knowledge';c.put(path,json=settings)
    raw=(tmp_path/(identifier+'.duckdb')).read_bytes()
    with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
        before=db.execute('SELECT * FROM knowledge_state').fetchall()
        db.execute('DROP TABLE knowledge_drafts');db.execute('DROP TABLE knowledge_review_examples');db.execute('DELETE FROM schema_migrations WHERE version=7');db.commit()
    client,_=setup(tmp_path)
    with client as c:
        assert c.get(path).json()['settings']['description']=='Original human knowledge'
        with sqlite3.connect(tmp_path/'catalog.sqlite') as db:assert db.execute('SELECT * FROM knowledge_state').fetchall()==before
        assert (tmp_path/(identifier+'.duckdb')).read_bytes()==raw
        backups=list((tmp_path/'backups').glob('knowledge-v7-*'));assert len(backups)==1
        with sqlite3.connect(backups[0]/'catalog.sqlite') as db:
            assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='knowledge_drafts'").fetchone()
            assert db.execute('SELECT * FROM knowledge_state').fetchall()==before
        assert sha256((backups[0]/'storage'/(identifier+'.duckdb')).read_bytes()).digest()==sha256(raw).digest()


def test_malformed_json_provider_response_saves_nothing(tmp_path,monkeypatch):
    monkeypatch.setenv('LLM_API_KEY','controlled');monkeypatch.setenv('LLM_MODEL','controlled')
    transport=httpx.MockTransport(lambda request:httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':'malformed{'}}]}))
    with TestClient(create_app(tmp_path,provider=LLMProvider(transport))) as c:
        _,path=route(c)
        assert c.post(path+'/drafts',json={'confirm_sharing':True}).status_code==502
        assert overview(c,path)['drafts']==[]


def test_bulk_approval_preflights_count_duplicate_targets_and_stale_items(tmp_path):
    client,_=setup(tmp_path)
    with client as c:
        _,path=route(c);first=draft(c,path);second=draft(c,path);revision=overview(c,path)['revision']
        target=path+'/drafts/approve-all'
        assert c.post(target,json={'ids':[first[0]['id']],'confirm_count':2,'confirm_revision':revision}).status_code==422
        assert c.post(target,json={'ids':[first[0]['id'],second[-3]['id']],'confirm_count':2,'confirm_revision':revision}).status_code==409
        assert c.get(path).json()['settings']['description']==''
        assert c.post(target,json={'ids':[first[0]['id']],'confirm_count':1,'confirm_revision':'stale'}).status_code==409
        assert c.post(target,json={'ids':[first[0]['id'],first[1]['id']],'confirm_count':2,'confirm_revision':revision}).status_code==200
