"""All lifecycle tests create their own datasets under pytest tmp_path; no local workspace access."""
import json
import sqlite3
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.main import create_app, DatasetAudit
from tests.test_phase3 import ControlledEmbedding

@pytest.fixture
def workspace(tmp_path):
    app=create_app(tmp_path,embedder=ControlledEmbedding())
    with TestClient(app) as client:yield client,app,tmp_path

def upload(c,name='temporary.csv'):
    r=c.post('/api/datasets',files={'file':(name,b'id,value\n001,1250\n','text/csv')});assert r.status_code==201,r.text
    return r.json()

def delete(c,d,**extra):
    return c.request('DELETE','/api/datasets/'+d['id'],json={'confirm_name':d.get('display_name') or d['name'],**extra})

def test_additive_migration_backup_and_restart(tmp_path):
    # A genuine legacy schema, including existing values, not a fresh metadata create.
    db=tmp_path/'catalog.sqlite'
    with sqlite3.connect(db) as connection:
        connection.execute('CREATE TABLE datasets (id VARCHAR(36) PRIMARY KEY,name VARCHAR(255) NOT NULL,rows INTEGER NOT NULL,bytes INTEGER NOT NULL,created_at VARCHAR(40) NOT NULL,schema_json TEXT NOT NULL)')
    app=create_app(tmp_path,embedder=ControlledEmbedding())
    with TestClient(app) as c:
        d=upload(c);assert d['display_name'] is None
        c.patch('/api/datasets/'+d['id'],json={'display_name':'My records'})
    before=json.loads(json.dumps(d))
    with TestClient(create_app(tmp_path,embedder=ControlledEmbedding())) as c:
        assert c.get('/api/datasets').json()[0]['display_name']=='My records'
        assert c.get('/api/datasets').json()[0]['name']==before['name']
    backups=list((tmp_path/'backups').glob('lifecycle-*/catalog.sqlite'));assert len(backups)==1
    assert len(list((tmp_path/'backups').glob('revisions-v6-*/catalog.sqlite')))==1
    with sqlite3.connect(backups[0]) as connection:
        assert 'display_name' not in {r[1] for r in connection.execute('PRAGMA table_info(datasets)')}
    with sqlite3.connect(db) as connection:
        assert all(not r[3] for r in connection.execute('PRAGMA table_info(datasets)') if r[1] in {'display_name','archived_at','archived_reason'})

@pytest.mark.parametrize('name',[None,'','   ','Retail Demo','  Retail Demo  '])
def test_rename_reset_original_and_audit(workspace,name):
    c,app,root=workspace;d=upload(c);data=(root/(d['id']+'.duckdb')).read_bytes()
    r=c.patch('/api/datasets/'+d['id'],json={'display_name':name});assert r.status_code==200
    assert r.json()['name']=='temporary.csv';assert r.json()['display_name']==(name.strip() or None if name else None)
    assert (root/(d['id']+'.duckdb')).read_bytes()==data
    with Session(app.state.lifecycle.engine) as session:
        assert session.scalar(select(DatasetAudit).where(DatasetAudit.action=='rename')).result=='success'

@pytest.mark.parametrize('name',['x'*121,'bad\nname','bad\x00name','bad\tname','bad\u200bname'])
def test_rename_rejects_invalid(workspace,name):
    c,_,_=workspace;d=upload(c);assert c.patch('/api/datasets/'+d['id'],json={'display_name':name}).status_code==422
    assert c.get('/api/datasets/'+d['id']).json()['display_name'] is None

def test_archive_restore_and_new_operations_blocked(workspace):
    c,app,root=workspace;d=upload(c);original=(root/(d['id']+'.duckdb')).read_bytes()
    assert c.post('/api/datasets/'+d['id']+'/archive',json={'reason':'Finished'}).status_code==200
    assert c.get('/api/datasets').json()==[]
    assert c.get('/api/datasets?include_archived=true').json()[0]['archived_reason']=='Finished'
    assert c.get('/api/datasets?archived_only=true').json()[0]['id']==d['id']
    assert c.get('/api/datasets/'+d['id']).status_code==200
    assert c.post('/api/analyst/runs',json={'dataset_id':d['id'],'question':'Count rows','type_mapping':{}}).status_code==409
    assert c.get('/api/automl/datasets/'+d['id']+'/profile').status_code==422
    assert c.post('/api/datasets/'+d['id']+'/restore').status_code==200
    assert c.get('/api/datasets').json()[0]['archived_at'] is None
    assert (root/(d['id']+'.duckdb')).read_bytes()==original


def seed_dependencies(app,d):
    # Persist minimal historical fixture documents directly, with no model or AI call.
    stamp='2026-01-01T00:00:00Z';chart=str(uuid4());run=str(uuid4());model=str(uuid4());dash=str(uuid4())
    app.state.store.save('SavedChart',{'id':chart,'dataset_id':d['id'],'dataset_name':d['name'],'title':'Sales snapshot','created_at':stamp})
    app.state.store.save('Dashboard',{'id':dash,'title':'Quarterly sales','widgets':[{'chart_id':chart}],'created_at':stamp})
    app.state.store.save('MLModel',{'id':model,'dataset_id':d['id'],'title':'Measured model','created_at':stamp})
    with Session(app.state.lifecycle.engine) as s:
        s.add(app.state.analyst.Run(id=run,dataset_id=d['id'],status='succeeded',created_at=stamp,payload=json.dumps({'id':run,'dataset_id':d['id'],'dataset_name':d['name'],'question':'Saved question','created_at':stamp,'status':'succeeded'})));s.commit()
    return run,chart,model,dash


def test_dependencies_guards_and_retained_history(workspace):
    c,app,root=workspace;d=upload(c);ids=seed_dependencies(app,d)
    artifact=root/'automl'/'models'/(ids[2]+'.joblib');artifact.write_bytes(b'Temporary test artifact; never deserialized')
    before=[app.state.store.get(kind,identifier) for kind,identifier in zip(['SavedChart','MLModel','Dashboard'],ids[1:])]
    deps=c.get('/api/datasets/'+d['id']+'/dependencies').json()
    assert deps['counts']['dashboards']==deps['counts']['saved_questions']==deps['counts']['models']==1
    assert deps['groups']['dashboards'][0]['title']=='Quarterly sales'
    assert c.request('DELETE','/api/datasets/'+d['id']).status_code==422
    assert delete(c,{**d,'display_name':'wrong'}).status_code==422
    assert delete(c,d).status_code==409
    assert delete(c,d,acknowledge_dependencies=True).status_code==204
    assert not (root/(d['id']+'.duckdb')).exists()
    assert c.get('/api/datasets').json()==[]
    ref=c.get('/api/datasets/references').json()[0];assert ref['label']=='Deleted dataset (temporary.csv)'
    assert ref['original_name']==d['name']
    assert app.state.analyst.load(ids[0])['dataset_name']==d['name']
    assert artifact.read_bytes()==b'Temporary test artifact; never deserialized'
    assert [app.state.store.get(kind,identifier) for kind,identifier in zip(['SavedChart','MLModel','Dashboard'],ids[1:])]==before

@pytest.mark.parametrize('kind',['analyst','Evaluation','MLExperiment','prediction'])
def test_active_jobs_block_delete(workspace,kind):
    c,app,_=workspace;d=upload(c);identifier=str(uuid4())
    data={'id':identifier,'dataset_id':d['id'],'status':'running','question':'Active task','created_at':'2026-01-01'}
    if kind=='analyst':
        with Session(app.state.lifecycle.engine) as s:s.add(app.state.analyst.Run(id=identifier,dataset_id=d['id'],status='executing',created_at=data['created_at'],payload=json.dumps(data)));s.commit()
    elif kind=='prediction':app.state.automl.active_predictions[identifier]={**data,'dataset_ids':[d['id']]}
    else:app.state.store.save(kind,data)
    assert c.get('/api/datasets/'+d['id']+'/dependencies').json()['delete_blocked'] is True
    assert delete(c,d,acknowledge_dependencies=True).status_code==409
    assert c.get('/api/datasets/'+d['id']).status_code==200


def test_bulk_partial_failures_and_confirmation(workspace):
    c,app,_=workspace;first=upload(c);second=upload(c,'other.csv');unknown=str(uuid4())
    results=c.post('/api/datasets/bulk-archive',json={'ids':[first['id'],unknown,second['id']]}).json()
    assert [r['status'] for r in results]==['success','blocked','success']
    items=[{'id':first['id'],'confirm_name':'wrong'},{'id':unknown,'confirm_name':'missing'},{'id':second['id'],'confirm_name':second['name'],'acknowledge_dependencies':True}]
    payload={'items':items,'confirm_word':'DELETE','confirm_count':2}
    assert c.post('/api/datasets/bulk-delete',json=payload).status_code==422
    payload['confirm_count']=3;results=c.post('/api/datasets/bulk-delete',json=payload).json()
    assert [r['status'] for r in results]==['blocked','blocked','success']
    assert c.get('/api/datasets/'+first['id']).status_code==200


def test_benchmark_ack_and_archive_warning(workspace):
    c,app,_=workspace;d=upload(c,'CONTROLLED-BENCHMARK-test.csv')
    app.state.store.save('BenchmarkInstall',{'id':str(uuid4()),'dataset_id':d['id'],'version':'retail-v1'})
    deps=c.get('/api/datasets/'+d['id']+'/dependencies').json();assert deps['benchmark_required'];assert 'Evaluation will become unavailable' in deps['benchmark_warning']
    assert delete(c,d,acknowledge_dependencies=True).status_code==409
    assert delete(c,d,acknowledge_dependencies=True,acknowledge_benchmark=True).status_code==204

def test_migration_preserves_every_legacy_value_without_row_rewrite(tmp_path):
    from app.dataset_lifecycle import migrate_lifecycle
    from app.main import Dataset,DatasetReference,DatasetAudit
    identifier=str(uuid4());db=tmp_path/'catalog.sqlite'
    values=(identifier,'original-real-name.csv',2430,98231,'2026-01-01','[{"name":"account","type":"VARCHAR","null_count":0}]')
    with sqlite3.connect(db) as c:
        c.execute('CREATE TABLE datasets (id TEXT PRIMARY KEY,name TEXT NOT NULL,rows INTEGER NOT NULL,bytes INTEGER NOT NULL,created_at TEXT NOT NULL,schema_json TEXT NOT NULL)')
        c.execute('INSERT INTO datasets VALUES (?,?,?,?,?,?)',values)
    storage=tmp_path/(identifier+'.duckdb');storage.write_bytes(b'Temporary storage sentinel: never opened as a real dataset')
    app=create_app(tmp_path,embedder=ControlledEmbedding())
    migrate_lifecycle(app.state.lifecycle.engine,tmp_path,Dataset,DatasetReference,DatasetAudit)
    with sqlite3.connect(db) as c:
        assert c.execute('SELECT id,name,rows,bytes,created_at,schema_json FROM datasets').fetchone()==values
        assert c.execute('SELECT display_name,archived_at,archived_reason FROM datasets').fetchone()==(None,None,None)
    backup=next((tmp_path/'backups').glob('*/storage'))
    assert (backup/storage.name).read_bytes()==storage.read_bytes()
    app.state.lifecycle.engine.dispose()


def test_archived_dataset_stays_readable_for_already_admitted_model_validation(workspace):
    from app.automl.data import read_dataset, MLFailure
    c,app,_=workspace;d=upload(c)
    before=read_dataset(app.state.analyst,d['id'])
    c.post('/api/datasets/'+d['id']+'/archive')
    with pytest.raises(MLFailure):read_dataset(app.state.analyst,d['id'])
    assert read_dataset(app.state.analyst,d['id'],allow_archived=True)==before


def test_legacy_deleted_reference_is_resolved_without_rewriting_history(workspace):
    c,app,_=workspace;identifier=str(uuid4());run_id=str(uuid4())
    payload=json.dumps({'id':run_id,'dataset_id':identifier,'dataset_name':'legacy-original.csv','status':'succeeded','question':'Saved history'})
    with Session(app.state.lifecycle.engine) as session:
        session.add(app.state.analyst.Run(id=run_id,dataset_id=identifier,status='succeeded',created_at='2026-01-01',payload=payload));session.commit()
    refs=c.get('/api/datasets/references').json()
    assert refs[0]['label']=='Deleted dataset (legacy-original.csv)'
    with Session(app.state.lifecycle.engine) as session:assert session.get(app.state.analyst.Run,run_id).payload==payload
