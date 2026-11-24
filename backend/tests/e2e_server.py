"""Controlled provider for browser integration only; excluded from production images.
No frontend/API mocks: generation crosses the real HTTP provider adapter's transport
boundary; guards, worker, DuckDB, persistence and API all run normally.
"""
import json
import os
import tempfile
import time
import httpx
from app.main import create_app
from app.provider import LLMProvider
from tests.test_phase3 import ControlledEmbedding
from app.benchmark import authored_cases

os.environ['LLM_MODEL'] = 'controlled-browser-test'
os.environ['LLM_API_KEY'] = 'test-boundary-not-a-real-key'
os.environ['LLM_INPUT_USD_PER_MILLION']='1'
os.environ['LLM_OUTPUT_USD_PER_MILLION']='2'


def controlled_model(request):
    payload = json.loads(request.content)
    assert payload['response_format']['json_schema']['strict'] is True
    request_data = json.loads(payload['messages'][1]['content'])
    if payload['response_format']['json_schema']['name'] == 'knowledge_draft':
        assert set(request_data) == {'dataset_name', 'row_count', 'columns'}
        assert all(set(c) == {'name', 'inferred_type', 'count', 'null_count', 'unique_count'} for c in request_data['columns'])
        assert 'PRIVATE_DRAFT_SENTINEL' not in json.dumps(payload['messages'])
        result = {'description': 'Controlled draft for review; business meaning unconfirmed.',
                  'columns': [{'name': c['name'], 'description': 'Controlled description of ' + c['name']} for c in request_data['columns']],
                  'metrics': [{'name': 'Reviewed total', 'description': 'Sum of numeric revenue; review required.', 'sql': 'SELECT SUM(TRY_CAST(revenue AS DOUBLE)) AS total_revenue FROM data'}]}
        return httpx.Response(200, json={'model': 'controlled-browser-test', 'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(result)}}]})
    context = request_data['schema']
    if payload['response_format']['json_schema']['name'] == 'evidence_selection':
        return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'fact_ids': ['f1','f2']})}}], 'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15}})
    time.sleep(.3)  # Exposes real SSE progress while the controlled model responds.
    question = request_data['question']
    case=next((c for c in authored_cases() if c['question']==question),None)
    sql = case['reference_sql'] if case else 'SELECT SUM(revenue) AS total_revenue FROM data'
    # Explicit controlled regression: reproduce a value-correct alias-only failure.
    if case and case['id']=='q05':
        sql='SELECT COUNT(*) AS order_record_count FROM data'
    if question == 'Legacy recognized revenue audit':
        sql = 'SELECT SUM(TRY_CAST(revenue AS DOUBLE)) AS total_recognized_revenue_inr FROM data'
    if question == 'How many orders are there?':
        sql = 'SELECT COUNT(*) AS orders FROM data'
    if 'by region' in question.casefold():
        sql = 'SELECT region, SUM(revenue) AS total_revenue FROM data GROUP BY region ORDER BY region'
        if 'retry' in question.casefold() and 'repair_untrusted' not in context:
            sql = 'SELECT hallucinated_column FROM data'

    if question=='PHASE2 slow total':time.sleep(1)
    if question=='PHASE2 show rows':sql='SELECT id,revenue,region FROM data ORDER BY id'
    if question=='PHASE2 empty':sql='SELECT revenue FROM data WHERE revenue<0'
    if question=='PHASE2 unsafe query':sql='DELETE FROM data'
    phase2_clarification=question=='PHASE2 ambiguous' and not context.get('clarification_choice')
    if phase2_clarification:sql=None
    assert {'name': 'revenue', 'type': 'DOUBLE'} in context['columns']
    return httpx.Response(200, json={'model': 'controlled-browser-test', 'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({
        'sql': sql, 'clarification': 'Please choose the measure.' if phase2_clarification else 'Please clarify the missing metric or authorized data.' if case and sql is None else None,
        'explanation': 'Sum the confirmed numeric revenue values; failed conversions are NULL.'})}}],
        'usage': {'prompt_tokens': 50, 'completion_tokens': 25, 'total_tokens': 75}})


from datetime import date
os.environ['FX_PROVIDER'] = 'frankfurter'

def controlled_fx(source, target, day):
    # Synthetic deterministic test rates only; never used by the production app.
    return {'base': source, 'quote': target, 'date': day or date.today().isoformat(), 'rate': {'USD':'0.0125','EUR':'0.01','GBP':'0.008'}[target]}

app = create_app(tempfile.mkdtemp(prefix='insightiq-e2e-'), provider=LLMProvider(httpx.MockTransport(controlled_model)), embedder=ControlledEmbedding(), fx_fetch=controlled_fx)

# Test-only pre-snapshot fixture. It creates a NEW dataset in the disposable e2e
# root using the old import primitives, so revision 1 genuinely has no snapshot.
# This router and all controlled providers are excluded from production images.
@app.post('/api/test/phase4/legacy-dataset')
def legacy_dataset_fixture():
    from app.main import Dataset, connect, info, quote
    from uuid import uuid4
    from datetime import datetime, timezone
    from sqlalchemy.orm import Session
    root=app.state.editor.root
    assert root.name.startswith('insightiq-e2e-')
    identifier=str(uuid4());header=['account','revenue','note']
    raw='account,revenue,note\n001,10,"你好,quoted\nsecond line"\n002,20,plain\n'.encode()
    rows=[['001','10','你好,quoted\nsecond line'],['002','20','plain']]
    with app.state.lifecycle.admission_lock, app.state.knowledge.lock:
        with connect(root/(identifier+'.duckdb'),False) as db:
            db.execute('CREATE TABLE records ('+','.join(quote(c)+' VARCHAR' for c in header)+')')
            db.executemany('INSERT INTO records VALUES (?,?,?)',rows)
        item=Dataset(id=identifier,name='PHASE4-legacy-snapshot-fixture.csv',rows=2,bytes=len(raw),created_at=datetime.now(timezone.utc).isoformat(),schema_json=json.dumps([dict(name=c,type='VARCHAR',null_count=0) for c in header]))
        with Session(app.state.editor.engine) as session:
            session.add(item);session.commit();session.refresh(item);result=info(item)
        app.state.editor.initialize(identifier,raw)
        app.state.knowledge.sync(identifier)
        return result


@app.post('/api/test/phase5/{identifier}/legacy-example')
def legacy_knowledge_fixture(identifier: str):
    from sqlalchemy.orm import Session
    from uuid import UUID, uuid4
    identifier = str(UUID(identifier))
    k = app.state.knowledge
    assert k.root.name.startswith('insightiq-e2e-')
    k.get_item(identifier)
    key = str(uuid4())
    with Session(k.engine) as session:
        session.add(k.Example(id=key, workspace_id=k.workspace_id, dataset_id=identifier,
            payload=json.dumps({'question':'Legacy throwaway count', 'sql':'SELECT COUNT(*) AS total FROM data'})))
        session.commit()
    return {'id':key}

@app.post('/api/test/phase6/{dashboard_id}/{widget_id}/legacy')
def phase6_legacy_snapshot(dashboard_id: str, widget_id: str):
    from uuid import UUID
    d=app.state.dashboards
    assert d.analyst.root.name.startswith('insightiq-e2e-')
    doc,widget=d.workspace.widget(UUID(dashboard_id),UUID(widget_id))
    chart=d.store.get('SavedChart',widget['chart_id']);chart.pop('source_revision',None)
    d.store.save('SavedChart',chart)
    return {'legacy':True}

@app.post('/api/test/phase6/{identifier}/schema-mismatch')
def phase6_schema_mismatch(identifier: str):
    from uuid import UUID
    from app.main import connect
    root=app.state.editor.root;identifier=str(UUID(identifier))
    assert root.name.startswith('insightiq-e2e-')
    app.state.knowledge.get_item(identifier)
    with app.state.lifecycle.admission_lock,app.state.knowledge.lock,connect(root/(identifier+'.duckdb'),False) as db:
        db.execute('ALTER TABLE records ADD COLUMN phase6_schema_change VARCHAR')
    return {'changed':True}

@app.post('/api/test/phase9/{dataset_id}/comparison-fixtures')
def phase9_comparison_fixtures(dataset_id:str):
    """Controlled stored verdicts only; not a measurement of model accuracy."""
    from uuid import UUID,uuid4
    from app.benchmark import VERSION
    from app.persistence import utcnow
    from app.evaluation_reporting import COMPARISON_POLICY
    service=app.state.evaluations;identifier=UUID(dataset_id)
    assert service.analyst.root.name.startswith('insightiq-e2e-')
    service.authorize_dataset(identifier,check_knowledge=False)
    cases={c['id']:c for c in authored_cases()};ids=['q05','q06','q07','q08'];jobs=[]
    for verdicts in [[False,True,True,None],[True,False,True,True]]:
        rows=[]
        for case_id,correct in zip(ids,verdicts):
            case=cases[case_id]
            rows.append(dict(case_id=case_id,question=case['question'],category=case['category'],difficulty=case['difficulty'],correct=correct,
                comparison='Controlled stored-verdict fixture, not a measured model result.',status='missing_prediction' if correct is None else 'correct' if correct else 'incorrect',expected=case['expected'],actual=None,run=None,reference_sql=case['reference_sql'],ordered=case['ordered'],failure_labels=[],replay_diagnostics={}))
        now=utcnow();job=dict(id=str(uuid4()),dataset_id=dataset_id,dataset_fingerprint=service.fingerprint(identifier),version=VERSION,case_ids=ids,mode='offline',pipeline='offline',model='CONTROLLED STORED-VERDICT FIXTURE',status='completed',created_at=now,updated_at=now,completed_at=now,active_run_id=None,provider_calls=0,reserved_tokens=0,reserved_cost_usd=0,max_total_tokens=0,max_spend_usd=0,confirm_paid_calls=False,error=None,pricing={'input':'0','output':'0','source':'Test fixture only'},provider_endpoint='offline://controlled-fixture',comparison_policy=COMPARISON_POLICY,results=rows,metrics=service.offline_metrics(rows))
        app.state.store.save('Evaluation',job);jobs.append(job['id'])
    return {'ids':jobs,'controlled_fixture':True}
