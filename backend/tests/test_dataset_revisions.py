"""All revision tests use temporary datasets and real DuckDB files."""
import csv
import hashlib
import io
import json
import sqlite3
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.main import create_app, connect
from app.dataset_revisions import file_hash
from tests.test_phase3 import ControlledEmbedding
from tests.test_analyst import ControlledProvider, submit, finish


@pytest.fixture
def workspace(tmp_path):
    app=create_app(tmp_path,provider=ControlledProvider(sql='SELECT SUM(amount) AS total FROM data'),embedder=ControlledEmbedding())
    with TestClient(app) as c:
        item=c.post('/api/datasets',files={'file':('revision.csv','account,amount,note\n001,10,"你好,""quoted""\nsecond line"\n002,20,plain\n'.encode())}).json()
        yield c,tmp_path,'/api/datasets/'+item['id']


def edit(c,path,value,version=None):
    page=c.get(path+'/rows').json()
    return c.post(path+'/edits',json={'expected_version':version or page['version'],'updates':[{'id':page['rows'][0]['id'],'values':{'amount':value}}]})


def restore(c,path,revision,version=None,**kwargs):
    body=dict(expected_version=version or c.get(path+'/version').json()['version'],confirm_restore=True,has_unsaved_edits=False)
    body.update(kwargs)
    return c.post(path+f'/revisions/{revision}/restore',json=body)


def test_import_save_restore_exact_strings_and_immutable_snapshots(workspace):
    c,root,path=workspace;identifier=path.split('/')[-1]
    initial=c.get(path+'/rows').json();history=c.get(path+'/revisions').json()
    assert history['current_revision']==1 and history['revisions'][0]['source']=='import'
    one=root/'revisions'/identifier/'1.duckdb.gz';original_hash=file_hash(one)
    assert edit(c,path,'1234.50').status_code==200
    first=c.get(path+'/revisions').json()['revisions'][0]
    assert first['source']=='edit_save' and first['changed_cells']==1
    assert first['sha256']==hashlib.sha256(__import__('gzip').decompress((root/'revisions'/identifier/'2.duckdb.gz').read_bytes())).hexdigest()
    assert first['size_bytes']==(root/'revisions'/identifier/'2.duckdb.gz').stat().st_size
    assert first['row_count']==2
    preview=c.get(path+'/revisions/1/preview?limit=1').json()
    assert preview['rows']==[['001','10','你好,"quoted"\nsecond line']] and preview['total']==2
    earlier_files={p.name:p.read_bytes() for p in one.parent.glob('*.duckdb*')}
    earlier_metadata=c.get(path+'/revisions').json()['revisions']
    result=restore(c,path,1);assert result.status_code==200,result.text
    assert result.json()['version']==3
    current=c.get(path+'/rows').json()
    assert current['rows']==initial['rows'] and current['type_mapping']==initial['type_mapping']
    assert list(csv.reader(io.StringIO(c.get(path+'/export').text)))==[['account','amount','note'],['001','10','你好,"quoted"\nsecond line'],['002','20','plain']]
    assert file_hash(one)==original_hash
    history=c.get(path+'/revisions').json()
    assert [r['revision'] for r in history['revisions']]==[3,2,1]
    assert history['revisions'][1:]==earlier_metadata
    assert all((one.parent/name).read_bytes()==data for name,data in earlier_files.items())
    assert history['revisions'][0]['source']=='restore' and history['revisions'][0]['restored_from']==1
    assert file_hash(root/(identifier+'.duckdb'))==history['revisions'][0]['sha256']
    with connect(root/(identifier+'.duckdb')) as db:
        original=db.execute('SELECT original FROM _editor_state').fetchone()[0]
        assert bytes(original).startswith(b'account,amount,note\n001,10,')
    with sqlite3.connect(root/'catalog.sqlite') as db:
        assert db.execute("SELECT action,result FROM dataset_audit").fetchall()==[('restore_revision','success')]


@pytest.mark.parametrize('values',[{'expected_version':99},{'has_unsaved_edits':True},{'confirm_restore':False}])
def test_restore_preconditions_do_not_mutate_live_data(workspace,values):
    c,root,path=workspace;before=c.get(path+'/rows').json();file=root/(path.split('/')[-1]+'.duckdb');digest=file_hash(file)
    response=restore(c,path,1,**values)
    assert response.status_code==409
    assert c.get(path+'/rows').json()==before and file_hash(file)==digest


def test_hash_mismatch_aborts_before_live_change(workspace):
    c,root,path=workspace;identifier=path.split('/')[-1]
    snapshot=root/'revisions'/identifier/'1.duckdb.gz';snapshot.chmod(0o600);snapshot.write_bytes(snapshot.read_bytes()+b'corrupt')
    before=file_hash(root/(identifier+'.duckdb'));rows=c.get(path+'/rows').json()
    result=restore(c,path,1);assert result.status_code==409 and 'hash verification' in result.text
    assert file_hash(root/(identifier+'.duckdb'))==before and c.get(path+'/rows').json()==rows
    assert c.get(path+'/revisions/1/preview').status_code==409


def test_copy_failure_aborts_and_does_not_remove_prior_snapshots(workspace,monkeypatch):
    c,root,path=workspace;before=c.get(path+'/rows').json();snapshot=root/'revisions'/path.split('/')[-1]/'1.duckdb.gz';digest=file_hash(snapshot)
    def broken(source,destination):
        if destination.name.startswith('.stage-'):
            raise OSError('test disk unavailable')
        raise AssertionError('unexpected copy')
    monkeypatch.setattr('app.dataset_revisions.durable_copy',broken)
    with pytest.raises(OSError):edit(c,path,'88')
    assert c.get(path+'/rows').json()==before and file_hash(snapshot)==digest


def test_archive_read_only_delete_removes_snapshots(workspace):
    c,root,path=workspace;identifier=path.split('/')[-1];folder=root/'revisions'/identifier
    before={p.name:file_hash(p) for p in folder.glob('*.duckdb*')}
    assert c.post(path+'/archive').status_code==200
    assert c.get(path+'/revisions/1/preview').status_code==200
    assert restore(c,path,1).status_code==409
    assert edit(c,path,'55').status_code==409
    assert {p.name:file_hash(p) for p in folder.glob('*.duckdb*')}==before
    assert c.post(path+'/restore').status_code==200
    assert c.request('DELETE',path,json={'confirm_name':'revision.csv','acknowledge_dependencies':True}).status_code==204
    assert not folder.exists()
    with sqlite3.connect(root/'catalog.sqlite') as db:assert db.execute('SELECT count(*) FROM dataset_revisions').fetchone()[0]==0


def test_retention_prunes_oldest_and_protects_in_progress(workspace):
    c,root,path=workspace;service=c.app.state.revisions;service.limit=3;identifier=path.split('/')[-1]
    for i in range(4):assert edit(c,path,str(100+i)).status_code==200
    history=c.get(path+'/revisions').json()
    assert [r['status'] for r in history['revisions']]==['available']*3+['pruned']*2
    assert len(list((root/'revisions'/identifier).glob('*.duckdb*')))==3
    assert restore(c,path,1).status_code==409 and c.get(path+'/revisions/1/preview').status_code==409
    assert restore(c,path,3).status_code==200
    assert c.get(path+'/version').json()['version']==6
    history=c.get(path+'/revisions').json();assert [r['revision'] for r in history['revisions'] if r['status']=='available']==[6,5,4]
    assert history['snapshot_bytes']==sum(p.stat().st_size for p in (root/'revisions'/identifier).glob('*.duckdb*'))
    service.protected.add((identifier,4));service.limit=1;service.prune(identifier)
    assert (root/'revisions'/identifier/'4.duckdb.gz').exists()
    service.protected.clear();service.prune(identifier)
    assert len(list((root/'revisions'/identifier).glob('*.duckdb*')))==1


@pytest.mark.parametrize('kind',['Analyst','MLExperiment','Evaluation'])
def test_restore_blocks_active_jobs(workspace,kind):
    c,root,path=workspace;identifier=path.split('/')[-1]
    if kind=='Analyst':
        Run=c.app.state.analyst.Run
        with Session(c.app.state.analyst.engine) as session:
            session.add(Run(id=str(uuid4()),dataset_id=identifier,status='queued',created_at='2026-01-01',payload=json.dumps({'id':'active','dataset_id':identifier,'status':'queued','question':'fixture'})));session.commit()
    else:
        c.app.state.store.save(kind,{'id':str(uuid4()),'dataset_id':identifier,'status':'running','created_at':'2026-01-01','updated_at':'2026-01-01'})
    response=restore(c,path,1)
    assert response.status_code==409 and c.get(path+'/version').json()['version']==1


def test_restore_preserves_historical_runs_and_snapshot_payloads(workspace):
    c,root,path=workspace;identifier=path.split('/')[-1]
    run=submit(c,identifier,mapping={'amount':'DOUBLE'});assert finish(c,run)['status']=='succeeded'
    old=c.get('/api/analyst/runs/'+run).json();result=c.get('/api/analyst/runs/'+run+'/results').json()
    assert edit(c,path,'900').status_code==200
    assert restore(c,path,1).status_code==200
    assert c.get('/api/analyst/runs/'+run).json()==old
    assert c.get('/api/analyst/runs/'+run+'/results').json()==result


def test_first_post_migration_save_has_no_fabricated_legacy_snapshot(tmp_path):
    with TestClient(create_app(tmp_path)) as c:
        item=c.post('/api/datasets',files={'file':('legacy.csv',b'id,value\n001,5\n')}).json();path='/api/datasets/'+item['id']
    # Construct a true pre-v6 catalog from a temporary fixture only.
    import shutil
    shutil.rmtree(tmp_path/'revisions')
    with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
        db.execute('DROP TABLE dataset_revisions');db.execute('DELETE FROM schema_migrations WHERE version=6');db.commit()
        before={t:db.execute('SELECT * FROM '+t).fetchall() for t in ['datasets','analyst_runs','knowledge_state','dashboards']}
    digest=file_hash(tmp_path/(item['id']+'.duckdb'))
    with TestClient(create_app(tmp_path)) as c:
        with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
            assert all(db.execute('SELECT * FROM '+t).fetchall()==rows for t,rows in before.items())
            assert [r[0] for r in db.execute('SELECT version FROM schema_migrations ORDER BY version')]==list(range(1,18))
        assert file_hash(tmp_path/(item['id']+'.duckdb'))==digest
        assert c.get(path+'/revisions').json()['revisions'][0]['status']=='unavailable'
        page=c.get(path+'/rows').json()
        assert c.post(path+'/edits',json={'expected_version':1,'updates':[{'id':page['rows'][0]['id'],'values':{'value':'6'}}]}).status_code==200
        history=c.get(path+'/revisions').json()
        assert [(r['revision'],r['status']) for r in history['revisions']]==[(2,'available'),(1,'unavailable')]
    backups=list((tmp_path/'backups').glob('revisions-v6-*'));assert len(backups)==1
    assert (backups[0]/'catalog.sqlite').exists()
    assert file_hash(backups[0]/'storage'/(item['id']+'.duckdb'))==digest
    with TestClient(create_app(tmp_path)) as c:assert c.get(path+'/version').json()['version']==2


def test_pending_commit_recovers_without_touching_other_revisions(workspace):
    c,root,path=workspace;service=c.app.state.revisions;identifier=path.split('/')[-1]
    assert edit(c,path,'44').status_code==200
    with Session(service.engine) as session:
        row=session.get(service.Model,(identifier,2));row.status='pending';session.commit()
    before=file_hash(root/(identifier+'.duckdb'));service.recover()
    assert c.get(path+'/revisions').json()['revisions'][0]['status']=='available'
    assert file_hash(root/(identifier+'.duckdb'))==before


def test_restore_verifies_the_copied_bytes_before_changing_metadata(workspace,monkeypatch):
    import app.dataset_revisions as module
    c,root,path=workspace;identifier=path.split('/')[-1];source=root/'revisions'/identifier/'1.duckdb.gz'
    copy=module.durable_copy;observed=[];before=c.get(path+'/rows').json()
    def verified_then_corrupt(src,dest):
        copy(src,dest)
        if dest.name.startswith('.stage-'):
            observed.append(file_hash(src)==file_hash(dest) and src.read_bytes()==dest.read_bytes())
            with dest.open('ab') as out:out.write(b'bad-copy')
    monkeypatch.setattr(module,'durable_copy',verified_then_corrupt)
    response=restore(c,path,1)
    assert response.status_code==409 and observed==[True]
    assert c.get(path+'/rows').json()==before
    assert hashlib.sha256(__import__('gzip').decompress(source.read_bytes())).hexdigest()==c.get(path+'/revisions').json()['revisions'][0]['sha256']


def test_pending_older_commit_recovers_after_a_later_revision(workspace):
    c,root,path=workspace;service=c.app.state.revisions;identifier=path.split('/')[-1]
    assert edit(c,path,'44').status_code==200
    with Session(service.engine) as session:
        row=session.get(service.Model,(identifier,2));row.status='pending';session.commit()
    assert edit(c,path,'55').status_code==200
    old=root/'revisions'/identifier/'2.duckdb.gz';digest=file_hash(old)
    service.recover()
    assert file_hash(old)==digest
    assert [r['status'] for r in c.get(path+'/revisions').json()['revisions']]==['available']*3


def test_existing_snapshot_cannot_be_overwritten(workspace):
    from fastapi import HTTPException
    c,root,path=workspace;service=c.app.state.revisions;identifier=path.split('/')[-1]
    snap=root/'revisions'/identifier/'1.duckdb.gz';digest=file_hash(snap)
    state=c.get(path+'/version').json()
    with pytest.raises(HTTPException):service.publish(identifier,root/(identifier+'.duckdb'),state,2,'import',None,replace=False)
    assert file_hash(snap)==digest


def test_default_retention_keeps_twenty_snapshots(workspace):
    c,root,path=workspace;identifier=path.split('/')[-1]
    for i in range(21):assert edit(c,path,str(100+i)).status_code==200
    history=c.get(path+'/revisions').json()
    assert history['snapshot_limit']==20
    assert len([r for r in history['revisions'] if r['status']=='available'])==20
    assert len([r for r in history['revisions'] if r['status']=='pruned'])==2
    assert len(list((root/'revisions'/identifier).glob('*.duckdb*')))==20


def test_migration_fails_closed_when_backup_fails(tmp_path,monkeypatch):
    from sqlalchemy import create_engine,text,inspect
    from app.main import DatasetRevision
    from app.dataset_revisions import migrate
    engine=create_engine('sqlite:///'+str(tmp_path/'catalog.sqlite'))
    with engine.begin() as db:
        db.execute(text('CREATE TABLE datasets(id TEXT)'))
        db.execute(text("INSERT INTO datasets VALUES('existing')"))
    def unavailable(*args,**kwargs):raise OSError('backup destination unavailable')
    monkeypatch.setattr('app.dataset_revisions.sqlite3.connect',unavailable)
    with pytest.raises(OSError):migrate(engine,tmp_path,DatasetRevision)
    assert not inspect(engine).has_table('dataset_revisions')
    with engine.connect() as db:assert db.execute(text('SELECT * FROM datasets')).all()==[('existing',)]
    engine.dispose()


def test_restore_does_not_rewrite_models_predictions_or_training_records(tmp_path):
    import math
    from tests.test_automl import finish as finish_ml
    with TestClient(create_app(tmp_path,embedder=ControlledEmbedding())) as c:
        raw='account,x,revenue\n'+''.join(f'{i+1:03},{math.sin(i)*3+i*.11},{i+10}.00\n' for i in range(80))
        item=c.post('/api/datasets',files={'file':('SYNTHETIC-restore-model.csv',raw.encode())}).json();path='/api/datasets/'+item['id']
        config={'dataset_id':item['id'],'task':'anomaly','features':[{'name':'x','kind':'numeric'}],'confirm_feature_availability':True}
        accepted=c.post('/api/automl/experiments',json=config);assert accepted.status_code==202,accepted.text
        job=finish_ml(c,accepted.json());assert job['status']=='completed'
        model=c.get('/api/automl/models/'+job['result']['selected_model_id']).json()
        artifact=tmp_path/model['artifact_path'];digest=file_hash(artifact)
        predicted=c.post('/api/automl/models/'+model['id']+'/predict',json={'records':[{'x':'1.25'}]}).json()
        csv_before=c.get('/api/automl/predictions/'+predicted['id']+'/export.csv').content
        page=c.get(path+'/rows').json()
        assert c.post(path+'/edits',json={'expected_version':1,'updates':[{'id':page['rows'][0]['id'],'values':{'revenue':'9000.00'}}]}).status_code==200
        assert c.post('/api/automl/models/'+model['id']+'/predict',json={'records':[{'x':'1.25'}]}).status_code==409
        assert restore(c,path,1).status_code==200
        assert c.get('/api/automl/models/'+model['id']).json()==model
        assert c.get('/api/automl/experiments/'+job['id']).json()==job
        assert c.get('/api/automl/predictions/'+predicted['id']+'/export.csv').content==csv_before
        assert file_hash(artifact)==digest
        assert c.get(path+'/rows').json()['rows']==page['rows']
        replay=c.post('/api/automl/models/'+model['id']+'/predict',json={'records':[{'x':'1.25'}]})
        assert replay.status_code==200 and replay.json()['rows']==predicted['rows']
