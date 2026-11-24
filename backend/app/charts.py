"""Deterministic chart contracts; values always refer to complete cached SQL rows."""
import math
from datetime import datetime, timezone
from typing import Literal, Optional, Union
from pydantic import BaseModel, ConfigDict, Field


class ChartSpec(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    kind: Literal['bar', 'line', 'donut', 'scatter', 'kpi', 'table']
    x: Optional[int] = Field(default=None, ge=0)
    y: Optional[int] = Field(default=None, ge=0)
    title: str = Field(default='Query results', min_length=1, max_length=120)
    null_policy: Literal['omit_with_count'] = 'omit_with_count'
    zero_baseline: Literal[True] = True


def is_numeric(column):
    return column['type'].split('(')[0] in {'TINYINT', 'SMALLINT', 'INTEGER', 'BIGINT', 'HUGEINT', 'UTINYINT', 'USMALLINT', 'UINTEGER', 'UBIGINT', 'UHUGEINT', 'FLOAT', 'DOUBLE', 'DECIMAL'}


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
        if not math.isfinite(result) or abs(result) > 2**53 - 1:
            return None
        return result
    except (ValueError, TypeError, OverflowError):
        return None


def time_value(value):
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return dt.replace(tzinfo=dt.tzinfo or timezone.utc).timestamp() * 1000
    except (ValueError, OverflowError):
        return None


def validate_chart(spec, result):
    spec = ChartSpec.model_validate(spec)
    columns, rows = result['columns'], result['rows']
    if spec.kind == 'table':
        if spec.x is not None or spec.y is not None:
            raise ValueError('Tables do not use chart axes.')
        return {'spec': spec.model_dump(), 'points': [], 'omitted_rows': 0, 'note': 'Complete values are available in the results table.'}
    if not rows:
        raise ValueError('Empty results have no chartable values.')
    if spec.y is None or spec.y >= len(columns) or not is_numeric(columns[spec.y]):
        raise ValueError('The value axis must select an actual numeric result column.')
    numeric_axes = [spec.y] + ([spec.x] if spec.kind == 'scatter' and spec.x is not None and spec.x < len(columns) else [])
    for axis in numeric_axes:
        if any(row[axis] is not None and number(row[axis]) is None and str(row[axis]).casefold() not in {'nan', 'inf', '-inf', 'infinity', '-infinity'} for row in rows):
            raise ValueError('Numeric precision is unsafe for a chart; use the exact result table.')
    if spec.kind == 'kpi':
        if len(rows) != 1 or spec.x is not None or number(rows[0][spec.y]) is None:
            raise ValueError('KPI requires one row with a finite, safely representable numeric value.')
        return {'money': columns[spec.y].get('money'), 'percent': True if columns[spec.y].get('percent') else None, 'spec': spec.model_dump(), 'points': [{'row': 0, 'value': rows[0][spec.y]}], 'omitted_rows': 0, 'note': 'One actual query result value.'}
    if spec.x is None or spec.x >= len(columns) or spec.x == spec.y:
        raise ValueError('Select distinct, actual category/time and value columns.')
    temporal = columns[spec.x]['type'].startswith(('DATE', 'TIMESTAMP'))
    if spec.kind == 'line' and not temporal:
        raise ValueError('Line charts require a DATE or TIMESTAMP axis.')
    if spec.kind == 'scatter' and not is_numeric(columns[spec.x]):
        raise ValueError('Scatter charts require two numeric columns.')
    if spec.kind in {'bar', 'donut'} and (is_numeric(columns[spec.x]) or temporal):
        raise ValueError('Category charts require a text or boolean label column.')
    points = []
    for i, row in enumerate(rows):
        x, y = row[spec.x], number(row[spec.y])
        if x is None or y is None:
            continue
        plot_x = time_value(x) if temporal else number(x) if spec.kind == 'scatter' else str(x)
        if plot_x is None:
            continue
        points.append({'row': i, 'x': plot_x, 'label': str(x), 'y': y, 'value': row[spec.y]})
    if not points:
        raise ValueError('No finite, non-null pairs can be plotted.')
    if spec.kind in {'bar', 'donut', 'line'} and len({p['x'] for p in points}) != len(points):
        raise ValueError('Labels or timestamps must be unique; aggregate explicitly in SQL first.')
    maximum = {'bar': 20, 'donut': 8, 'line': 500, 'scatter': 500}[spec.kind]
    if len(points) > maximum:
        raise ValueError(f'This chart supports at most {maximum} points; narrow the SQL result.')
    if spec.kind == 'donut' and (any(p['y'] < 0 for p in points) or sum(p['y'] for p in points) <= 0):
        raise ValueError('Donuts require nonnegative values and a positive total.')
    if spec.kind == 'line':
        points.sort(key=lambda p: p['x'])
    omitted = len(rows) - len(points)
    return {'x_money': columns[spec.x].get('money') if spec.kind == 'scatter' else None, 'money': columns[spec.y].get('money'), 'percent': True if columns[spec.y].get('percent') else None, 'spec': spec.model_dump(), 'points': points, 'omitted_rows': omitted,
            'note': f'{len(points)} actual result rows plotted; {omitted} null, nonfinite or unsafe numeric pairs omitted. No implicit aggregation or sampling.'}


def chart_options(result):
    options = []
    columns = result['columns']
    # Bounded alternatives, preferring the first numeric measure and usable dimension.
    for kind in ('kpi', 'line', 'bar', 'donut', 'scatter'):
        found = None
        for y, column in enumerate(columns):
            if not is_numeric(column):
                continue
            for x in ([None] if kind == 'kpi' else range(len(columns))):
                try:
                    found = validate_chart({'kind': kind, 'x': x, 'y': y,
                        'title': (column['name'] + (' by ' + columns[x]['name'] if x is not None else ''))[:120]}, result)
                    break
                except ValueError:
                    continue
            if found:
                break
        if found:
            options.append(found)
    options.append(validate_chart({'kind': 'table'}, result))
    return {'recommended': options[0], 'options': [o['spec'] for o in options],
            'fallback_reason': None if len(options) > 1 else 'No suitable chart: empty results, incompatible types, duplicate labels, excessive cardinality or unsafe numeric precision. Use the exact result table.'}


class ChartPoint(BaseModel):
    row: int
    x: Optional[Union[str, float]] = None
    label: Optional[str] = None
    y: Optional[float] = None
    value: Union[str, int, float]


from .currency import Money

class ChartData(BaseModel):
    money: Optional[Money] = None
    percent: Optional[bool] = None
    x_money: Optional[Money] = None
    spec: ChartSpec
    points: list[ChartPoint]
    omitted_rows: int
    note: str


class ChartOptions(BaseModel):
    recommended: ChartData
    options: list[ChartSpec]
    fallback_reason: Optional[str]
