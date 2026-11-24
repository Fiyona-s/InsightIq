"""Calculations over returned rows only; no causal interpretation or model arithmetic."""
from decimal import Decimal, InvalidOperation, localcontext
from datetime import datetime
from .charts import is_numeric
from .knowledge import digest


def decimal_value(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        value = Decimal(str(value))
        return value if value.is_finite() else None
    except InvalidOperation:
        return None


def fmt(value):
    if isinstance(value, Decimal):
        with localcontext() as context:
            context.prec = 12 if value.as_tuple().exponent < 0 else 400
            rounded = +value
            return format(rounded, '.12g') if rounded.adjusted() < -8 or rounded.adjusted() > 15 else format(rounded.normalize(), 'f')
    return str(value)


def compute_evidence(result):
    signature = digest({'columns': result['columns'], 'rows': result['rows']})
    facts = []
    def add(method, value, statement, columns, rows, formula):
        if method in {'total', 'average', 'minimum', 'maximum', 'top_n', 'period_change'}:
            from .currency import format_money
            monetary = next((result['columns'][c].get('money') for c in columns if result['columns'][c].get('money')), None)
            if monetary:
                statement = statement.replace('= ' + fmt(value), '= ' + format_money(value, monetary), 1)
        fact = {'id': 'f' + str(len(facts) + 1), 'method': method, 'value': fmt(value), 'statement': statement,
                'source': {'result_digest': signature, 'columns': columns, 'rows': rows, 'formula': formula,
                           'scope': 'complete returned query rows; not necessarily the entire dataset'}}
        facts.append(fact)
    with localcontext() as ctx:
        ctx.prec = 400
        add('row_count', len(result['rows']), f'The query returned {len(result["rows"])} rows.', [], [], 'len(returned rows)')
        numeric = [i for i, c in enumerate(result['columns']) if is_numeric(c)][:8]
        label = next((i for i, c in enumerate(result['columns']) if not is_numeric(c)), None)
        temporal = next((i for i, c in enumerate(result['columns']) if c['type'].startswith(('DATE', 'TIMESTAMP'))), None)
        for col in numeric:
            name = result['columns'][col]['name']
            values = [(i, decimal_value(row[col])) for i, row in enumerate(result['rows'])]
            values = [(i, value) for i, value in values if value is not None]
            if not values:
                continue
            ids = [i for i, _ in values]
            nums = [v for _, v in values]
            total = sum(nums)
            for method, value, formula in [('total', total, 'sum(non-null finite values)'), ('average', total / len(nums), 'sum / count(non-null finite values)'), ('minimum', min(nums), 'min(non-null finite values)'), ('maximum', max(nums), 'max(non-null finite values)')]:
                add(method, value, f'{name}: {method} = {fmt(value)} across {len(nums)} finite values; {len(result["rows"]) - len(nums)} missing/nonfinite values excluded.', [col], ids, formula)
            top = sorted(values, key=lambda pair: pair[1], reverse=True)[:3]
            for rank, (row, value) in enumerate(top, 1):
                suffix = ' (' + str(result['rows'][row][label])[:100] + ')' if label is not None else ''
                add('top_n', value, f'{name}: rank {rank} returned row {row + 1}{suffix} = {fmt(value)}.', [col] + ([label] if label is not None else []), [row], 'descending value; ties retain returned order')
                if total > 0 and all(v >= 0 for v in nums):
                    share = value / total * 100
                    add('share_percent', share, f'{name}: returned row {row + 1} contributes {fmt(share)}% of the nonnegative returned total {fmt(total)}.', [col], ids, f'row[{row}][{col}] / sum(non-null finite values) * 100')
            if temporal is not None and len(values) == len(result['rows']) and 2 <= len(values) <= 500:
                try:
                    periods = sorted((datetime.fromisoformat(str(result['rows'][i][temporal]).replace('Z', '+00:00')), i, v) for i, v in values)
                    dates = [p[0] for p in periods]
                    gaps = [(b-a).total_seconds() for a, b in zip(dates, dates[1:])]
                    monthly = all(b.year * 12 + b.month == a.year * 12 + a.month + 1 and a.day == b.day == 1 and a.time() == b.time() for a, b in zip(dates, dates[1:]))
                    regular = all(g == gaps[0] and g > 0 for g in gaps) or monthly
                    if regular:
                        previous, current = periods[-2], periods[-1]
                        change = current[2] - previous[2]
                        add('period_change', change, f'{name}: change from {previous[0].isoformat()} to {current[0].isoformat()} = {fmt(change)}.', [temporal, col], [previous[1], current[1]], 'latest value - previous value; equally spaced observed periods')
                        if previous[2] > 0:
                            pct = change / previous[2] * 100
                            add('period_change_percent', pct, f'{name}: latest observed period changed by {fmt(pct)}% from the previous positive value.', [temporal, col], [previous[1], current[1]], '(latest - previous) / previous * 100')
                        diffs = [b[2] - a[2] for a, b in zip(periods, periods[1:])]
                        trend = 'unchanged' if all(d == 0 for d in diffs) else 'nondecreasing' if all(d >= 0 for d in diffs) else 'nonincreasing' if all(d <= 0 for d in diffs) else 'fluctuating'
                        add('trend', trend, f'{name}: {trend} across {len(periods)} regularly spaced observed periods. This describes returned values, with no causal or forecast claim.', [temporal, col], [p[1] for p in periods], 'sign of consecutive differences in chronological order')
                except (ValueError, TypeError, OverflowError):
                    pass
    return {'result_digest': signature, 'facts': facts, 'coverage': 'Statistics cover up to the first 8 numeric result columns. Displayed decimal calculations are rounded to 12 significant digits where needed; source results remain exact.'}


def ground_narrative(selection, evidence):
    ids = selection.get('fact_ids') if isinstance(selection, dict) else None
    known = {f['id']: f for f in evidence['facts']}
    if not isinstance(ids, list) or not 1 <= len(ids) <= 6 or any(not isinstance(i, str) or i not in known for i in ids) or len(set(ids)) != len(ids) or set(selection) != {'fact_ids'}:
        raise ValueError('Narrative must select 1–6 unique computed fact IDs only.')
    return [{'fact_id': i, 'text': known[i]['statement']} for i in ids]


from typing import List, Optional
from pydantic import BaseModel
from .charts import ChartOptions


class FactSource(BaseModel):
    result_digest: str
    columns: List[int]
    rows: List[int]
    formula: str
    scope: str


class EvidenceFact(BaseModel):
    id: str
    method: str
    value: str
    statement: str
    source: FactSource


class Evidence(BaseModel):
    result_digest: str
    facts: List[EvidenceFact]
    coverage: str


class NarrativeStatement(BaseModel):
    fact_id: str
    text: str


class Analysis(BaseModel):
    charts: ChartOptions
    evidence: Evidence
    narrative: List[NarrativeStatement]
    narrative_source: str
    warning: Optional[str]
