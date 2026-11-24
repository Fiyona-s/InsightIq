"""Phase 2 uses temporary datasets and controlled model boundaries exclusively."""
import json,sqlite3
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.main import create_app,AnalystFeedback
from app.provider import Generation
from app.execution import execute_isolated,ExecutionError
from tests.test_analyst import ControlledProvider,dataset,finish,CSV
from tests.test_phase3 import ControlledEmbedding

class ContextProvider(ControlledProvider):
    def __init__(self):super().__init__();self.calls=[]
    def generate(self,question,context):
        self.calls.append(context)
        if question=='ambiguous' and not context.get('clarification_choice'):return Generation(sql=None,clarification='Select a measure.',explanation=''),{}
        return super().generate(question,context)

@pytest.fixture
def workspace(tmp_path):
    provider=ContextProvider();app=create_app(tmp_path,provider=provider,embedder=ControlledEmbedding())
    with TestClient(app) as c:yield c,app,provider,tmp_path

def ask(c,identifier,question='Total revenue',**context):
    r=c.post('/api/analyst/runs',json={'dataset_id':identifier,'question':question,'type_mapping':{'revenue':'DOUBLE'},**context});assert r.status_code==202,r.text
    return finish(c,r.json()['id'])

def test_suggestions_deterministic_real_columns_and_invalidation(workspace):
    c,app,p,root=workspace;identifier=dataset(c)
    items=c.get(f'/api/datasets/{identifier}/suggested-questions').json()
    assert 4<=len(items)<=5 and items==c.get(f'/api/datasets/{identifier}/suggested-questions').json()
    assert all(set(item['columns'])<={'id','revenue','order_date','region'} for item in items)
    assert not any('id' in item['columns'] for item in items if item['kind'] in {'grouped','top','trend'})
    key=app.state.analyst.ux.cache[identifier]['key']
    settings=c.get(f'/api/datasets/{identifier}/knowledge').json()['settings'];settings['description']='Updated user definition'
    c.put(f'/api/datasets/{identifier}/knowledge',json=settings);c.get(f'/api/datasets/{identifier}/suggested-questions')
    assert app.state.analyst.ux.cache[identifier]['key']!=key
    changed_key=app.state.analyst.ux.cache[identifier]['key']
    with app.state.analyst.connector(root/(identifier+'.duckdb'),False) as db:db.execute("UPDATE records SET revenue='15' WHERE id='001'")
    c.get(f'/api/datasets/{identifier}/suggested-questions');assert app.state.analyst.ux.cache[identifier]['key']!=changed_key
    c.post(f'/api/datasets/{identifier}/archive');assert c.get(f'/api/datasets/{identifier}/suggested-questions').json()==[]
    assert not p.calls

def test_structured_clarification_validated_against_actual_schema(workspace):
    c,app,p,_=workspace;identifier=dataset(c);run=ask(c,identifier,'ambiguous')
    assert run['status']=='clarification'
    assert all(v['name'] in {'revenue','region','order_date'} for v in run['clarification_options'])
    completed=ask(c,identifier,'ambiguous',thread_id=run['thread_id'],clarification_choice={'kind':'column','name':'revenue'})
    assert completed['status']=='succeeded' and p.calls[-1]['clarification_choice']=={'kind':'column','name':'revenue'}
    assert c.post('/api/analyst/runs',json={'dataset_id':identifier,'question':'ambiguous','clarification_choice':{'kind':'column','name':'hallucinated'}}).status_code==422

def test_thread_bounded_three_turns_and_dataset_isolation(workspace):
    c,app,p,_=workspace;identifier=dataset(c);thread=str(uuid4())
    runs=[ask(c,identifier,f'Total revenue {i}',thread_id=thread) for i in range(5)]
    context=p.calls[-1]['thread_context_untrusted'];assert len(context)==3
    assert [t['question'] for t in context]==[r['question'] for r in runs[1:4]]
    assert all(set(t)=={'question','executed_sql','result_summary'} for t in context)
    assert all(len(t['result_summary']['rows'])==1 for t in context)
    second=dataset(c)
    assert c.post('/api/analyst/runs',json={'dataset_id':second,'question':'Total','thread_id':thread}).status_code==409
    assert ask(c,second,thread_id=str(uuid4()))['thread_context']==[]

@pytest.mark.parametrize('aggregate',[True,False])
def test_summary_never_contains_full_tables(workspace,aggregate):
    _,app,_,_=workspace
    result={'columns':[{'name':'region','type':'VARCHAR'},{'name':'amount','type':'DOUBLE'}],'rows':[['x'*1000,i] for i in range(100)],'row_count':100}
    summary=app.state.analyst.ux.summary(result,'SELECT region,SUM(amount) FROM data GROUP BY region' if aggregate else 'SELECT region,amount FROM data')
    assert summary['rows']==[]
    assert summary['values_omitted'] is aggregate

def test_feedback_persists_changes_once_and_cannot_enter_prompt_or_rag(workspace):
    c,app,p,_=workspace;identifier=dataset(c);run=ask(c,identifier);endpoint=f'/api/analyst/runs/{run["id"]}/feedback';secret='FEEDBACK_SENTINEL_NEVER_IN_PROMPT'
    assert c.get(endpoint).json()['rating'] is None
    assert c.put(endpoint,json={'rating':'helpful'}).status_code==200
    assert c.put(endpoint,json={'rating':'not_helpful','reason':secret}).status_code==200
    with Session(app.state.analyst.engine) as s:assert len(list(s.scalars(select(AnalystFeedback))))==1
    assert c.get(endpoint).json()['reason']==secret
    assert c.put(endpoint,json={'rating':'verified'}).status_code==422
    assert c.put(endpoint,json={'rating':'not_helpful','reason':'x'*501}).status_code==422
    ask(c,identifier,thread_id=run['thread_id'])
    assert secret not in json.dumps(p.calls)
    docs,_,_=app.state.knowledge.documents(identifier,{'revenue':'DOUBLE'})
    assert secret not in json.dumps(docs)
    counts=c.get('/api/analytics/runs').json()['feedback_counts'];assert counts=={'helpful':0,'not_helpful':1}
    assert c.post(f'/api/datasets/{identifier}/knowledge/examples',json={'run_id':run['id'],'expected_result_digest':run['result_digest']}).status_code==409

def test_benchmark_gold_never_retrieved_even_as_knowledge(workspace):
    c,app,p,_=workspace;identifier=dataset(c)
    app.state.store.save('BenchmarkInstall',{'id':str(uuid4()),'dataset_id':identifier,'version':'retail-v1'})
    settings=c.get(f'/api/datasets/{identifier}/knowledge').json()['settings'];settings['description']='BENCHMARK_GOLD_QUESTION_AND_ANSWER'
    c.put(f'/api/datasets/{identifier}/knowledge',json=settings)
    docs,_,_=app.state.knowledge.documents(identifier);assert docs==[]
    retrieval=c.post(f'/api/datasets/{identifier}/knowledge/retrieve',json={'question':'revenue'}).json()
    assert not retrieval.get('documents')
    run=ask(c,identifier);assert run['status']=='succeeded'
    assert 'BENCHMARK_GOLD' not in json.dumps(p.calls)

@pytest.mark.parametrize('sql',['DELETE FROM data','SELECT * FROM data; SELECT * FROM data',"SELECT * FROM read_csv('/etc/passwd')",'CREATE TABLE stolen AS SELECT * FROM data'])
def test_followups_use_same_ast_guard(workspace,sql):
    c,app,p,root=workspace;identifier=dataset(c);first=ask(c,identifier);p.sql=sql
    run=ask(c,identifier,thread_id=first['thread_id']);assert run['status']=='failed' and run['error_code'] in {'validation_error','repeated_sql'}
    assert c.get(f'/api/datasets/{identifier}/preview').json()['total']==4

def test_limits_and_real_execution_deadline(workspace):
    c,app,p,root=workspace;identifier=dataset(c,b'id,revenue\n'+b'1,2\n'*1001);p.sql='SELECT * FROM data'
    run=ask(c,identifier);assert run['error_code']=='result_limit'
    with pytest.raises(ExecutionError) as exc:execute_isolated(root/(identifier+'.duckdb'),'SELECT COUNT(*) FROM data',timeout=0)
    assert exc.value.code=='timeout'

def test_additive_migration_retains_old_rows_and_backups(workspace):
    c,app,p,root=workspace;identifier=dataset(c);run=ask(c,identifier)
    # Restarting a current schema is idempotent; original payload remains byte-for-byte.
    with sqlite3.connect(root/'catalog.sqlite') as db:
        before=db.execute('SELECT payload FROM analyst_runs WHERE id=?',(run['id'],)).fetchone()[0]
        assert 'thread_id' in {r[1] for r in db.execute('PRAGMA table_info(analyst_runs)')}
    with TestClient(create_app(root,provider=p,embedder=ControlledEmbedding())) as restarted:
        assert restarted.get('/api/analyst/runs/'+run['id']).json()['thread_id']==run['thread_id']
    with sqlite3.connect(root/'catalog.sqlite') as db:assert db.execute('SELECT payload FROM analyst_runs WHERE id=?',(run['id'],)).fetchone()[0]==before

def test_upgrade_old_run_payload_is_untouched(tmp_path):
    payload=json.dumps({'id':'legacy-run','status':'succeeded','question':'Original question','executed_sql':'SELECT COUNT(*) FROM data'})
    with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
        db.execute('CREATE TABLE analyst_runs (id TEXT PRIMARY KEY,dataset_id TEXT,status TEXT,created_at TEXT,payload TEXT)')
        db.execute('INSERT INTO analyst_runs VALUES (?,?,?,?,?)',('legacy-run','legacy-dataset','succeeded','2026-01-01',payload))
    with TestClient(create_app(tmp_path,provider=ContextProvider(),embedder=ControlledEmbedding())):pass
    with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
        assert db.execute('SELECT payload,thread_id FROM analyst_runs').fetchone()==(payload,None)
        assert db.execute("SELECT name FROM sqlite_master WHERE name='analyst_feedback'").fetchone()
    backup=next((tmp_path/'backups').glob('analyst-v5-*/catalog.sqlite'))
    with sqlite3.connect(backup) as db:
        assert 'thread_id' not in {r[1] for r in db.execute('PRAGMA table_info(analyst_runs)')}
        assert db.execute('SELECT payload FROM analyst_runs').fetchone()[0]==payload


def test_evaluation_turns_cannot_leak_into_thread_context(workspace):
    from app.analyst import AskRequest
    c,app,p,_=workspace;identifier=dataset(c)
    run=app.state.analyst.submit(AskRequest(dataset_id=identifier,question='Controlled evaluation turn',type_mapping={'revenue':'DOUBLE'}),activity_kind='evaluation')
    done=finish(c,run['id']);assert done['status']=='succeeded'
    response=c.post('/api/analyst/runs',json={'dataset_id':identifier,'question':'Follow up','thread_id':done['thread_id']})
    assert response.status_code==409 and 'Evaluation turns' in response.text


def test_legacy_replay_examples_remain_stored_but_never_enter_retrieval(workspace):
    c,app,p,_=workspace;identifier=dataset(c);key=str(uuid4());payload=json.dumps({'question':'LEGACY_REPLAY_SENTINEL','sql':'SELECT COUNT(*) FROM data','independently_verified':True,'approved_at':'untrusted marker'})
    with Session(app.state.analyst.engine) as session:
        session.add(app.state.knowledge.Example(id=key,workspace_id=app.state.knowledge.workspace_id,dataset_id=identifier,payload=payload));session.commit()
    docs,_,_=app.state.knowledge.documents(identifier)
    assert 'LEGACY_REPLAY_SENTINEL' not in json.dumps(docs)
    with Session(app.state.analyst.engine) as session:assert session.get(app.state.knowledge.Example,key).payload==payload

RETAIL=(b'order_id,region,quantity,unit_price,discount_pct,order_date\n'
        +b''.join(f'{i:03d},{["North","West","East"][i%3]},{i%5+1},{10+i},{i%4*5},2026-01-{i%27+1:02d}\n'.encode() for i in range(1,41)))

def test_suggestions_never_total_undefined_or_percentage_columns_and_show_plain_names(workspace):
    """Stage 3 (D3): the first numeric column alphabetically no longer wins; no quoted column names."""
    c,app,p,_=workspace;identifier=dataset(c,RETAIL)
    items=c.get(f'/api/datasets/{identifier}/suggested-questions').json()
    text=' '.join(i['question'] for i in items)
    assert '"' not in text
    assert not any(i['kind'] in {'total','grouped','top','trend','average'} for i in items)  # nothing defined yet
    assert not any('discount_pct' in i['question'] and 'total' in i['question'].lower() for i in items)
    # The owner defines a real measure and a percentage column: only the measure gets totals.
    settings=c.get(f'/api/datasets/{identifier}/knowledge').json()['settings']
    settings['columns']={'unit_price':'Price of one unit','discount_pct':'Discount in percent'}
    assert c.put(f'/api/datasets/{identifier}/knowledge',json=settings).status_code==200
    items=c.get(f'/api/datasets/{identifier}/suggested-questions').json()
    questions=[i['question'] for i in items]
    assert 'What is the total of unit_price?' in questions
    assert not any('total' in q.lower() and 'discount_pct' in q for q in questions)
    assert all('"' not in q for q in questions)
    assert all(set(i['columns'])<={'order_id','region','quantity','unit_price','discount_pct','order_date'} for i in items)
    assert not p.calls
