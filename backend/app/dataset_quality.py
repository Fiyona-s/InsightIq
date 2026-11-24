"""Deterministic display-only profile/quality. No model, prompt, or retrieval integration."""
from collections import OrderedDict
from uuid import UUID
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from .type_profile import profile_dataset, q
from .knowledge import KnowledgeSettings

MAX_EXAMPLES = 5
EXAMPLE_LENGTH = 100
CACHE_DATASETS = 64
TYPE_THRESHOLD = 0.8


class Description(BaseModel):
    model_config = ConfigDict(extra='forbid')
    column: str = Field(min_length=1, max_length=128)
    description: str = Field(max_length=500)


class Quality:
    def __init__(self, editor):
        self.editor, self.cache = editor, OrderedDict()

    def invalidate(self, identifier):
        self.cache.pop(str(identifier), None)

    def calculate(self, identifier):
        state, header, rows, _ = self.editor.read(identifier)
        cached = self.cache.get(str(identifier))
        if cached and cached['revision'] == state['version']:
            self.cache.move_to_end(str(identifier))
            return cached
        profile = profile_dataset(self.editor.root / (str(identifier) + '.duckdb'), self.editor.connect)
        result = dict(revision=state['version'], rows=len(rows), columns=[], duplicate_rows=len(rows) - len(set(tuple(r) for r in rows)), empty_columns=[], constant_columns=[], type_issues=[], type_threshold=TYPE_THRESHOLD, example_limit=MAX_EXAMPLES, example_max_chars=EXAMPLE_LENGTH)
        with self.editor.connect(self.editor.root / (str(identifier) + '.duckdb')) as db:
            for index, col in enumerate(profile['columns']):
                values = [r[index] for r in rows if r[index] is not None]
                unique = len(set(values))
                result['columns'].append(dict(name=col['name'], missing=col['missing'], missing_percent=100 * col['missing'] / len(rows) if rows else 0, unique_count=unique))
                if rows and not values:
                    result['empty_columns'].append(col['name'])
                if unique == 1:
                    result['constant_columns'].append(col['name'])
                if not values:
                    continue
                for target in ('DOUBLE', 'DATE'):
                    valid = col['conversions'][target]['valid']
                    if valid / len(values) < TYPE_THRESHOLD or valid == len(values):
                        continue
                    raw = q(col['name'])
                    expr = 'isfinite(TRY_CAST(' + raw + ' AS DOUBLE))' if target == 'DOUBLE' else 'TRY_CAST(' + raw + ' AS DATE) IS NOT NULL'
                    examples = db.execute('SELECT DISTINCT ' + raw + ' FROM records WHERE ' + raw + ' IS NOT NULL AND NOT COALESCE(' + expr + ',false) ORDER BY ' + raw + ' LIMIT 5').fetchall()
                    result['type_issues'].append(dict(column=col['name'], expected='numeric' if target == 'DOUBLE' else 'date', count=len(values)-valid, examples=[v[0][:EXAMPLE_LENGTH] for v in examples]))
                    break
        self.cache[str(identifier)] = result
        self.cache.move_to_end(str(identifier))
        while len(self.cache) > CACHE_DATASETS:
            self.cache.popitem(last=False)
        return result

    def profile(self, identifier):
        item = self.editor.get_item(identifier)
        state, header, rows, _ = self.editor.read(identifier)
        inferred = profile_dataset(self.editor.root / (str(identifier) + '.duckdb'), self.editor.connect)
        # Read the one existing knowledge store without creating or refreshing it on a GET.
        from sqlalchemy.orm import Session
        k = self.editor.knowledge
        with Session(k.engine) as session:
            stored = session.get(k.State, k.key(identifier))
            settings = KnowledgeSettings.model_validate_json(stored.settings_json) if stored else KnowledgeSettings()
        with self.editor.connect(self.editor.root / (str(identifier) + '.duckdb')) as db:
            nullable = {row[0]: row[2] == 'YES' for row in db.execute('DESCRIBE records').fetchall()}
        columns = []
        for index, col in enumerate(inferred['columns']):
            values = [r[index] for r in rows if r[index] is not None]
            samples = list(dict.fromkeys(values))[:3]
            columns.append(dict(name=col['name'], inferred_type=col['suggested_type'], storage_type=col['storage_type'], missing=col['missing'], nullable=nullable[col['name']], unique_count=len(set(values)), samples=[v[:100] for v in samples], description=settings.columns.get(col['name'], '')))
        return dict(revision=state['version'], original_filename=item.name, rows=len(rows), column_count=len(header), columns=columns)

    def describe(self, identifier, body):
        item = self.editor.get_item(identifier)
        if item.archived_at:
            raise HTTPException(409, 'Archived datasets are view only.')
        k = self.editor.knowledge
        info = k.settings(identifier)
        settings = KnowledgeSettings.model_validate(info['settings'])
        if body.column not in info['columns']:
            raise HTTPException(422, 'Choose an existing column.')
        settings.columns[body.column] = body.description
        updated = k.update_settings(identifier, settings)
        return dict(column=body.column, description=updated['settings']['columns'].get(body.column, ''))

    def router(self):
        router = APIRouter(prefix='/api/datasets', tags=['Dataset profile and quality'])
        @router.get('/{identifier}/quality')
        def quality(identifier: UUID):
            with self.editor.knowledge.lock:
                return self.calculate(identifier)
        @router.get('/{identifier}/profile-details')
        def profile(identifier: UUID):
            with self.editor.knowledge.lock:
                return self.profile(identifier)
        @router.patch('/{identifier}/column-description')
        def description(identifier: UUID, body: Description):
            with self.editor.knowledge.lock:
                return self.describe(identifier, body)
        return router
