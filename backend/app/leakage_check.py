"""Read-only data-leakage warning for Predictions (approved exception 3c: WARNING ONLY).

Looks at the rows of a dataset and names predictor columns that may give away the answer (a possibility, never a finding).
It never trains, never writes, never calls AI and never imports or edits the protected `automl` package:
training, the registry and reported metrics are not affected, and nothing is blocked. The rules and
thresholds are documented in docs/LEAKAGE_WARNING.md; the constants below are the single source.

A. a single predictor value that always means one outcome;
B. a predictor that nearly decides the target (most common target value per predictor value covers 98% of rows);
C. a numeric predictor that is almost a copy of a numeric target (|Pearson r| >= 0.98, or equal in every row).
"""
import math
import re
from collections import Counter, defaultdict
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

MAX_ROWS = 5000                 # the same ceiling as local training
RULE_A_MIN_ROWS = 10            # a value must occur in at least this many rows ...
RULE_A_MIN_SHARE = 0.02         # ... and in at least this share of all rows
RULE_B_COVERAGE = 0.98          # share of rows whose target equals the most common target of their predictor value
RULE_B_MAX_DISTINCT_SHARE = 0.20  # a predictor with more distinct values than this share of rows is an identifier, not a rule
FEW_TARGET_VALUES = 50          # rules A and B apply to targets with at most this many distinct values
RULE_C_CORRELATION = 0.98
MIN_PAIRS = 10
EMPTY = '(empty)'
NUMBER = re.compile(r'^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$')


def _missing(v):
    return v is None or (isinstance(v, str) and not v.strip())


def _num(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    s = str(v).strip().replace(',', '')
    return float(s) if NUMBER.match(s) else None


def _label(v):
    return EMPTY if _missing(v) else str(v).strip()


def _pearson(pairs):
    n = len(pairs)
    mx = sum(a for a, _ in pairs) / n
    my = sum(b for _, b in pairs) / n
    sx = math.sqrt(sum((a - mx) ** 2 for a, _ in pairs))
    sy = math.sqrt(sum((b - my) ** 2 for _, b in pairs))
    if sx == 0 or sy == 0:
        return None
    return sum((a - mx) * (b - my) for a, b in pairs) / (sx * sy)


def check(header, rows, task, target, features):
    """Findings for the chosen predictors. Pure function of the rows; no side effects."""
    if task not in {'classification', 'regression'} or target not in header:
        return []
    rows = rows[:MAX_ROWS]
    t = header.index(target)
    answered = [r for r in rows if not _missing(r[t])]
    n = len(answered)
    if n < MIN_PAIRS:
        return []
    outcomes = Counter(_label(r[t]) for r in answered)
    few_outcomes = len(outcomes) <= FEW_TARGET_VALUES
    majority = outcomes.most_common(1)[0][0]
    target_numbers = [_num(r[t]) for r in answered]
    numeric_target = all(x is not None for x in target_numbers)
    findings = []
    for name in features:
        if name == target or name not in header:
            continue
        j = header.index(name)
        found = None
        values = [_label(r[j]) for r in answered]
        groups = defaultdict(Counter)
        for v, r in zip(values, answered):
            groups[v][_label(r[t])] += 1
        if few_outcomes and len(outcomes) > 1:
            # A. one predictor value that always means one outcome (and that outcome is not simply the usual one).
            best = None
            for v, c in groups.items():
                size = sum(c.values())
                if size >= RULE_A_MIN_ROWS and size >= RULE_A_MIN_SHARE * n and len(c) == 1:
                    outcome = next(iter(c))
                    if outcome != majority and (best is None or size > best[2]):
                        best = (v, outcome, size)
            if best:
                v, outcome, size = best
                found = {'rule': 'A', 'sentence': f'When {name} is {v}, {target} is always {outcome} ({size} of {size} rows).',
                         'evidence': {'value': v, 'outcome': outcome, 'rows': size}}
            # B. the predictor nearly decides the target.
            if not found and len(groups) <= RULE_B_MAX_DISTINCT_SHARE * n:
                covered = sum(max(c.values()) for c in groups.values())
                if covered / n >= RULE_B_COVERAGE and outcomes[majority] / n < RULE_B_COVERAGE:
                    found = {'rule': 'B', 'sentence': f'Knowing {name} tells you {target} in {round(100 * covered / n)}% of rows.',
                             'evidence': {'coverage': round(covered / n, 4), 'rows': n}}
        # C. a numeric predictor that is almost a copy of a numeric target.
        if not found and numeric_target:
            pairs = [(_num(r[j]), y) for r, y in zip(answered, target_numbers) if _num(r[j]) is not None]
            if len(pairs) >= MIN_PAIRS and len(pairs) >= 0.95 * n:
                if all(a == b for a, b in pairs):
                    found = {'rule': 'C', 'sentence': f'{name} is the same as {target} in every row.', 'evidence': {'correlation': 1.0, 'rows': len(pairs)}}
                else:
                    r = _pearson(pairs)
                    if r is not None and abs(r) >= RULE_C_CORRELATION:
                        found = {'rule': 'C', 'sentence': f'{name} moves with {target} almost exactly (correlation {abs(r):.2f}).',
                                 'evidence': {'correlation': round(abs(r), 4), 'rows': len(pairs)}}
        if found:
            findings.append({'column': name, **found})
    return findings


class LeakageRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    task: str = Field(max_length=40)
    target: str = Field(min_length=1, max_length=128)
    features: list[str] = Field(default_factory=list, max_length=100)


class LeakageCheck:
    def __init__(self, editor):
        self.editor = editor

    def run(self, identifier, body):
        with self.editor.knowledge.lock:
            _, header, rows, _ = self.editor.read(identifier)
        if body.task in {'classification', 'regression'} and body.target not in header:
            raise HTTPException(422, 'Choose an existing target column.')
        findings = check(header, rows, body.task, body.target, body.features)
        return {'dataset_id': str(identifier), 'rows_checked': min(len(rows), MAX_ROWS), 'findings': findings,
                'thresholds': {'rule_a_min_rows': RULE_A_MIN_ROWS, 'rule_a_min_share': RULE_A_MIN_SHARE, 'rule_b_coverage': RULE_B_COVERAGE,
                               'rule_b_max_distinct_share': RULE_B_MAX_DISTINCT_SHARE, 'rule_c_correlation': RULE_C_CORRELATION}}

    def router(self):
        router = APIRouter(prefix='/api/datasets', tags=['Predictions leakage warning'])

        @router.post('/{identifier}/leakage-check')
        def leakage(identifier: UUID, body: LeakageRequest):
            return self.run(identifier, body)
        return router
