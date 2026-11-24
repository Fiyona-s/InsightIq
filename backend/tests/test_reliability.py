"""Phase 5 local regressions. Controlled model boundaries; actual guard/SQL worker."""
import copy,json
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.benchmark import equivalent
from app.evaluation import EvaluationService
from app.evaluation_reporting import comparison_details,present_job
from app.prompts import SYSTEM,PROMPT_VERSION,PROMPT_HASH,WORKFLOW_VERSION
from app.provider import Generation,ModelError
from app.sql_guard import validate_sql,GuardError
from tests.test_analyst import dataset,submit,finish,ControlledProvider
from tests.test_phase3 import SequenceProvider,ControlledEmbedding


RAW=b'id,amount,at,region\n1,2.5,2026-01-01,North\n1,2.5,2026-01-01,North\n2,,bad,South\n3,bad,,South\n4,0,2026-02-01,North\n'
MAPPING={'id':'BIGINT','amount':'DOUBLE','at':'DATE'}


@pytest.mark.parametrize('sql,mapping,rows',[
 ('SELECT COUNT(*) AS n,SUM(amount) AS total,COUNT(amount) AS present,COUNT(DISTINCT id) AS unique_ids FROM data',MAPPING,[[5,5.0,3,4]]),
 ('SELECT SUM(TRY_CAST(amount AS DOUBLE)) AS total FROM data',{},[[5.0]]),
 ('SELECT region,SUM(amount) AS total,COUNT(*) AS n FROM data GROUP BY region ORDER BY region',MAPPING,[['North',5.0,3],['South',None,2]]),
 ('SELECT id FROM data WHERE amount>999',MAPPING,[]),
 ('SELECT SUM(amount) AS total,COUNT(*) AS n FROM data WHERE amount>999',MAPPING,[[None,0]]),
 ('SELECT id FROM data ORDER BY id DESC',MAPPING,[[4],[3],[2],[1],[1]]),
 ('SELECT MIN(at) AS first_day,MAX(at) AS last_day FROM data',MAPPING,[['2026-01-01','2026-02-01']]),
])
def test_real_count_sum_strings_nulls_duplicates_dates_empty_and_order(tmp_path,sql,mapping,rows):
    provider=SequenceProvider([sql]);app=create_app(tmp_path,provider=provider,embedder=ControlledEmbedding())
    with TestClient(app) as c:
        identifier=dataset(c,RAW)
        run=finish(c,submit(c,identifier,mapping=mapping,question='Count and total explicitly requested amount, preserving duplicate records.'))
        assert run['status']=='succeeded',run
        assert c.get('/api/analyst/runs/'+run['id']+'/results').json()['rows']==rows
        assert len(provider.calls)==run['attempts']==1
        assert not any(e['step']=='repair' for e in run['events'])
        assert run['prompt_version']==PROMPT_VERSION and run['prompt_hash']==PROMPT_HASH
        assert run['workflow_version']==WORKFLOW_VERSION
        attempt=run['attempt_history'][0]
        assert attempt['validation']=='passed' and attempt['execution']=='succeeded' and len(attempt['context_fingerprint'])==64
        context=provider.calls[0]
        assert context['dataset_id']==identifier and context['schema_signature']==run['schema_signature']
        assert 'reference_sql' not in json.dumps(context) and 'expected' not in context
        assert {col['name']:col['type'] for col in context['columns']}=={n:mapping.get(n,'VARCHAR') for n in ['id','amount','at','region']}
        if mapping:
            assert next(v for v in run['conversions'] if v['column']=='amount')['failed']==1


@pytest.mark.parametrize('sqls,attempts,code',[
 (['SELECT ghost FROM data',' select GHOST from DATA -- same failure'],2,'repeated_sql'),
 (["SELECT CAST('invalid' AS DOUBLE) FROM data","SELECT CAST('invalid' AS DOUBLE) FROM data"],2,'repeated_sql'),
 (['SELECT ghost_one FROM data','SELECT ghost_two FROM data','SELECT ghost_three FROM data','SELECT COUNT(*) FROM data'],3,'validation_error'),
])
def test_retry_stop_on_repeated_sql_and_enforce_distinct_attempt_limit(tmp_path,sqls,attempts,code):
    provider=SequenceProvider(sqls)
    with TestClient(create_app(tmp_path,provider=provider,embedder=ControlledEmbedding())) as c:
        run=finish(c,submit(c,dataset(c)))
        assert run['status']=='failed' and run['error_code']==code,run
        assert run['attempts']==len(provider.calls)==attempts
        assert len(run['attempt_history'])==attempts
        if code=='repeated_sql':
            assert run['attempt_history'][-1]['validation']=='stopped'
            assert run['attempt_history'][-1]['execution']=='not_started'
        assert 'repair_untrusted' not in provider.calls[0]
        for context in provider.calls[1:]:
            repair=context['repair_untrusted']
            assert repair['remaining_attempts']>0 and repair['error_code'] in {'validation_error','execution_error'}
            assert len(repair['validation_or_execution_error'])<=500
            assert '/Users/' not in repair['validation_or_execution_error'] and 'invalid' not in repair['validation_or_execution_error']


def test_unanswerable_and_provider_errors_do_not_start_sql_repair(tmp_path):
    for provider in [ControlledProvider(clarification='Please define profit and provide authorized costs.'),ControlledProvider(error=ModelError('Controlled rate limit.','provider_rate_limit'))]:
        with TestClient(create_app(tmp_path,provider=provider,embedder=ControlledEmbedding())) as c:
            run=finish(c,submit(c,dataset(c),question='What is profit without a cost field?'))
            assert run['status'] in {'clarification','failed'} and run['attempts']==1
            assert not any(e['step'] in {'repair','execute'} for e in run['events'])
            assert run['attempt_history'][0]['validation']=='not_started'


@pytest.mark.parametrize('sql',[
 'SELECT SUM(amount) FROM other_dataset', 'SELECT hallucinated FROM data',
 'SELECT a.id FROM data a JOIN private.customers b ON a.id=b.id',
 "SELECT id FROM data; DROP TABLE data", "SELECT * FROM read_csv('/etc/passwd')",
 'SELECT SUM(amount) FROM data',  # raw numeric strings require mapping/conversion
])
def test_regression_unauthorized_sql_and_implicit_text_numeric(sql):
    with pytest.raises(GuardError):validate_sql(sql,{'id':'VARCHAR','amount':'VARCHAR'})


def result(rows,name='orders',typ='BIGINT'):
    return {'columns':[{'name':name,'type':typ}],'rows':rows,'row_count':len(rows)}


def test_alias_only_mismatch_is_diagnostic_and_does_not_change_strict_score():
    actual=result([[8]],'order_record_count');expected=result([[8]])
    assert not equivalent(actual,expected)[0]
    info=comparison_details(actual,expected)
    assert info['alias_only_mismatch'] and info['positional_values_match'] and not info['strict_match']
    job={'version':'retail-v1','results':[{'case_id':'q05','correct':False,'actual':actual,'expected':expected}],'metrics':None}
    original=copy.deepcopy(job);shown=present_job(job)
    assert shown['results'][0]['correct'] is False and shown['results'][0]['comparison_details']==info
    assert job==original and actual['columns'][0]['name']=='order_record_count'


@pytest.mark.parametrize('actual,expected,ordered,match',[
 (result([[8]],'renamed'),result([[9]]),False,False),
 (result([[None]],'renamed'),result([[0]]),False,False),
 (result([[None]],'renamed'),result([[None]]),False,True),
 (result([[1],[1]],'renamed'),result([[1],[2]]),False,False),
 (result([[2],[1]],'renamed'),result([[1],[2]]),True,False),
 (result([[2],[1]],'renamed'),result([[1],[2]]),False,True),
 (result([['8']],'renamed','VARCHAR'),result([[8]]),False,False),
 (result([[1.00000001]],'renamed','DOUBLE'),result([[1.0]],typ='DOUBLE'),False,True),
 (result([[1.01]],'renamed','DOUBLE'),result([[1.0]],typ='DOUBLE'),False,False),
 (result([], 'renamed'),result([]),False,True),
])
def test_positional_diagnostic_preserves_types_nulls_order_duplicates_tolerance(actual,expected,ordered,match):
    assert comparison_details(actual,expected,ordered)['positional_values_match'] is match
    assert not equivalent(actual,expected,ordered)[0]  # alias mismatch remains a strict failure


def test_research_denominators_clarifications_failures_unknown_usage_and_reviews():
    def row(expected,correct,actual=None,events=(),review=None):
        return {'category':'test','difficulty':'easy','expected':expected,'correct':correct,'actual':actual,'failure_labels':[],
                'run':{'attempts':1,'status':'succeeded' if actual else 'clarification','metrics':{},'events':[{'step':'validate','status':e} for e in events]},'review':review}
    rows=[row(result([[8]]),False,result([[8]],'renamed'),['passed']),
          row(result([[5]]),True,result([[5]]),['passed']),
          row(None,True),row(None,False,result([[1]]),['passed']),
          row(result([[1]]),False,None,['rejected'])]
    m=EvaluationService.metrics(rows)
    assert m['accuracy']==2/5 and m['rates']['result_correctness']['denominator']==5
    assert m['rates']['answerable_accuracy']['value']==1/3
    assert m['rates']['correct_abstention']['value']==1/2
    assert m['rates']['sql_validity']['numerator']==3 and m['rates']['sql_validity']['denominator']==4
    assert m['rates']['execution_success']['value']==2/3
    assert m['total_tokens'] is None and m['estimated_cost_usd'] is None
    assert m['usage_sample_size']==m['cost_sample_size']==m['latency_sample_size']==0
    assert m['rates']['wrong_aggregation']['value'] is None and m['rates']['wrong_aggregation']['denominator']==0
    rows[0]['review']={'reviewed':True,'labels':['other']}
    m=EvaluationService.metrics(rows)
    assert m['rates']['wrong_aggregation']['value']==0 and m['rates']['wrong_aggregation']['denominator']==1


def test_prompt_is_generic_versioned_and_free_of_benchmark_answer_contracts():
    import hashlib
    assert PROMPT_HASH==hashlib.sha256(SYSTEM.encode()).hexdigest()
    for rule in ['COUNT(*)','COUNT(DISTINCT','SUM(x)/SUM(y)','NULL','duplicate','TRY_CAST','ORDER BY','DuckDB','clarification']:
        assert rule in SYSTEM
    assert all(forbidden not in SYSTEM for forbidden in ['retail-v1','q05','order_record_count','AS orders','total_revenue'])
