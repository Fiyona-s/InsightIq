"""Deterministic FX tests: all rates are synthetic, never market claims."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from datetime import date, timedelta
from decimal import Decimal
import copy
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.currency import Rates, annotate, convert, format_money, mixed_aggregate
from app.knowledge import KnowledgeSettings
from app.main import create_app


def settings(**columns):
    return KnowledgeSettings(monetary_columns=columns)

@pytest.mark.parametrize('sql,expected', [
    ('SELECT SUM(revenue) AS total_revenue FROM data', True),
    ('SELECT AVG(TRY_CAST(revenue AS DOUBLE)) AS mean FROM data', True),
    ('SELECT revenue FROM data', True),
    ('SELECT COUNT(revenue) AS revenue FROM data', False),
    ('SELECT SUM(revenue)/COUNT(*) AS revenue FROM data', False),
    ('SELECT SUM(quantity) AS total_revenue FROM data', False),
    ('WITH x AS (SELECT revenue FROM data) SELECT SUM(revenue) FROM x', False),
    ('SELECT a.revenue FROM data a JOIN data b ON a.id=b.id', False),
])
def test_conservative_lineage(sql, expected):
    result=annotate(sql,[{'name':'revenue','type':'DOUBLE'}],settings(revenue={'currency':'INR'}))
    assert ('money' in result[0]) is expected


def test_unknown_multiple_and_mixed():
    cols=[{'name':'a','type':'DOUBLE'},{'name':'b','type':'DOUBLE'},{'name':'orders','type':'BIGINT'}]
    result=annotate('SELECT SUM(revenue), SUM(cost), COUNT(*) FROM data',cols,settings(revenue={'currency':'INR'},cost={'currency':'USD'}))
    assert [c.get('money',{}).get('currency') for c in result]==['INR','USD',None]
    assert cols[0].get('money') is None
    assert annotate('SELECT SUM(revenue) FROM data',cols[:1],settings(revenue={}))[0]['money']['currency'] is None
    assert mixed_aggregate('SELECT SUM(revenue) FROM data',settings(revenue={'mixed':True}))
    assert not mixed_aggregate('SELECT revenue FROM data',settings(revenue={'mixed':True}))

@pytest.mark.parametrize('raw', [0,-1,None,'bad','NaN','Infinity'])
def test_reject_invalid_rates(raw):
    with pytest.raises(HTTPException):
        Rates(lambda *args:{'rate':raw,'date':date.today().isoformat()}).get('INR','USD')


def test_rates_direction_cache_historical_and_expiry():
    calls=[]
    def fetch(source,target,day):
        calls.append((source,target,day))
        return {'base':source,'quote':target,'rate':'0.0125','date':day or date.today().isoformat()}
    rates=Rates(fetch)
    q=rates.get('INR','USD');assert q['rate']=='0.0125'
    assert rates.get('INR','USD')==q and len(calls)==1
    assert q['effective_date']==date.today().isoformat() and q['fetched_at']
    rates.cache[('INR','USD',None)]=(0,q)
    rates.get('INR','USD');assert len(calls)==2
    assert rates.get('INR','USD',date(2020,1,2))['historical']
    assert calls[-1]==('INR','USD','2020-01-02')
    assert convert(['0.1','-25','0',None],'0.0125')==['0.00125','-0.3125','0.0000',None]
    assert convert(['1250000'],'0.0125')==['15625.0000']
    assert Decimal(convert(['1250000'],'0.0101')[0])==Decimal('12625')


def test_unavailable_unsupported_wrong_direction_and_stale():
    for fetch in [lambda *a:1/0,lambda *a:{'rate':1,'date':(date.today()-timedelta(days=8)).isoformat()},lambda *a:{'rate':1,'date':date.today().isoformat(),'base':'USD','quote':'INR'}]:
        with pytest.raises(HTTPException): Rates(fetch).get('INR','USD')
    with pytest.raises(HTTPException): Rates().get('ZZZ','USD')
    with pytest.raises(HTTPException): Rates().get('USD','USD')
    with pytest.raises(HTTPException): convert(['NaN'],'1')


def test_original_formatting_and_api_disabled(tmp_path,monkeypatch):
    monkeypatch.delenv('FX_PROVIDER',raising=False)
    assert format_money(1250000,{'currency':'INR'})=='INR 12,50,000.00'
    assert format_money(-1.25,{'currency':'USD'})=='USD -1.25'
    assert format_money(0,{'currency':'JPY'})=='JPY 0'
    with TestClient(create_app(tmp_path)) as c:
        assert not c.get('/api/currency/status').json()['enabled']
        assert c.post('/api/currency/convert',json={'source_currency':'INR','target_currency':'USD','amounts':['1']}).status_code==503


def test_converted_export_retains_originals_and_provenance(monkeypatch):
    from app.currency import export_result
    monkeypatch.setenv('FX_PROVIDER','frankfurter')
    result={'columns':[{'name':'revenue','type':'DOUBLE','money':{'currency':'INR'}},{'name':'orders','type':'BIGINT'}], 'rows':[['1250000',3],[None,0]], 'row_count':2}
    original=copy.deepcopy(result)
    rates=Rates(lambda source,target,day:{'rate':'0.0125','date':date.today().isoformat()})
    exported=export_result(result,'USD',rates)
    assert result==original
    assert exported['rows'][0][:2]==['1250000',3]
    assert exported['rows'][0][2:]==['15625.0000','INR','0.0125',date.today().isoformat(),'Frankfurter daily reference']
    assert exported['rows'][1][2] is None


def test_explicit_metric_metadata_requires_exact_query_semantics():
    s=KnowledgeSettings(metrics=[{'name':'margin','description':'Confirmed currency-valued metric','sql':'SELECT SUM(revenue-cost) AS margin FROM data','money':{'currency':'USD'}}])
    assert annotate('SELECT SUM(revenue-cost) AS value FROM data',[{'name':'value','type':'DOUBLE'}],s)[0]['money']['currency']=='USD'
    assert 'money' not in annotate('SELECT SUM(revenue-cost) AS value FROM data WHERE quantity>1',[{'name':'value','type':'DOUBLE'}],s)[0]


def test_mixed_units_cannot_be_added_but_separate_measures_are_allowed():
    s=settings(revenue={'currency':'USD'},cost={'currency':'INR'})
    assert mixed_aggregate('SELECT SUM(revenue-cost) FROM data',s)
    assert mixed_aggregate('SELECT SUM(revenue)-SUM(cost) FROM data',s)
    assert not mixed_aggregate('SELECT SUM(revenue),SUM(cost) FROM data',s)


def test_converted_reports_label_rates_and_preserve_source(monkeypatch):
    from app.currency import converted_view
    from app.charts import validate_chart
    from app.evidence import compute_evidence
    from app.reports import dashboard_pdf
    monkeypatch.setenv('FX_PROVIDER','frankfurter')
    result={'columns':[{'name':'revenue','type':'DOUBLE','money':{'currency':'INR'}}], 'rows':[['1250000']], 'row_count':1}
    widget={'id':'w','kind':'chart','title':'Revenue','source':{'dataset_name':'Retail','dataset_id':'d','question':'Total revenue','refresh_policy':'snapshot','last_successful_refresh':'2026-01-01','status':'snapshot','error':None,'narrative_source':'computed','sql':'SELECT SUM(revenue) FROM data'},'result':result,'chart':validate_chart({'kind':'kpi','y':0},result),'evidence':compute_evidence(result),'summary':[],'filters_applied':{'scope':'query output','unavailable':[]}}
    view={'title':'Retail','description':'','snapshot_notice':'Saved snapshot','filters':[],'widgets':[widget]}
    original=copy.deepcopy(view)
    rates=Rates(lambda *args:{'rate':'0.0125','date':date.today().isoformat()})
    converted=converted_view(view,'USD',rates)
    assert view==original
    w=converted['widgets'][0]
    assert w['original_result']==result
    assert w['result']['rows']==[['15625.0000']]
    assert w['currency_conversion'][0]['source_currency']=='INR'
    assert w['currency_conversion'][0]['target_currency']=='USD'
    assert w['chart']['money']['currency']=='USD'
    assert 'USD 15,625.00' in w['evidence']['facts'][1]['statement']
    assert dashboard_pdf(converted).startswith(b'%PDF-')


def test_legacy_snapshot_currency_repair_preserves_raw_data_and_history(tmp_path,monkeypatch):
    import hashlib
    from tests.test_analyst import ControlledProvider,dataset,submit,finish
    from tests.test_phase3 import ControlledEmbedding
    from tests.test_phase4 import layout
    sql='SELECT SUM(TRY_CAST(net_revenue_inr AS DOUBLE)) AS total_recognized_revenue_inr FROM data'
    provider=ControlledProvider(sql)
    app=create_app(tmp_path,provider=provider,embedder=ControlledEmbedding())
    with TestClient(app) as c:
        identifier=dataset(c,b'order_id,net_revenue_inr,category\n001,8379680.76,Retail\n')
        run=finish(c,submit(c,identifier,{'net_revenue_inr':'DOUBLE'}))
        assert run['status']=='succeeded'
        chart=c.post('/api/saved-charts',json={'run_id':run['id'],'title':'Recognized Revenue','spec':{'kind':'kpi','y':0},'refresh_policy':'snapshot','persist_snapshot_confirmed':True}).json()
        view=layout(c,chart);dash_id=view['id']
        record=c.get('/api/saved-charts/'+chart['id']).json()
        original=copy.deepcopy(record['snapshot'])
        assert not original['columns'][0].get('money')
        raw_csv=c.get(f'/api/dashboards/{dash_id}/widgets/{view["widgets"][0]["id"]}/results.csv').text
        db_hash=hashlib.sha256((tmp_path/(identifier+'.duckdb')).read_bytes()).hexdigest()
        raw_run=copy.deepcopy(app.state.analyst.load(run['id']))
        assert not view['widgets'][0]['currency_metadata_available']
        body={'expected_snapshot_digest':record['snapshot_digest']}
        assert c.post('/api/saved-charts/'+chart['id']+'/currency-metadata',json=body).status_code==422
        # Authored metric confirmation, not an alias/name guess.
        settings=c.get('/api/datasets/'+identifier+'/knowledge').json()['settings']
        settings['metrics']=[{'name':'Recognized revenue','description':'Confirmed INR recognized revenue','sql':sql,'money':{'currency':'INR'}}]
        assert c.put('/api/datasets/'+identifier+'/knowledge',json=settings).status_code==200
        candidate=c.get('/api/dashboards/'+dash_id).json()['widgets'][0]
        assert candidate['currency_metadata_available']
        assert not candidate['result']['columns'][0].get('money') # GET never backfills history.
        assert c.post('/api/saved-charts/'+chart['id']+'/currency-metadata',json={'expected_snapshot_digest':'0'*64}).status_code==409
        def forbidden(*args,**kwargs):raise AssertionError('Metadata repair must never execute SQL')
        monkeypatch.setattr('app.dashboards.execute_isolated',forbidden)
        applied=c.post('/api/saved-charts/'+chart['id']+'/currency-metadata',json=body)
        assert applied.status_code==200,applied.text
        assert applied.json()['currency_metadata']['0']['currency']=='INR'
        assert applied.json()['currency_metadata_provenance']['snapshot_digest']==body['expected_snapshot_digest']
        repaired=c.get('/api/saved-charts/'+chart['id']).json()
        assert repaired['snapshot']==original and repaired['sql']==sql
        widget=c.get('/api/dashboards/'+dash_id).json()['widgets'][0]
        assert widget['chart']['money']['currency']=='INR'
        assert widget['result']['rows']==original['rows']
        assert widget['result']['columns'][0]['money']['currency']=='INR'
        assert not widget['currency_metadata_available']
        assert c.get(f'/api/dashboards/{dash_id}/widgets/{widget["id"]}/results.csv').text==raw_csv
        assert c.get('/api/dashboards/'+dash_id+'/report.pdf').content.startswith(b'%PDF-')
        assert hashlib.sha256((tmp_path/(identifier+'.duckdb')).read_bytes()).hexdigest()==db_hash
        assert app.state.analyst.load(run['id'])==raw_run
        # A later dataset preference must never silently relabel a saved INR snapshot.
        settings['metrics'][0]['money']['currency']='USD'
        c.put('/api/datasets/'+identifier+'/knowledge',json=settings)
        assert c.get('/api/dashboards/'+dash_id).json()['widgets'][0]['chart']['money']['currency']=='INR'
        assert c.post('/api/saved-charts/'+chart['id']+'/currency-metadata',json=body).status_code==422
    # Currency survives process restart independently of ephemeral Analyst row caches.
    with TestClient(create_app(tmp_path,provider=provider,embedder=ControlledEmbedding())) as c:
        widget=c.get('/api/dashboards/'+dash_id).json()['widgets'][0]
        assert widget['chart']['money']['currency']=='INR'
        assert c.get('/api/saved-charts/'+chart['id']).json()['snapshot']==original


def test_rate_outage_disables_conversion_until_safe_retry(tmp_path,monkeypatch):
    import httpx
    monkeypatch.setenv('FX_PROVIDER','frankfurter')
    calls=[]
    def fail(*args):
        calls.append(args)
        raise httpx.ConnectError('Synthetic outage')
    app=create_app(tmp_path,fx_fetch=fail)
    with TestClient(app) as c:
        assert c.get('/api/currency/status').json()['enabled']
        body={'source_currency':'INR','target_currency':'USD','amounts':['1']}
        assert c.post('/api/currency/convert',json=body).status_code==503
        assert not c.get('/api/currency/status').json()['enabled']
        assert c.post('/api/currency/convert',json=body).status_code==503
        assert len(calls)==1
        app.state.analyst.currency_rates.unavailable_until=0
        assert c.get('/api/currency/status').json()['enabled']


def test_confirmed_metric_does_not_mark_dimensions_or_counts_as_currency():
    s=KnowledgeSettings(metrics=[{'name':'Sales','description':'Confirmed USD revenue','sql':'SELECT region,SUM(revenue),COUNT(*) FROM data GROUP BY region','money':{'currency':'USD'}}])
    cols=[{'name':'region','type':'VARCHAR'},{'name':'total','type':'DOUBLE'},{'name':'orders','type':'BIGINT'}]
    result=annotate(s.metrics[0].sql,cols,s)
    assert [bool(c.get('money')) for c in result]==[False,True,False]
