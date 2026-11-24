"""Evaluation-only diagnostics and explicit metric denominators; never generation context."""
from copy import deepcopy
from .benchmark import equivalent,authored_cases,VERSION

COMPARISON_POLICY = 'retail-typed-v1-strict-aliases'
METRICS_VERSION = 'evaluation-metrics-v2'


def comparison_details(actual,expected,ordered=False):
    if actual is None or expected is None:return None
    strict,reason=equivalent(actual,expected,ordered)
    names=[c['name'] for c in actual['columns']]==[c['name'] for c in expected['columns']]
    # Diagnostic only: positional columns, with the same types, NULLs, order and
    # tolerances. Never reorder columns, change SQL or alter the strict score.
    positional=deepcopy(actual)
    if len(positional['columns'])!=len(expected['columns']):
        values,value_reason=False,'Different column counts; positional comparison unavailable.'
    else:
        for column,reference in zip(positional['columns'],expected['columns']):column['name']=reference['name']
        values,value_reason=equivalent(positional,expected,ordered)
    return {'policy':COMPARISON_POLICY,'strict_match':strict,'strict_reason':reason,'column_names_match':names,
            'positional_values_match':values,'positional_reason':value_reason,'alias_only_mismatch':not names and values,
            'notice':'Positional value agreement is a diagnostic, not semantic certification or a replacement accuracy score.'}


def rate(numerator,denominator,unit,description):
    return {'numerator':numerator,'denominator':denominator,'value':numerator/denominator if denominator else None,'unit':unit,'description':description}


def enrich_metrics(results,metrics,mode='paid'):
    scored=[r for r in results if r.get('correct') is not None]
    sql=[r for r in scored if r.get('expected') is not None]
    abstain=[r for r in scored if r.get('expected') is None]
    if mode=='offline':
        validations=[r['replay_diagnostics']['validation'] for r in sql if r.get('replay_diagnostics',{}).get('validation') in {'passed','rejected'}]
        latency_key='offline_latency_ms'
        times=[r[latency_key] for r in scored if r.get(latency_key) is not None]
    else:
        validations=[e['status'] for r in scored for e in (r.get('run') or {}).get('events',[]) if e['step']=='validate' and e['status'] in {'passed','rejected'}]
        times=[r['run']['metrics']['total_latency_ms'] for r in scored if (r.get('run') or {}).get('metrics',{}).get('total_latency_ms') is not None]
    reviewed=[r for r in scored if (r.get('review') or {}).get('reviewed')]
    rates={
        'sql_validity':rate(validations.count('passed'),len(validations),'validated SQL candidates','Validation outcomes only; provider errors, clarifications and stopped repeats are excluded.'),
        'execution_success':rate(sum(r.get('actual') is not None for r in sql),len(sql),'answerable evaluated cases','Successful SQL result, including empty outputs; separate from correctness.'),
        'result_correctness':rate(sum(r['correct'] is True for r in scored),len(scored),'evaluated predictions','Strict benchmark contract; missing predictions and reference failures excluded.'),
        'answerable_accuracy':rate(sum(r['correct'] is True for r in sql),len(sql),'answerable evaluated cases','SQL-required questions, including incorrect abstentions and execution failures.'),
        'correct_abstention':rate(sum(r['correct'] is True for r in abstain),len(abstain),'abstention evaluated cases','Authored ambiguous/unsupported questions only.'),
    }
    for cause in ('wrong_join','wrong_filter','wrong_aggregation','hallucinated_column','hallucinated_table'):
        rates[cause]=rate(sum(cause in r['review']['labels'] for r in reviewed),len(reviewed),'independently reviewed cases','Reviewer annotation only; unreviewed causes remain unknown.')
        metrics[cause+'_rate']=rates[cause]['value']
    metrics.update(metrics_version=METRICS_VERSION,rates=rates,reviewed_cases=len(reviewed),
                   latency_sample_size=len(times),usage_sample_size=0 if mode=='offline' else sum((r.get('run') or {}).get('metrics',{}).get('total_tokens') is not None for r in scored),
                   cost_sample_size=0 if mode=='offline' else sum((r.get('run') or {}).get('metrics',{}).get('estimated_cost_usd') is not None for r in scored))
    # Keep established top-level contracts while correcting their denominator
    # from generation count (which includes clarifications) to validation count.
    metrics['valid_sql_rate']=rates['sql_validity']['value']
    metrics['result_accuracy']=rates['answerable_accuracy']['value']
    if mode!='offline':
        metrics.update(evaluated_count=len(scored),correct_count=sum(r['correct'] is True for r in scored),
                       incorrect_count=sum(r['correct'] is False for r in scored),missing_predictions=0,reference_failures=0,
                       execution_failures=sum((r.get('run') or {}).get('status')=='failed' and any(e['step']=='execute' and e['status']=='rejected' for e in (r.get('run') or {}).get('events',[])) for r in scored))
    return metrics


def present_job(job):
    """Additive read projection for legacy records; original outcomes stay intact."""
    job=deepcopy(job)
    results=job.get('results',[])
    contracts={c['id']:c for c in authored_cases()} if job.get('version')==VERSION else {}
    for row in results:
        row.setdefault('ordered',contracts.get(row['case_id'],{}).get('ordered',False))
        row['comparison_details']=comparison_details(row.get('actual'),row.get('expected'),row.get('ordered',False))
    if job.get('metrics') is not None:job['metrics']=enrich_metrics(results,job['metrics'],job.get('mode','paid'))
    job.setdefault('comparison_policy',COMPARISON_POLICY)
    return job
