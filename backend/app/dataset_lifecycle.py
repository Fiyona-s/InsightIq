"""Single-user dataset lifecycle. Historical payloads and model artifacts are immutable here."""
import json
import re
import shutil
import sqlite3
import unicodedata
from pathlib import Path
from typing import Optional, List
from uuid import UUID, uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, String, Text, select, inspect, text
from sqlalchemy.orm import Session
from .persistence import utcnow


def register(base):
    class DatasetReference(base):
        __tablename__ = 'dataset_references'
        id = Column(String(36), primary_key=True)
        original_name = Column(Text, nullable=True)
        display_name = Column(Text, nullable=True)
        deleted_at = Column(String(40), nullable=True)
    class DatasetAudit(base):
        __tablename__ = 'dataset_audit'
        id = Column(String(36), primary_key=True)
        dataset_id = Column(String(36), nullable=True)
        action = Column(String(40), nullable=True)
        timestamp = Column(String(40), nullable=True)
        result = Column(String(20), nullable=True)
        reason = Column(Text, nullable=True)
        actor = Column(String(20), nullable=True)
    return DatasetReference, DatasetAudit


def migrate_lifecycle(engine, root, Dataset, Reference, Audit):
    """Add nullable fields only. Backup an existing catalog before any lifecycle DDL.

    Removing the added columns is unnecessary for rollback: the old app ignores them.
    The standalone backup can restore the exact pre-migration catalog/storage if needed.
    """
    columns = {c['name'] for c in inspect(engine).get_columns('datasets')}
    missing = {'display_name': 'TEXT', 'archived_at': 'VARCHAR(40)', 'archived_reason': 'TEXT'}.keys() - columns
    if missing:
        folder = root / 'backups' / ('lifecycle-' + utcnow().replace(':', '-'))
        folder.mkdir(parents=True)
        # Include editor/history/model/RAG storage, excluding recursive backups and SQLite files.
        shutil.copytree(root, folder / 'storage', ignore=shutil.ignore_patterns('backups', 'catalog.sqlite*'), dirs_exist_ok=True)
        if engine.dialect.name == 'sqlite' and engine.url.database and Path(engine.url.database).is_file():
            with sqlite3.connect(engine.url.database) as source, sqlite3.connect(folder / 'catalog.sqlite') as target:
                source.backup(target)
        else:
            raise RuntimeError('Lifecycle migration requires a verified database backup for this database engine.')
        with engine.begin() as connection:
            for name in sorted(missing):
                connection.execute(text('ALTER TABLE datasets ADD COLUMN ' + name + ' ' + {'display_name':'TEXT','archived_at':'VARCHAR(40)','archived_reason':'TEXT'}[name]))
    Reference.__table__.create(engine, checkfirst=True)
    Audit.__table__.create(engine, checkfirst=True)


class Rename(BaseModel):
    model_config = ConfigDict(extra='forbid')
    display_name: Optional[str] = None


class Confirmation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    confirm_name: str = ''
    acknowledge_dependencies: bool = False
    acknowledge_benchmark: bool = False


class Archive(BaseModel):
    model_config = ConfigDict(extra='forbid')
    reason: Optional[str] = Field(default=None, max_length=500)


class BulkItem(Confirmation):
    id: UUID


class BulkDelete(BaseModel):
    model_config = ConfigDict(extra='forbid')
    items: List[BulkItem] = Field(min_length=1, max_length=100)
    confirm_word: str
    confirm_count: int


class BulkArchive(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ids: List[UUID] = Field(min_length=1, max_length=100)


class Lifecycle:
    def __init__(self, root, engine, Dataset, Reference, Audit, analyst, knowledge, store, info, automl=None, evaluations=None):
        self.root, self.engine, self.Dataset, self.Reference, self.Audit = root, engine, Dataset, Reference, Audit
        self.analyst, self.knowledge, self.store, self.info = analyst, knowledge, store, info
        self.automl=automl
        self.admission_lock=evaluations.lock if evaluations else __import__("threading").RLock()

    def item(self, identifier):
        with Session(self.engine) as session:
            item = session.get(self.Dataset, str(identifier))
            if item is None: raise HTTPException(404, 'Dataset not found.')
            return item

    def audit(self, action, identifier, result, reason=None, *, actor="user_ui"):
        if actor not in {"user_ui","system"}:raise ValueError("Unknown local audit source.")
        with Session(self.engine) as session:
            session.add(self.Audit(id=str(uuid4()), dataset_id=str(identifier), action=action, timestamp=utcnow(), result=result, reason=reason, actor=actor))
            session.commit()

    def perform(self, action, identifier, work):
        try:
            # Same locks/order as knowledge mutations, Analyst submissions and AutoML snapshots.
            with self.admission_lock, self.knowledge.lock, self.analyst.lock:
                result = work()
            self.audit(action, identifier, 'success')
            return result
        except HTTPException as exc:
            self.audit(action, identifier, 'failed' if exc.status_code>=500 else 'blocked', str(exc.detail))
            raise
        except Exception:
            self.audit(action, identifier, 'failed', 'Operation failed; inspect local API logs.')
            raise

    def references(self):
        with Session(self.engine) as session:
            records = {r.id: dict(id=r.id, original_name=r.original_name, display_name=r.display_name, deleted=True, archived=False,
                                  label='Deleted dataset (' + r.original_name + ')') for r in session.scalars(select(self.Reference))}
            for r in session.scalars(select(self.Dataset)):
                records[r.id] = dict(id=r.id, original_name=r.name, display_name=r.display_name, deleted=False, archived=bool(r.archived_at), label=r.display_name or r.name)
            # Legacy deletions predate tombstones. Resolve their names from immutable
            # historical payloads on read, without backfilling or rewriting records.
            historical=[json.loads(row.payload) for row in session.scalars(select(self.analyst.Run))]
            for kind in ('SavedChart','MLExperiment'):
                historical.extend(json.loads(row.payload) for row in session.scalars(select(self.store.models[kind])))
            for data in historical:
                identifier,original=data.get('dataset_id'),data.get('dataset_name')
                if identifier and original and identifier not in records:
                    records[identifier]=dict(id=identifier,original_name=original,display_name=None,deleted=True,archived=False,label='Deleted dataset ('+original+')')
            return list(records.values())

    def dependencies(self, identifier):
        item = self.item(identifier)
        groups = {k: [] for k in ['dashboards','saved_charts','saved_questions','experiments','models','predictions','knowledge_entries','evaluations','benchmark_records','rag_indexes','active_jobs']}
        def add(kind, data, title=None):
            groups[kind].append(dict(id=data.get('id',str(identifier)), title=title or data.get('title') or data.get('question') or data.get('algorithm') or kind.replace('_',' '), timestamp=data.get('created_at') or data.get('updated_at')))
        # Query all records, not the UI's paginated/capped document listing.
        documents = {}
        with Session(self.engine) as session:
            for kind, Model in self.store.models.items():
                documents[kind] = [json.loads(row.payload) for row in session.scalars(select(Model))]
            for row in session.scalars(select(self.analyst.Run).where(self.analyst.Run.dataset_id == str(identifier))):
                data=json.loads(row.payload); add('saved_questions',data)
                if row.status not in {'succeeded','failed','clarification','cancelled'}: add('active_jobs',data)
            state=session.get(self.knowledge.State,self.knowledge.key(identifier))
            if state:
                settings=json.loads(state.settings_json)
                if settings.get('description'): add('knowledge_entries',{'id':'description','updated_at':state.updated_at},'Dataset description')
                for key,value in settings.get('columns',{}).items():
                    if value: add('knowledge_entries',{'id':'column:'+key,'updated_at':state.updated_at},'Column: '+key)
                for key in settings.get('monetary_columns',{}): add('knowledge_entries',{'id':'money:'+key,'updated_at':state.updated_at},'Currency definition: '+key)
                for metric in settings.get('metrics',[]): add('knowledge_entries',{'id':'metric:'+metric.get('name',''),'updated_at':state.updated_at},'Metric: '+metric.get('name',''))
            for row in session.scalars(select(self.knowledge.Example).where(self.knowledge.Example.dataset_id == str(identifier))):
                add('knowledge_entries',dict(json.loads(row.payload),id=row.id),'Verified SQL example')
        if getattr(self.knowledge, 'review', None):
            review = self.knowledge.review
            for model, label in [(review.Draft, 'Knowledge draft'), (review.Example, 'SQL example review')]:
                for row in review.rows(model, identifier): add('knowledge_entries', row, label)
            if str(identifier) in review.active: add('active_jobs', {'id': 'knowledge-draft'}, 'Knowledge draft request')
        workspace=getattr(getattr(self.analyst,'dashboard_workspace',None),'Model',None)
        if workspace is not None:
            with Session(self.engine) as session:
                for row in session.scalars(select(workspace)):
                    payload=json.loads(row.payload)
                    if payload['chart']['dataset_id']==str(identifier):
                        add('saved_charts',{'id':row.id,'created_at':row.created_at},'Retained dashboard snapshot')
        charts = [d for d in documents['SavedChart'] if d.get('dataset_id') == str(identifier)]
        chart_ids={d['id'] for d in charts}
        for data in charts: add('saved_charts',data)
        for data in documents['Dashboard']:
            if data.get('dataset_id') == str(identifier) or any(w.get('chart_id') in chart_ids for w in data.get('widgets',[])): add('dashboards',data)
        for model, group in [('MLExperiment','experiments'),('MLModel','models'),('MLPrediction','predictions'),('Evaluation','evaluations'),('BenchmarkInstall','benchmark_records')]:
            for data in documents[model]:
                related_prediction = model=='MLPrediction' and data.get('model_id') in {m['id'] for m in documents['MLModel'] if m.get('dataset_id')==str(identifier)}
                if data.get('dataset_id') != str(identifier) and not related_prediction: continue
                add(group,data)
                if model in {'MLExperiment','Evaluation'} and data.get('status') not in {'completed','failed','cancelled','succeeded'}: add('active_jobs',data)
        if self.automl:
            for data in list(self.automl.active_predictions.values()):
                if str(identifier) in data['dataset_ids']: add('active_jobs',data,'Active model prediction')
        if self.knowledge.directory(identifier).exists(): add('rag_indexes',{'id':str(identifier)},'Dataset search index')
        benchmark = bool(groups['benchmark_records'])
        return dict(dataset_id=str(identifier), name=item.display_name or item.name, original_name=item.name,
                    groups=groups, counts={k:len(v) for k,v in groups.items()}, has_dependencies=any(groups.values()),
                    delete_blocked=bool(groups['active_jobs']), benchmark_required=benchmark,
                    benchmark_warning='Evaluation will become unavailable for this controlled benchmark. Restore it or explicitly install a replacement to evaluate.' if benchmark else None)

    def rename(self, identifier, body):
        def work():
            name=body.display_name
            if name is not None:
                if any(unicodedata.category(c).startswith('C') for c in name): raise HTTPException(422,'Display name must not contain control characters.')
                name=name.strip() or None
                if name and len(name)>120: raise HTTPException(422,'Display name must be 1–120 characters.')
            with Session(self.engine) as session:
                item=session.get(self.Dataset,str(identifier))
                if item is None: raise HTTPException(404,'Dataset not found.')
                item.display_name=name;session.commit();session.refresh(item)
                return self.info(item)
        return self.perform('rename',identifier,work)

    def archive(self, identifier, body, restore=False):
        def work():
            with Session(self.engine) as session:
                item=session.get(self.Dataset,str(identifier))
                if item is None: raise HTTPException(404,'Dataset not found.')
                if restore:
                    item.archived_at=None;item.archived_reason=None
                elif not item.archived_at:
                    item.archived_at=utcnow();item.archived_reason=body.reason
                session.commit();session.refresh(item)
                return self.info(item)
        return self.perform('restore' if restore else 'archive',identifier,work)

    def delete(self, identifier, body):
        # Reject active jobs before waiting on their SQL/read locks; recheck under locks below.
        try: preflight=self.dependencies(identifier)
        except HTTPException as exc:
            self.audit("delete",identifier,"blocked",str(exc.detail))
            raise
        if preflight["delete_blocked"]:
            self.audit("delete",identifier,"blocked","Active jobs must stop before deletion.")
            raise HTTPException(409,"Wait for or cancel active Analyst, Evaluation and AutoML jobs before deleting.")
        def work():
            item=self.item(identifier);deps=self.dependencies(identifier)
            if deps['delete_blocked']: raise HTTPException(409,'Wait for or cancel active Analyst, Evaluation and AutoML jobs before deleting.')
            if body is None or body.confirm_name != (item.display_name or item.name): raise HTTPException(422,'Type the exact dataset name to confirm deletion.')
            if deps['has_dependencies'] and not body.acknowledge_dependencies: raise HTTPException(409,'Acknowledge the listed dependencies, or archive this dataset instead.')
            if deps['benchmark_required'] and not body.acknowledge_benchmark: raise HTTPException(409,deps['benchmark_warning'])
            # Delete only live dataset/definitions/index. Historical documents and artifacts remain.
            self.knowledge.purge(identifier)
            with Session(self.engine) as session:
                session.add(self.Reference(id=item.id, original_name=item.name, display_name=item.display_name, deleted_at=utcnow()))
                session.delete(session.get(self.Dataset,item.id));session.commit()
            for key in list(self.analyst.results):
                if self.analyst.load(key)['dataset_id']==item.id: self.analyst.results.pop(key,None)
            (self.root/(item.id+'.duckdb')).unlink(missing_ok=True)
            if hasattr(self, 'revisions'):
                self.revisions.purge(identifier)
        return self.perform('delete',identifier,work)

    def router(self):
        router=APIRouter(prefix='/api/datasets',tags=['Dataset lifecycle'])
        @router.post('/bulk-archive')
        def bulk_archive(body:BulkArchive):
            return self.bulk(body.ids,lambda identifier:self.archive(identifier,Archive()))
        @router.post('/bulk-delete')
        def bulk_delete(body:BulkDelete):
            ids=[str(v.id) for v in body.items]
            if body.confirm_word!='DELETE' or body.confirm_count!=len(ids) or len(set(ids))!=len(ids):
                for identifier in ids:self.audit('delete',identifier,'blocked','Bulk confirmation word/count did not match.')
                raise HTTPException(422,'Type DELETE and confirm the exact unique dataset count.')
            items={str(v.id):v for v in body.items}
            return self.bulk(ids,lambda identifier:self.delete(identifier,items[str(identifier)]))
        @router.get('/{identifier}/dependencies')
        def dependencies(identifier:UUID):return self.dependencies(identifier)
        @router.patch('/{identifier}')
        def rename(identifier:UUID,body:Rename):return self.rename(identifier,body)
        @router.post('/{identifier}/archive')
        def archive(identifier:UUID,body:Archive=Archive()):return self.archive(identifier,body)
        @router.post('/{identifier}/restore')
        def restore(identifier:UUID):return self.archive(identifier,Archive(),True)
        return router

    def bulk(self, ids, action):
        results=[]
        for identifier in ids:
            try: action(identifier);results.append(dict(id=str(identifier),status='success',reason=None))
            except HTTPException as exc: results.append(dict(id=str(identifier),status='blocked' if exc.status_code in {404,409,422} else 'failed',reason=str(exc.detail)))
            except Exception: results.append(dict(id=str(identifier),status='failed',reason='Operation failed. Check local API logs.'))
        return results
