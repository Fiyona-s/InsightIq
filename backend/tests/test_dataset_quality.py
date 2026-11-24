import json
import sqlite3
from unittest.mock import Mock
from fastapi.testclient import TestClient
from app.main import create_app
from tests.test_phase3 import ControlledEmbedding
from tests.test_analyst import ControlledProvider,submit,finish


def upload(c,raw):
    r=c.post('/api/datasets',files={'file':('quality.csv',raw.encode())});assert r.status_code==201,r.text
    return '/api/datasets/'+r.json()['id']


def test_quality_counts_duplicates_type_issues_and_bounded_examples(tmp_path):
    raw='account,number,day,empty,constant\n'+''.join(f'{i:03},{i},2026-01-01,,same\n' for i in range(8))+'008,bad,not-date,,same\n008,bad,not-date,,same\n'
    with TestClient(create_app(tmp_path)) as c:
        path=upload(c,raw);q=c.get(path+'/quality').json()
        assert q['rows']==10 and q['duplicate_rows']==1
        assert q['empty_columns']==['empty'] and q['constant_columns']==['constant']
        assert q['columns'][3]['missing']==10 and q['columns'][3]['missing_percent']==100
        assert {i['expected']:i['count'] for i in q['type_issues']}=={'numeric':2,'date':2}
        assert q['type_issues'][0]['examples']==['bad']
        profile=c.get(path+'/profile-details').json()
        assert profile['columns'][0]['inferred_type']=='VARCHAR'
        assert profile['columns'][0]['nullable'] is True
        assert profile['columns'][0]['samples'][0]=='000'
        assert profile['columns'][3]['unique_count']==0
        assert profile['columns'][0]['description']==''


def test_cache_invalidation_save_restore_no_raw_cache_rows(tmp_path):
    with TestClient(create_app(tmp_path)) as c:
        path=upload(c,'id,value\n001,10\n001,10\n');identifier=path.split('/')[-1]
        first=c.get(path+'/quality').json();cached=c.app.state.quality.cache[identifier]
        assert 'samples' not in json.dumps(cached) and 'rows' not in cached['columns'][0]
        assert c.get(path+'/quality').json()==first
        rid=c.get(path+'/rows').json()['rows'][0]['id']
        assert c.post(path+'/edits',json={'expected_version':1,'updates':[{'id':rid,'values':{'value':None}}]}).status_code==200
        second=c.get(path+'/quality').json();assert second['revision']==2 and second['duplicate_rows']==0 and second['columns'][1]['missing']==1
        assert c.post(path+'/revisions/1/restore',json={'expected_version':2,'confirm_restore':True,'has_unsaved_edits':False}).status_code==200
        third=c.get(path+'/quality').json();assert third['revision']==3 and third['duplicate_rows']==1 and third['columns'][1]['missing']==0


def test_description_bridge_preserves_other_knowledge_and_is_bidirectional(tmp_path):
    with TestClient(create_app(tmp_path)) as c:
        path=upload(c,'value\n10\n');info=c.get(path+'/knowledge').json();settings=info['settings']
        settings['description']='Shared business definition';settings['columns']['value']='From knowledge'
        assert c.put(path+'/knowledge',json=settings).status_code==200
        assert c.get(path+'/profile-details').json()['columns'][0]['description']=='From knowledge'
        response=c.patch(path+'/column-description',json={'column':'value','description':'From profile'})
        assert response.status_code==200,response.text
        saved=c.get(path+'/knowledge').json()['settings'];assert saved['description']=='Shared business definition' and saved['columns']['value']=='From profile'
        assert c.patch(path+'/column-description',json={'column':'foreign','description':'x'}).status_code==422
        assert c.patch(path+'/column-description',json={'column':'value','description':'x'*501}).status_code==422
        assert c.post(path+'/archive').status_code==200
        assert c.patch(path+'/column-description',json={'column':'value','description':'blocked'}).status_code==409
        with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
            assert not any('description' in r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'"))


def test_sample_and_quality_values_do_not_enter_model_context(tmp_path,monkeypatch):
    import httpx
    from app.provider import LLMProvider
    monkeypatch.setenv('LLM_API_KEY','controlled-no-live-key')
    monkeypatch.setenv('LLM_MODEL','controlled-prompt-verification')
    monkeypatch.setenv('LLM_BASE_URL','https://controlled.invalid/v1')
    captured=[]
    def transport(request):
        payload=json.loads(request.content)
        captured.append(payload)
        name=payload['response_format']['json_schema']['name']
        result={'fact_ids':['f1']} if name=='evidence_selection' else {'sql':'SELECT SUM(revenue) AS total FROM data','clarification':None,'explanation':'Controlled aggregate.'}
        return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(result)}}],'usage':{'prompt_tokens':10,'completion_tokens':5,'total_tokens':15}})
    provider=LLMProvider(httpx.MockTransport(transport));embed=ControlledEmbedding()
    with TestClient(create_app(tmp_path,provider=provider,embedder=embed)) as c:
        path=upload(c,'account,revenue\nPRIVATE-PROFILE-SENTINEL,10\nOTHER-PROFILE-SENTINEL,20\n');identifier=path.split('/')[-1]
        assert c.get(path+'/quality').status_code==200
        samples=c.get(path+'/profile-details').json()['columns'][0]['samples']
        assert samples==['PRIVATE-PROFILE-SENTINEL','OTHER-PROFILE-SENTINEL']
        assert captured==[], 'Viewing schema/quality must not call the model.'
        run=submit(c,identifier,mapping={'revenue':'DOUBLE'});assert finish(c,run)['status']=='succeeded'
        assert {p['response_format']['json_schema']['name'] for p in captured}=={'sql_plan','evidence_selection'}
        for payload in captured:
            messages=json.dumps(payload['messages'])
            assert 'PRIVATE-PROFILE-SENTINEL' not in messages
            assert 'OTHER-PROFILE-SENTINEL' not in messages


def test_examples_are_truncated_and_cache_is_bounded(tmp_path):
    with TestClient(create_app(tmp_path)) as c:
        values=[str(i) for i in range(40)]+['z'+str(i)+'x'*300 for i in range(10)]
        path=upload(c,'number\n'+'\n'.join(values)+'\n')
        q=c.get(path+'/quality').json();issue=q['type_issues'][0]
        assert issue['count']==10 and len(issue['examples'])==5 and all(len(v)==100 for v in issue['examples'])
        profile=c.get(path+'/profile-details').json();assert all(len(v)<=100 for v in profile['columns'][0]['samples'])


def test_header_only_single_row_and_all_null(tmp_path):
    with TestClient(create_app(tmp_path)) as c:
        for raw,expected in [('a,b\n',(0,[],[])),('a,b\nx,\n',(1,['b'],['a'])),('a,b\n,\n,\n',(2,['a','b'],[]))]:
            path=upload(c,raw);q=c.get(path+'/quality').json()
            assert (q['rows'],q['empty_columns'],q['constant_columns'])==expected
            assert all(0<=col['missing_percent']<=100 for col in q['columns'])
