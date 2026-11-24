"""Presentation projections preserve fixed stored scores and never invoke scoring or models."""
import copy,json,sqlite3,hashlib
from tests.test_offline_evaluation import saved_predictions,offline,run_offline
from app.evaluation_presentation import presentation,row_diff
from app.evaluation import EvaluationService

def test_fixed_stored_run_scores_identical_and_reads_never_score_or_call_models(offline,monkeypatch):
    app,c,identifier,source_id,root=offline
    job=run_offline(c,identifier,source_evaluation_id=source_id)
    raw=copy.deepcopy(app.state.store.get('Evaluation',job['id']))
    before=c.get('/api/evaluations/'+job['id']).json()
    assert before['metrics']['correct_count']==3 and before['metrics']['incorrect_count']==0 and before['metrics']['missing_predictions']==42
    def forbidden(*args,**kwargs):raise AssertionError('Read invoked scoring/model execution')
    for name in ['compare_prediction','offline_metrics','metrics','work','work_offline','submit','submit_offline']:
        monkeypatch.setattr(EvaluationService,name,forbidden)
    def snapshot():
        with sqlite3.connect(root/'catalog.sqlite') as db:catalog=list(db.iterdump())
        files={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file() and not p.name.startswith('catalog.sqlite')}
        return catalog,files
    catalog=snapshot()
    response=c.get('/api/evaluations/'+job['id']+'/presentation');assert response.status_code==200,response.text
    view=response.json();assert view['scoring_version']==raw['metrics']['metrics_version']
    assert len(view['results'])==45
    after=c.get('/api/evaluations/'+job['id']).json()
    assert after==before
    assert app.state.store.get('Evaluation',job['id'])==raw
    assert snapshot()==catalog
    assert presentation(raw)==view and raw==app.state.store.get('Evaluation',job['id'])

def test_row_diff_uses_original_typed_multiset_tolerance_order_and_duplicates():
    def output(rows,typ='DOUBLE',name='amount'):return {'columns':[{'name':name,'type':typ}],'rows':[[r] for r in rows]}
    actual,expected=output([2,None,1.0000001,1]),output([1,2,None,1])
    row={'actual':actual,'expected':expected,'correct':False,'ordered':False}
    original=copy.deepcopy(row);diff=row_diff(row)
    assert all(r['match']=='Matched' for r in diff['rows']) and row==original
    row['ordered']=True;assert any(r['match']=='Unmatched' for r in row_diff(row)['rows'])
    row.update(actual=output([1,1]),expected=output([1,2]),ordered=False)
    assert [r['match'] for r in row_diff(row)['rows']].count('Unmatched')==2
    row.update(actual=output([1.0000001],'BIGINT'),expected=output([1],'BIGINT'))
    assert all(r['match']=='Unmatched' for r in row_diff(row)['rows'])
    row.update(actual=output([1],name='wrong_alias'),expected=output([1]))
    assert all(r['match']=='Unmatched' for r in row_diff(row)['rows'])

def test_diff_truncation_and_missing_versions_are_explicit_and_do_not_infer_current_scorer():
    result={'columns':[{'name':'x','type':'INTEGER'}],'rows':[[i] for i in range(30)]}
    row={'case_id':'q','actual':result,'expected':copy.deepcopy(result),'ordered':False}
    diff=row_diff(row);assert diff['shown_rows']==20 and diff['total_rows']==60 and len(diff['rows'])==20
    result['rows']*=4;assert row_diff(row)['available'] is False and '100 rows' in row_diff(row)['notice']
    legacy={'id':'legacy','results':[row]};assert presentation(legacy)['scoring_version'] is None
    row.pop('ordered');assert not row_diff(row)['available'] and 'not recorded' in row_diff(row)['notice']
