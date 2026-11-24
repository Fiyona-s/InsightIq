"""Dataset-scoped metadata RAG with fingerprinted FAISS snapshots and provenance."""
import copy
import hashlib
import json
import os
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Literal, Optional
from uuid import UUID, uuid4

# FAISS 1.10 ARM feature detection imports removed numpy.distutils on Python 3.12.
# Use the portable CPU kernel; these indexes contain at most 256 documents.
os.environ.setdefault('FAISS_OPT_LEVEL', 'generic')
import faiss
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, String, Text, select, delete
from sqlalchemy.orm import Session

from .embeddings import EmbeddingUnavailable, SentenceEmbedder
from .sql_guard import validate_sql, GuardError
from .type_profile import profile_dataset, q
from .execution import execute_isolated, ExecutionError


def stamp():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=True))
    os.chmod(temporary, 0o600)
    temporary.replace(path)


from .currency import Money


class MetricDefinition(BaseModel):
    money: Optional[Money] = None
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=800)
    sql: str = Field(min_length=1, max_length=2000)


class KnowledgeSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    monetary_columns: Dict[str, Money] = Field(default_factory=dict, max_length=100)
    # Legacy field kept so older stored settings still load; nothing sets it any more (2026-11-20).
    default_currency_columns: List[str] = Field(default_factory=list, max_length=100)
    # Owner-confirmed units (2026-11-20): a column is shown as a percentage only after the owner says so.
    percent_columns: List[str] = Field(default_factory=list, max_length=100)
    # True once the owner has confirmed what each numeric column is (Money / Percentage / Neither).
    units_confirmed: bool = False
    description: str = Field(default='', max_length=1000)
    columns: Dict[str, str] = Field(default_factory=dict, max_length=100)
    metrics: List[MetricDefinition] = Field(default_factory=list, max_length=20)


def without_unconfirmed_guesses(settings):
    """Read-time rule (decision 2026-11-20): a money mark the name-based default build stored at upload
    (listed in `default_currency_columns`) was never confirmed by the owner, so it is not used until the owner
    confirms units. Stored rows are NOT rewritten (Rule 6); hand-confirmed currencies are untouched."""
    if settings.units_confirmed or not settings.default_currency_columns:
        return settings
    guessed = set(settings.default_currency_columns)
    return settings.model_copy(update={'monetary_columns': {k: v for k, v in settings.monetary_columns.items() if k not in guessed},
                                       'default_currency_columns': []})


class RetrievalRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    question: str = Field(min_length=1, max_length=2000)
    type_mapping: Dict[str, str] = Field(default_factory=dict, max_length=100)
    top_k: int = Field(default=6, ge=1, le=10)


class ExampleRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    run_id: UUID
    expected_result_digest: str = Field(pattern=r'^[0-9a-f]{64}$')


class RetrievedDocument(BaseModel):
    id: str
    kind: str
    title: str
    text: str
    workspace_id: str
    dataset_id: str
    fingerprint: str
    provenance: dict
    score: float
    reason: str


class RetrievalResult(BaseModel):
    status: Literal['ready', 'unavailable']
    workspace_id: str
    dataset_id: str
    fingerprint: str
    embedding_model: str
    documents: List[RetrievedDocument]
    warning: Optional[str] = None
    rebuilt: bool = False


class KnowledgeInfo(BaseModel):
    workspace_id: str
    dataset_id: str
    settings: KnowledgeSettings
    columns: List[str]
    schema_signature: str
    updated_at: str
    verified_examples: int
    embedding_model: str


class VerificationInfo(BaseModel):
    status: Literal['execution_verified']
    semantic_verification: Literal['not certified']
    result_digest: str


def make_knowledge_models(base):
    class KnowledgeState(base):
        __tablename__ = 'knowledge_state'
        key = Column(String(64), primary_key=True)
        workspace_id = Column(String(36), nullable=False)
        dataset_id = Column(String(36), nullable=False, index=True)
        settings_json = Column(Text, nullable=False)
        schema_signature = Column(String(64), nullable=False)
        updated_at = Column(String(40), nullable=False)
    class VerifiedExample(base):
        __tablename__ = 'knowledge_examples'
        id = Column(String(36), primary_key=True)
        workspace_id = Column(String(36), nullable=False)
        dataset_id = Column(String(36), nullable=False, index=True)
        payload = Column(Text, nullable=False)
    return KnowledgeState, VerifiedExample


class KnowledgeService:
    def __init__(self, root, engine, state_model, example_model, dataset_model, get_item, connector, embedder=None):
        self.root, self.engine = root, engine
        self.State, self.Example, self.Dataset = state_model, example_model, dataset_model
        self.get_item, self.connector = get_item, connector
        self.embedder = embedder or SentenceEmbedder(Path(os.getenv('EMBEDDING_MODEL_PATH', str(root / 'models' / 'all-MiniLM-L6-v2'))))
        self.lock = threading.RLock()
        self.workspace_id = ''
        self.analyst = None

    def start(self):
        identity = self.root / 'workspace.json'
        if not identity.exists():
            atomic_json(identity, {'id': str(uuid4())})
        self.workspace_id = str(UUID(json.loads(identity.read_text())['id']))

    def key(self, dataset_id):
        return digest([self.workspace_id, str(UUID(str(dataset_id)))])

    def directory(self, dataset_id):
        return self.root / 'knowledge' / self.key(dataset_id)

    def _file_key(self, dataset_id):
        """What the dataset file looks like right now (size and modification time of the file and its write-ahead log)."""
        path = self.root / (str(dataset_id) + '.duckdb')
        parts = []
        for candidate in (path, path.with_name(path.name + '.wal')):
            try:
                stat = candidate.stat()
                parts.append((stat.st_size, stat.st_mtime_ns))
            except OSError:
                parts.append(None)
        return tuple(parts)

    def profile(self, dataset_id):
        self.get_item(dataset_id)  # authorization belongs to this server-owned workspace
        # The full-column profile and the file hash scan the whole dataset (seconds on a big file) and only change when the file does,
        # so they are kept per file state instead of being recomputed for every question.
        key, cache = self._file_key(dataset_id), self.__dict__.setdefault('_profile_cache', {})
        cached = cache.get(str(dataset_id))
        if cached is not None and cached[0] == key:
            return copy.deepcopy(cached[1])
        profile = profile_dataset(self.root / (str(dataset_id) + '.duckdb'), self.connector)
        profile['data_revision'] = hashlib.sha256((self.root / (str(dataset_id) + '.duckdb')).read_bytes()).hexdigest()
        if self._file_key(dataset_id) == key:                        # only remember it if nothing changed while it was computed
            cache[str(dataset_id)] = (key, copy.deepcopy(profile))
        return profile

    @staticmethod
    def signature(profile):
        return digest({'rows': profile['rows'], 'columns': profile['columns'], 'revision': profile.get('data_revision')})

    def sync(self, dataset_id, profile=None):
        """Synchronize authoritative schema; embedding/index generation remains lazy."""
        item = self.get_item(dataset_id)
        profile = self.profile(dataset_id) if profile is None else dict(profile)
        if 'data_revision' not in profile:
            profile['data_revision'] = hashlib.sha256((self.root / (str(dataset_id) + '.duckdb')).read_bytes()).hexdigest()
        signature = self.signature(profile)
        with self.lock, Session(self.engine) as session:
            state = session.get(self.State, self.key(dataset_id))
            if state is None:
                state = self.State(key=self.key(dataset_id), workspace_id=self.workspace_id, dataset_id=str(dataset_id),
                                   settings_json=KnowledgeSettings().model_dump_json(), schema_signature=signature, updated_at=stamp())
                session.add(state)
            elif state.schema_signature != signature:
                state.schema_signature, state.updated_at = signature, stamp()
            # Refresh the existing catalog if a trusted admin has changed physical schema.
            record = session.get(self.Dataset, str(dataset_id))
            record.rows = profile['rows']
            record.schema_json = json.dumps([{'name': c['name'], 'type': c['storage_type'], 'null_count': c['missing']} for c in profile['columns']])
            session.commit()
            settings = without_unconfirmed_guesses(KnowledgeSettings.model_validate_json(state.settings_json))
            updated = state.updated_at
        return item, profile, signature, settings, updated

    def documents(self, dataset_id, mapping=None, profile=None):
        mapping = mapping or {}
        item, profile, signature, settings, updated = self.sync(dataset_id, profile)
        schema = {c['name']: mapping.get(c['name'], 'VARCHAR') for c in profile['columns']}
        from .sql_guard import TYPES
        if set(mapping) - set(schema) or any(t not in TYPES for t in mapping.values()):
            raise HTTPException(422, 'Knowledge mapping must use actual columns and supported scalar types.')
        if self.analyst and getattr(self.analyst,'store',None):
            Model=self.analyst.store.models['BenchmarkInstall']
            with Session(self.engine) as session:
                if session.scalar(select(Model.id).where(Model.dataset_id==str(dataset_id)).limit(1)):
                    return [],digest(['benchmark-context-excluded',signature]),schema
        mapping_hash = digest(schema)
        documents = []
        def add(kind, title, text, provenance):
            documents.append({'id': digest([self.workspace_id, str(dataset_id), kind, title, text])[:24], 'kind': kind,
                              'title': title, 'text': text[:3000], 'workspace_id': self.workspace_id,
                              'dataset_id': str(dataset_id), 'provenance': provenance})
        add('dataset', item.name, f'Dataset {item.name}. Authorized SQL relation: data. {profile["rows"]} rows. '
            + (settings.description or 'No business description supplied.'),
            {'source': 'catalog + user definition', 'updated_at': updated, 'schema_signature': signature})
        for column in profile['columns']:
            name = column['name']; typ = schema[name]
            description = settings.columns.get(name, '')
            failed = 0 if typ == 'VARCHAR' else column['conversions'][typ]['failed']
            add('column', name, f'Column "{name}" on data; SQL type {typ}; raw storage {column["storage_type"]}; '
                f'{column["missing"]} missing values; {failed} failed confirmed conversions. '
                f'Inferred type candidate: {column["suggested_type"]}, not a business meaning. '
                + (description or 'No user-authored description.'),
                {'source': 'DuckDB DESCRIBE + full-column profile', 'column': name, 'schema_signature': signature,
                 'mapping_signature': mapping_hash, 'description_source': 'user' if description else 'none'})
        # Naming-based relationships are candidates, never invented foreign keys.
        names = list(schema)
        for name in names:
            if name.casefold().endswith('_id'):
                label = next((n for n in names if n.casefold() == name[:-3].casefold() + '_name'), None)
                if label:
                    add('relationship', name + ' → ' + label, f'Unconfirmed identifier/label candidate: {name} and {label} share a name prefix in data. No foreign key or cross-dataset join is established.',
                        {'source': 'schema naming convention', 'confirmed': False, 'columns': [name, label]})
        for metric in settings.metrics:
            # Do not retain stale definitions after a schema change.
            try:
                validate_sql(metric.sql, schema)
            except GuardError:
                continue
            add('metric', metric.name, metric.description + '\nUser-defined metric SQL (untrusted reference): ' + metric.sql,
                {'source': 'explicit user metric definition', 'updated_at': updated, 'semantic_verification': 'user-defined, not independently certified'})
        if getattr(self, 'review', None):
            for example in self.review.trusted(dataset_id):
                add('example', example['question'], example['question'] + '\nReference-checked example SQL: ' + example['sql'],
                    {'source': 'explicit approval + independent reference', 'revision': example['revision'],
                     'reference_type': example['reference_type'], 'approved_at': example['approved_at'],
                     'semantic_verification': 'agreement with reference, not general correctness'})
        # Existing replay-only examples are retained for provenance, but Phase 2
        # has no independent approval/reference-check workflow. They cannot enter
        # retrieval until that review mechanism is implemented in Phase 5.
        if len(documents) > 256:
            raise HTTPException(422, 'Dataset knowledge exceeds the 256-document budget.')
        fingerprint = digest({'schema': signature, 'mapping': mapping_hash, 'docs': documents, 'embedder': self.embedder.identity})
        for doc in documents:
            doc['fingerprint'] = fingerprint
        return documents, fingerprint, schema

    def retrieve(self, dataset_id, question, mapping=None, top_k=6, profile=None):
        self.get_item(dataset_id)
        if not question.strip() or not 1 <= top_k <= 10:
            raise HTTPException(422, 'A nonempty question and top-k between 1 and 10 are required.')
        with self.lock:
            docs, fingerprint, _ = self.documents(dataset_id, mapping, profile)
            output = dict(status='ready', workspace_id=self.workspace_id, dataset_id=str(dataset_id), fingerprint=fingerprint,
                          embedding_model=self.embedder.identity, documents=[], warning=None, rebuilt=False)
            if not docs:
                output.update(status='unavailable',warning='No eligible retrieval documents. Benchmark material is excluded.')
                return output
            folder = self.directory(dataset_id)
            index_path = folder / (fingerprint + '.faiss')
            manifest_path = folder / (fingerprint + '.json')
            try:
                index = None
                if index_path.exists() and manifest_path.exists():
                    try:
                        if index_path.stat().st_size > 8 * 1024 * 1024 or manifest_path.stat().st_size > 2 * 1024 * 1024:
                            raise ValueError('oversized index')
                        manifest = json.loads(manifest_path.read_text())
                        raw = index_path.read_bytes()
                        if manifest['fingerprint'] != fingerprint or manifest['sha256'] != hashlib.sha256(raw).hexdigest() or manifest['documents'] != docs:
                            raise ValueError('stale index')
                        index = faiss.deserialize_index(np.frombuffer(raw, dtype='uint8'))
                        if index.ntotal != len(docs) or index.d != manifest['dimension']:
                            raise ValueError('inconsistent index')
                    except (ValueError, KeyError, RuntimeError, OSError):
                        index = None
                if index is None:
                    vectors = self._vectors([d['text'] for d in docs])
                    index = faiss.IndexFlatIP(vectors.shape[1]); index.add(vectors)
                    raw = faiss.serialize_index(index).tobytes()
                    folder.mkdir(parents=True, exist_ok=True)
                    temporary = index_path.with_name(index_path.name + '.' + uuid4().hex + '.tmp')
                    temporary.write_bytes(raw); os.chmod(temporary, 0o600); temporary.replace(index_path)
                    atomic_json(manifest_path, {'fingerprint': fingerprint, 'dimension': index.d,
                                               'sha256': hashlib.sha256(raw).hexdigest(), 'documents': docs})
                    output['rebuilt'] = True
                    # Keep three mapping/schema snapshots per dataset; running requests hold copies.
                    manifests = sorted(folder.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
                    for old in manifests[3:]:
                        old.with_suffix('.faiss').unlink(missing_ok=True); old.unlink(missing_ok=True)
                query = self._vectors([question])
                if query.shape[1] != index.d:
                    raise EmbeddingUnavailable('Embedding dimensions changed. Re-provision the configured model and rebuild knowledge.')
                scores, indexes = index.search(query, min(top_k, len(docs)))
                output['documents'] = [{**docs[int(i)], 'score': float(max(-1, min(1, score))),
                    'reason': f'Rank {rank + 1} by normalized embedding cosine similarity within the selected dataset; {docs[int(i)]["kind"]} context.'}
                    for rank, (i, score) in enumerate(zip(indexes[0], scores[0])) if i >= 0]
            except EmbeddingUnavailable as exc:
                output.update(status='unavailable', warning=str(exc), documents=[])
            return output

    def _vectors(self, texts):
        values = np.asarray(self.embedder.encode(texts), dtype='float32')
        if values.ndim != 2 or values.shape[0] != len(texts) or not 1 <= values.shape[1] <= 2048 or not np.isfinite(values).all():
            raise EmbeddingUnavailable('Embedding provider returned invalid vectors.')
        norms = np.linalg.norm(values, axis=1, keepdims=True)
        if (norms < 1e-8).any():
            raise EmbeddingUnavailable('Embedding provider returned an empty vector.')
        return np.ascontiguousarray(values / norms)

    def settings(self, dataset_id):
        _, profile, signature, settings, updated = self.sync(dataset_id)
        count = len(self.review.trusted(dataset_id)) if getattr(self, 'review', None) else 0
        return {'workspace_id': self.workspace_id, 'dataset_id': str(dataset_id), 'settings': settings.model_dump(),
                'columns': [c['name'] for c in profile['columns']], 'schema_signature': signature, 'updated_at': updated,
                'verified_examples': count, 'embedding_model': self.embedder.identity}

    def update_settings(self, dataset_id, settings):
        # Lifecycle archive/delete takes this same lock; check and save together.
        with self.lock:
            return self._update_settings(dataset_id, settings)

    def _update_settings(self, dataset_id, settings):
        if getattr(self.get_item(dataset_id), 'archived_at', None):
            raise HTTPException(409, 'Archived dataset knowledge is read-only.')
        _, profile, _, _, _ = self.sync(dataset_id)
        schema = {c['name']: 'VARCHAR' for c in profile['columns']}
        if set(settings.monetary_columns) - set(schema):
            raise HTTPException(422, "Monetary metadata must name actual dataset columns.")
        if set(settings.percent_columns) - set(schema):
            raise HTTPException(422, 'Percentage columns must name actual dataset columns.')
        if set(settings.percent_columns) & set(settings.monetary_columns):
            raise HTTPException(422, 'A column cannot be both money and a percentage.')
        if set(settings.columns) - set(schema) or any(len(v) > 500 for v in settings.columns.values()):
            raise HTTPException(422, 'Column descriptions must name actual columns and contain at most 500 characters.')
        if len({m.name.casefold() for m in settings.metrics}) != len(settings.metrics):
            raise HTTPException(422, 'Metric names must be unique.')
        for metric in settings.metrics:
            try:
                validate_sql(metric.sql, schema)
            except GuardError as exc:
                raise HTTPException(422, 'Metric SQL is invalid: ' + str(exc)) from exc
        with self.lock, Session(self.engine) as session:
            state = session.get(self.State, self.key(dataset_id))
            state.settings_json, state.updated_at = settings.model_dump_json(), stamp()
            session.commit()
        return self.settings(dataset_id)

    def verify_example(self, dataset_id, request):
        raise HTTPException(409, 'Trusted example promotion requires explicit approval and an independent reference check. Use the candidate reference-check workflow; replay alone is insufficient.')

    def purge(self, dataset_id):
        with self.lock, Session(self.engine) as session:
            session.execute(delete(self.Example).where(self.Example.workspace_id == self.workspace_id, self.Example.dataset_id == str(dataset_id)))
            if getattr(self, 'review', None):
                for model in (self.review.Draft, self.review.Example):
                    session.execute(delete(model).where(model.dataset_id == str(dataset_id)))
            session.execute(delete(self.State).where(self.State.key == self.key(dataset_id)))
            session.commit()
            folder = self.directory(dataset_id)
            if folder.exists():
                shutil.rmtree(folder)

    def router(self):
        router = APIRouter(prefix='/api/datasets', tags=['Knowledge'])
        @router.get('/{dataset_id}/knowledge', response_model=KnowledgeInfo)
        def settings(dataset_id: UUID): return self.settings(dataset_id)
        @router.put('/{dataset_id}/knowledge', response_model=KnowledgeInfo)
        def update_settings(dataset_id: UUID, body: KnowledgeSettings): return self.update_settings(dataset_id, body)
        @router.post('/{dataset_id}/knowledge/retrieve', response_model=RetrievalResult)
        def retrieve(dataset_id: UUID, body: RetrievalRequest): return self.retrieve(dataset_id, body.question, body.type_mapping, body.top_k)
        @router.post('/{dataset_id}/knowledge/reindex', response_model=RetrievalResult)
        def reindex(dataset_id: UUID, body: RetrievalRequest):
            # Fingerprints detect changed physical schema, mapping, definitions or examples.
            return self.retrieve(dataset_id, body.question, body.type_mapping, body.top_k)
        @router.post('/{dataset_id}/knowledge/examples', response_model=VerificationInfo)
        def example(dataset_id: UUID, body: ExampleRequest): return self.verify_example(dataset_id, body)
        return router
