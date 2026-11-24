"""Phase 9 changes use disposable workspaces only."""
import gzip,hashlib,json,sqlite3
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import create_app
from app.dataset_revisions import file_hash
from tests.test_phase3 import ControlledEmbedding
from tests.test_knowledge_review import setup,route,draft,review,overview

def test_additive_actor_migration_old_null_new_user_ui_and_mixed_snapshot_restore(tmp_path):
    with TestClient(create_app(tmp_path,embedder=ControlledEmbedding())) as c:
        d=c.post('/api/datasets',files={'file':('throwaway.csv','account,amount,note\n001,10,"你好\nquoted ""cell"""\n002,20,plain\n'.encode())}).json();url='/api/datasets/'+d['id']
        assert c.post(url+'/archive').status_code==200;assert c.post(url+'/restore').status_code==200
        c.app.state.lifecycle.audit('dashboard_refresh',d['id'],'success',json.dumps({'source':'user_ui','detail':'Controlled legacy refresh note'}))
        compressed=tmp_path/'revisions'/d['id']/'1.duckdb.gz';raw=compressed.with_suffix('');raw.write_bytes(gzip.decompress(compressed.read_bytes()));compressed.unlink()
    # A real v8-shaped throwaway catalog: old metadata and raw snapshot bytes.
    with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
        db.execute('UPDATE dataset_revisions SET snapshot_path=?,size_bytes=?',(str(raw.relative_to(tmp_path)),raw.stat().st_size))
        for table,cols in [('dataset_audit',['actor']),('dataset_revisions',['snapshot_format','uncompressed_size_bytes'])]:
            for col in cols:db.execute(f'ALTER TABLE {table} DROP COLUMN {col}')
        db.execute('DELETE FROM schema_migrations WHERE version=9')
        before=db.execute('SELECT * FROM dataset_audit').fetchall();db.commit()
    oldbytes=raw.read_bytes()
    with TestClient(create_app(tmp_path,embedder=ControlledEmbedding())) as c:
        with sqlite3.connect(tmp_path/'catalog.sqlite') as db:
            assert db.execute('SELECT id,dataset_id,action,timestamp,result,reason FROM dataset_audit').fetchall()==before
            assert db.execute('SELECT actor FROM dataset_audit').fetchall()==[(None,),(None,),(None,)]
            assert db.execute('SELECT version FROM schema_migrations ORDER BY version').fetchall()==[(i,) for i in range(1,18)]
        initial=c.get(url+'/rows').json()
        assert c.get(url+'/revisions/1/preview').json()['rows'][0]==['001','10','你好\nquoted "cell"']
        assert c.post(url+'/edits',json={'expected_version':1,'updates':[{'id':initial['rows'][0]['id'],'values':{'amount':'77'}}]}).status_code==200
        history=c.get(url+'/revisions').json();two=history['revisions'][0]
        assert two['snapshot_format']=='gzip' and history['revisions'][1]['snapshot_format'] is None
        path=raw.parent/'2.duckdb.gz';before_bytes=path.read_bytes()
        uncompressed=gzip.decompress(before_bytes);assert hashlib.sha256(uncompressed).hexdigest()==two['sha256']
        assert len(uncompressed)==two['uncompressed_size_bytes'] and len(before_bytes)==two['size_bytes']
        assert c.post(url+'/revisions/1/restore',json={'expected_version':2,'confirm_restore':True,'has_unsaved_edits':False}).status_code==200
        assert c.get(url+'/rows').json()['rows']==initial['rows']
        assert raw.read_bytes()==oldbytes and path.read_bytes()==before_bytes
        audit=c.get(url+'/revisions').json()['audit'];assert any('Controlled legacy refresh note' in (a['reason'] or '') and a['actor'] is None for a in audit);assert audit[0]['actor']=='user_ui' and all(a['actor'] is None for a in audit[1:])
        # Restore the compressed snapshot too, retaining earlier records and exact strings.
        assert c.post(url+'/revisions/2/restore',json={'expected_version':3,'confirm_restore':True,'has_unsaved_edits':False}).status_code==200
        assert c.get(url+'/rows').json()['rows'][0]['values']==['001','77','你好\nquoted "cell"']
        live=file_hash(tmp_path/(d['id']+'.duckdb'));path.chmod(0o600);path.write_bytes(before_bytes[:25]+b'corruption')
        assert c.post(url+'/revisions/2/restore',json={'expected_version':4,'confirm_restore':True,'has_unsaved_edits':False}).status_code==409
        assert file_hash(tmp_path/(d['id']+'.duckdb'))==live
        c.app.state.lifecycle.audit('test_automatic',d['id'],'success',actor='system')
        assert c.get(url+'/revisions').json()['audit'][0]['actor']=='system'
    backups=list((tmp_path/'backups').glob('polish-v9-*'));assert len(backups)==1
    with sqlite3.connect(backups[0]/'catalog.sqlite') as db:assert 'actor' not in [r[1] for r in db.execute('PRAGMA table_info(dataset_audit)')]
    assert (backups[0]/'storage'/raw.relative_to(tmp_path)).read_bytes()==oldbytes

def test_clear_rejected_drafts_count_confirmation_and_approved_provenance_unchanged(tmp_path):
    client,provider=setup(tmp_path)
    with client as c:
        identifier,path=route(c);rows=draft(c,path)
        assert review(c,path,rows[0],'approve').status_code==200
        assert review(c,path,rows[1],'reject').status_code==200
        assert review(c,path,rows[2],'reject').status_code==200
        approved=next(d for d in overview(c,path)['drafts'] if d['status']=='approved')
        assert c.post(path+'/drafts/clear-rejected',json={'confirm':False,'confirm_count':2}).status_code==422
        assert c.post(path+'/drafts/clear-rejected',json={'confirm':True,'confirm_count':1}).status_code==409
        response=c.post(path+'/drafts/clear-rejected',json={'confirm':True,'confirm_count':2});assert response.status_code==200 and response.json()=={'cleared_count':2}
        assert overview(c,path)['drafts']==[approved]
        assert c.get(path).json()['settings']['description']==approved['content']['description']
        assert c.post(path+'/drafts/clear-rejected',json={'confirm':True,'confirm_count':2}).status_code==409

def test_scalar_typed_expected_uses_identical_existing_comparator_to_manual_table(tmp_path):
    from tests.test_knowledge_review import candidate,check,expected
    client,provider=setup(tmp_path)
    with client as c:
        identifier,path=route(c);row,run=candidate(c,identifier,path)
        manual=check(c,path,row).json();assert manual['check']['passed']
        scalar=check(c,path,row,expected={'columns':[{'name':'total','type':'DOUBLE'}],'rows':[['30.5']],'row_count':1}).json()
        assert scalar['check']==manual['check']
