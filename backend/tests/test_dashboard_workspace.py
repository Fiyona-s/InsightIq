"""Phase 6 uses throwaway datasets/dashboards and controlled model boundaries."""
import copy
import json
import sqlite3
from unittest.mock import Mock
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app.main import create_app,connect
from app.dashboard_workspace import sql_hash,readable,HISTORY_LIMIT
from app.execution import ExecutionError
from tests.test_phase3 import ControlledEmbedding,SequenceProvider
from tests.test_analyst import dataset,submit,finish


def fixture(tmp_path,monkeypatch=None,fx=None):
    provider=SequenceProvider(['SELECT SUM(revenue) AS total_revenue FROM data'])
    return TestClient(create_app(tmp_path,provider=provider,embedder=ControlledEmbedding(),fx_fetch=fx)),provider


def saved(c,identifier,kind='kpi'):
    run=finish(c,submit(c,identifier,question='PHASE6 my revenue',mapping={'revenue':'DOUBLE'}));assert run['status']=='succeeded',run
    r=c.post('/api/saved-charts',json={'run_id':run['id'],'title':'total_recognized_revenue_inr','spec':{'kind':kind,'x':None,'y':0},'persist_snapshot_confirmed':True});assert r.status_code==201,r.text
    return r.json()


def prepare(c):
    identifier=dataset(c);chart=saved(c,identifier)
    doc=c.post('/api/dashboards',json={'title':'Throwaway dashboard'}).json()
    attached=c.post('/api/dashboards/'+doc['id']+'/charts',json={'chart_id':chart['id'],'revision':1}).json()
    return identifier,chart,attached['dashboard']


def path(doc,widget=None):return '/api/dashboards/'+doc['id']+('/widgets/'+(widget or doc['widgets'][0]['id']) if widget is not False else '')
def refresh(c,doc,widget=None):return c.post(path(doc,widget)+'/refresh',json={'confirm_refresh':True,'revision':doc['revision']})
def change(c,identifier,value,version=1):
    base='/api/datasets/'+identifier;row=c.get(base+'/rows').json()['rows'][0]
    r=c.post(base+'/edits',json={'expected_version':version,'updates':[{'id':row['id'],'values':{'revenue':str(value)}}]});assert r.status_code==200,r.text


def test_titles_derivation_validation_reset_and_original_untouched(tmp_path):
    client,_=fixture(tmp_path)
    with client as c:
        _,chart,doc=prepare(c);widget=doc['widgets'][0]
        assert widget['display_title']=='Total Recognized Revenue'
        assert readable('ROI_by_SKU')=='ROI By SKU'
        original=copy.deepcopy(c.app.state.store.get('SavedChart',chart['id']))
        assert c.patch(path(doc)+'/title',json={'title':'Revenue reviewed','revision':doc['revision']}).status_code==200
        doc=c.get(path(doc,False)).json();assert doc['widgets'][0]['display_title']=='Revenue reviewed'
        assert doc['widgets'][0]['title']==widget['title']
        body={key:doc[key] for key in ['title','description','revision','filters']}
        keys=['id','chart_id','kind','title','text','spec','filters','width','height']
        body['widgets']=[{key:w[key] for key in keys} for w in doc['widgets']]
        body['widgets'][0]['title']='Attempted original rewrite'
        assert c.put(path(doc,False),json=body).status_code==409
        for bad in ['', ' '*3, 'x'*121,'bad\nname','bad\u0000name']:
            assert c.patch(path(doc)+'/title',json={'title':bad,'revision':doc['revision']}).status_code==422
            assert c.post('/api/dashboards',json={'title':bad}).status_code==422
        reset=c.patch(path(doc)+'/title',json={'title':None,'revision':doc['revision']});assert reset.status_code==200
        assert reset.json()['widgets'][0]['display_title']=='Total Recognized Revenue'
        assert c.app.state.store.get('SavedChart',chart['id'])==original


def test_duplicate_normalization_badge_cancel_add_and_replace_history(tmp_path):
    assert sql_hash('select SUM(revenue) AS total FROM data -- comment')==sql_hash('SELECT SUM(revenue) AS total FROM data')
    assert sql_hash("SELECT 'A' AS x FROM data")!=sql_hash("SELECT 'a' AS x FROM data")
    client,_=fixture(tmp_path)
    with client as c:
        identifier,chart,doc=prepare(c);base=path(doc,False)+'/charts'
        assert c.post(base,json={'chart_id':chart['id'],'revision':doc['revision']}).json()['duplicate']
        assert len(c.get(path(doc,False)).json()['widgets'])==1
        response=c.post(base,json={'chart_id':chart['id'],'revision':doc['revision'],'duplicate_action':'add_anyway'});assert response.status_code==200
        doc=response.json()['dashboard'];assert all(len(w['matching_widget_ids'])==1 for w in doc['widgets'])
        old=copy.deepcopy(doc['widgets'][0]['result']);newchart=saved(c,identifier)
        r=c.post(base,json={'chart_id':newchart['id'],'revision':doc['revision'],'duplicate_action':'replace','replace_widget_id':doc['widgets'][0]['id']});assert r.status_code==200,r.text
        history=c.get(path(doc)+'/history').json();assert history['snapshots'][0]['chart']['snapshot']==old
        from app.dashboard_workspace import duplicate_key
        different={**chart,'dataset_id':str(uuid4())};assert duplicate_key(different)!=duplicate_key(chart)
        assert duplicate_key(chart,{'kind':'table'})!=duplicate_key(chart)
        assert duplicate_key({**chart,'sql':chart['sql']+' WHERE revenue > 0'})!=duplicate_key(chart)


def test_refresh_success_current_changed_history_no_model_calls_and_immutable_library(tmp_path):
    client,provider=fixture(tmp_path)
    with client as c:
        identifier,chart,doc=prepare(c);library=copy.deepcopy(c.app.state.store.get('SavedChart',chart['id']))
        provider.generate=Mock(side_effect=AssertionError('Refresh must not call a model'));provider.narrate=Mock(side_effect=AssertionError('No narrative call'))
        assert doc['widgets'][0]['freshness']['status']=='Current'
        original=copy.deepcopy(doc['widgets'][0]['result']);change(c,identifier,99)
        doc=c.get(path(doc,False)).json();assert doc['widgets'][0]['freshness']['status']=='Source changed'
        response=refresh(c,doc);assert response.status_code==200,response.text
        doc=response.json();widget=doc['widgets'][0]
        assert widget['freshness']['status']=='Current' and widget['source']['source_revision']['number']==2
        assert widget['source']['refreshed_at'] and widget['source']['result_hash']
        assert widget['result']['rows']==[[119.0]]
        assert c.get(path(doc)+'/history').json()['snapshots'][0]['chart']['snapshot']==original
        assert c.app.state.store.get('SavedChart',chart['id'])==library
        provider.generate.assert_not_called();provider.narrate.assert_not_called()
        with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
            audit=db.execute("SELECT result,reason FROM dataset_audit WHERE action='dashboard_refresh'").fetchall()
        assert audit[0][0]=='success' and json.loads(audit[0][1])['source']=='user_ui'


@pytest.mark.parametrize('failure',['guard','timeout','schema','execution'])
def test_failed_refresh_keeps_snapshot_and_document_byte_identical(tmp_path,monkeypatch,failure):
    client,_=fixture(tmp_path)
    with client as c:
        identifier,chart,doc=prepare(c)
        if failure=='schema':
            with connect(tmp_path/(identifier+'.duckdb'),False) as db:db.execute('ALTER TABLE records ADD COLUMN extra VARCHAR')
        elif failure=='guard':
            record=c.app.state.store.get('SavedChart',chart['id']);record['sql']='DELETE FROM data';c.app.state.store.save('SavedChart',record)
        else:monkeypatch.setattr('app.dashboard_workspace.execute_isolated',Mock(side_effect=ExecutionError('Controlled failure',failure)))
        with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
            before=db.execute('SELECT payload FROM dashboards WHERE id=?',(doc['id'],)).fetchone()[0]
            library=db.execute('SELECT payload FROM saved_charts WHERE id=?',(chart['id'],)).fetchone()[0]
        response=refresh(c,doc);assert response.status_code in {409,422},response.text
        with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
            assert db.execute('SELECT payload FROM dashboards WHERE id=?',(doc['id'],)).fetchone()[0]==before
            assert db.execute('SELECT payload FROM saved_charts WHERE id=?',(chart['id'],)).fetchone()[0]==library
            assert db.execute('SELECT COUNT(*) FROM dashboard_widget_snapshots').fetchone()[0]==0
        assert c.get(path(doc)+'/history').json()['snapshots']==[]


def test_refresh_archived_deleted_busy_and_legacy_status(tmp_path):
    client,_=fixture(tmp_path)
    with client as c:
        identifier,chart,doc=prepare(c)
        record=c.app.state.store.get('SavedChart',chart['id']);record.pop('source_revision');c.app.state.store.save('SavedChart',record)
        assert c.get(path(doc,False)).json()['widgets'][0]['freshness']['status']=='Revision not recorded'
        c.post('/api/datasets/'+identifier+'/archive');view=c.get(path(doc,False)).json()
        assert view['widgets'][0]['freshness']['status']=='Source unavailable' and view['widgets'][0]['freshness']['archived']
        assert refresh(c,view).status_code==409
        c.post('/api/datasets/'+identifier+'/restore')
        c.request('DELETE','/api/datasets/'+identifier,json={'confirm_name':'controlled-test.csv','acknowledge_dependencies':True,'acknowledge_benchmark':True})
        view=c.get(path(doc,False)).json();assert 'Deleted dataset (' in view['widgets'][0]['freshness']['label']
        assert refresh(c,view).status_code==409
        assert view['widgets'][0]['result']['rows']==doc['widgets'][0]['result']['rows']


def test_history_retains_only_three_prior_snapshots_and_bulk_failure_isolated(tmp_path):
    client,_=fixture(tmp_path)
    with client as c:
        identifier,chart,doc=prepare(c)
        for i in range(6):
            change(c,identifier,i+1,version=i+1)
            response=refresh(c,doc);assert response.status_code==200;doc=response.json()
        assert HISTORY_LIMIT==3
        history=c.get(path(doc)+'/history').json();assert history['limit']==3 and len(history['snapshots'])==3
        assert [item['chart']['snapshot']['rows'] for item in history['snapshots']]==[[[25.0]],[[24.0]],[[23.0]]]
        assert doc['widgets'][0]['result']['rows']==[[26.0]]
        with sqlite3.connect(tmp_path/'catalog.sqlite') as db:assert db.execute('SELECT COUNT(*) FROM dashboard_widget_snapshots').fetchone()[0]==4
        another=dataset(c);chart2=saved(c,another)
        attached=c.post(path(doc,False)+'/charts',json={'chart_id':chart2['id'],'revision':doc['revision']}).json();doc=attached['dashboard']
        c.post('/api/datasets/'+another+'/archive')
        response=c.post(path(doc,False)+'/refresh-all',json={'confirm_refresh':True,'revision':doc['revision']});assert response.status_code==200
        assert [r['status'] for r in response.json()['results']]==['success','failed']


def test_currency_presentation_exports_never_mutate_values_and_pdf_formatted(tmp_path,monkeypatch):
    monkeypatch.setenv('FX_PROVIDER','frankfurter')
    def fx(source,target,day):return {'base':source,'quote':target,'rate':'0.0125','date':__import__('datetime').date.today().isoformat()}  # relative: the 7-day freshness rule made a fixed date fail once it aged
    client,_=fixture(tmp_path,fx=fx)
    with client as c:
        identifier=dataset(c,b'id,revenue\n001,8379680.76\n')
        settings=c.get(f'/api/datasets/{identifier}/knowledge').json()['settings'];settings['monetary_columns']={'revenue':{'currency':'INR'}}
        c.put(f'/api/datasets/{identifier}/knowledge',json=settings);chart=saved(c,identifier)
        doc=c.post('/api/dashboards',json={'title':'Currency throwaway'}).json()
        doc=c.post(path(doc,False)+'/charts',json={'chart_id':chart['id'],'revision':doc['revision']}).json()['dashboard']
        with sqlite3.connect(tmp_path/'catalog.sqlite') as db:before=list(db.execute('SELECT payload FROM dashboards'))+list(db.execute('SELECT payload FROM saved_charts'))
        assert c.post('/api/currency/convert',json={'source_currency':'INR','target_currency':'USD','amounts':['1']}).status_code==200
        from app import reports
        paragraphs=[];original_paragraph=reports.Paragraph
        def capture(text,*args,**kwargs):
            paragraphs.append(text);return original_paragraph(text,*args,**kwargs)
        monkeypatch.setattr(reports,'Paragraph',capture)
        pdf=c.get(path(doc,False)+'/report.pdf?target_currency=USD');assert pdf.status_code==200 and pdf.content.startswith(b'%PDF-')
        assert any('$104,746.01' in text for text in paragraphs)
        import re
        assert any('Source:' in text and 'Data as of' in text and re.search(r'\d{1,2} [A-Z][a-z]{2} \d{4}',text) for text in paragraphs)  # one readable caption, never a raw ISO timestamp
        assert any('Frankfurter daily reference' in text and '0.0125' in text for text in paragraphs)
        export=c.get(path(doc,False)+'/report.json').json();assert export['widgets'][0]['result']['rows']==[[8379680.76]]
        assert export['widgets'][0]['result']['columns'][0]['money']['currency']=='INR'
        assert export['widgets'][0]['source']['result_hash'] and export['widgets'][0]['display_title']
        with sqlite3.connect(tmp_path/'catalog.sqlite') as db:after=list(db.execute('SELECT payload FROM dashboards'))+list(db.execute('SELECT payload FROM saved_charts'))
        assert before==after
        from app.reports import format_money
        assert format_money(8379680.76,{'currency':'INR'})=='₹83,79,680.76'
        assert format_money(8379680.76,{'currency':'USD'})=='$8,379,680.76'
        assert format_money('001',None,'VARCHAR')=='001'
        assert format_money(12345.6,None,'DOUBLE')=='12,345.6'


def test_additive_migration_and_read_projection_never_modify_existing_dashboard(tmp_path):
    client,_=fixture(tmp_path)
    with client as c:
        _,chart,doc=prepare(c)
        c.post(path(doc,False)+'/charts',json={'chart_id':chart['id'],'revision':doc['revision'],'duplicate_action':'add_anyway'})
    with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
        before=db.execute('SELECT payload FROM dashboards').fetchall();charts=db.execute('SELECT payload FROM saved_charts').fetchall()
        db.execute('DROP TABLE dashboard_widget_snapshots');db.execute('DELETE FROM schema_migrations WHERE version=8');db.commit()
    client,_=fixture(tmp_path)
    with client as c:
        for _ in range(2):assert all(w['matching_widget_ids'] for w in c.get(path(doc,False)).json()['widgets'])
        with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
            assert db.execute('SELECT payload FROM dashboards').fetchall()==before
            assert db.execute('SELECT payload FROM saved_charts').fetchall()==charts
        backups=list((tmp_path/'backups').glob('dashboards-v8-*'));assert len(backups)==1
        with sqlite3.connect(backups[0]/'catalog.sqlite') as db:
            assert db.execute('SELECT payload FROM dashboards').fetchall()==before
            assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='dashboard_widget_snapshots'").fetchone()


def test_conflicting_query_slots_disable_refresh_and_leave_snapshot_untouched(tmp_path):
    client,_=fixture(tmp_path)
    with client as c:
        _,_,doc=prepare(c);slots=c.app.state.analyst.slots
        assert slots.acquire(False) and slots.acquire(False)
        try:
            view=c.get(path(doc,False)).json();assert not view['widgets'][0]['freshness']['can_refresh']
            assert refresh(c,doc).status_code==429
            assert c.get(path(doc)+'/history').json()['snapshots']==[]
        finally:slots.release();slots.release()


def test_currency_unavailable_report_is_explicit_and_keeps_original_snapshot(tmp_path,monkeypatch):
    monkeypatch.setenv('FX_PROVIDER','frankfurter')
    def unavailable(*args):raise ValueError('Controlled unavailable')
    client,_=fixture(tmp_path,fx=unavailable)
    with client as c:
        identifier=dataset(c);settings=c.get(f'/api/datasets/{identifier}/knowledge').json()['settings'];settings['monetary_columns']={'revenue':{'currency':'INR'}};c.put(f'/api/datasets/{identifier}/knowledge',json=settings)
        chart=saved(c,identifier);doc=c.post('/api/dashboards',json={'title':'Unavailable rates'}).json();doc=c.post(path(doc,False)+'/charts',json={'chart_id':chart['id'],'revision':1}).json()['dashboard']
        before=c.app.state.store.get('SavedChart',chart['id'])
        response=c.get(path(doc,False)+'/report.json?target_currency=USD');assert response.status_code==200,response.text
        widget=response.json()['widgets'][0];assert 'Rate unavailable' in widget['currency_unavailable']
        assert widget['result']['rows']==doc['widgets'][0]['result']['rows']
        assert c.app.state.store.get('SavedChart',chart['id'])==before


def test_refresh_duplicate_and_layout_preserve_current_widget_snapshot(tmp_path):
    client,_=fixture(tmp_path)
    with client as c:
        identifier,chart,doc=prepare(c);change(c,identifier,99);doc=refresh(c,doc).json()
        duplicated=c.post(path(doc)+'/duplicate').json();assert len(duplicated['widgets'])==2
        assert all(w['result']['rows']==[[119.0]] for w in duplicated['widgets'])
        copydoc=c.post(path(doc,False)+'/duplicate').json();view=c.get('/api/dashboards/'+copydoc['id']).json()
        assert all(w['result']['rows']==[[119.0]] for w in view['widgets'])
        assert c.get('/api/saved-charts/'+chart['id']).json()['snapshot']['rows']==[[30.5]]


def test_pdf_axis_formatting_matches_compact_ui_rules_and_unique_ticks():
    from app.reports import report_axis,chart_drawing,format_money
    unsafe={'spec':{'kind':'bar'},'points':[{'y':1e20,'label':'large'}]}
    assert chart_drawing(unsafe) is None
    assert format_money('123456789012345678901234567890',None,'HUGEINT')=='123,456,789,012,345,678,901,234,567,890'
    low,high,ticks,formatter=report_axis([1200000,3500000],True,{'currency':'INR'})
    assert low==0 and high>3500000
    assert formatter(0)=='₹0L' and formatter(1000000)=='₹10L'
    assert len(set(map(formatter,ticks)))==len(ticks)
    _,_,ticks,formatter=report_axis([8379680,8379680.76],False,{'currency':'USD'})
    assert len(set(map(formatter,ticks)))==len(ticks)
    assert all(len(v.split('.')[1].split('M')[0])<=1 for v in map(formatter,ticks) if '.' in v)
    _,_,ticks,formatter=report_axis([.00001,.00002],False)
    assert len(set(map(formatter,ticks)))==len(ticks)


def test_deleted_widget_history_remains_readable_until_dashboard_deleted(tmp_path):
    client,_=fixture(tmp_path)
    with client as c:
        _,chart,doc=prepare(c);doc=refresh(c,doc).json();widget=doc['widgets'][0]['id']
        body={k:doc[k] for k in ['title','description','revision','filters']};body['widgets']=[]
        assert c.put(path(doc,False),json=body).status_code==200
        assert len(c.get(path(doc,widget)+'/history').json()['snapshots'])==1
        assert c.delete(path(doc,False)).status_code==204
        with sqlite3.connect(tmp_path/'catalog.sqlite') as db:assert db.execute('SELECT COUNT(*) FROM dashboard_widget_snapshots').fetchone()[0]==0
        assert c.get('/api/saved-charts/'+chart['id']).status_code==200
