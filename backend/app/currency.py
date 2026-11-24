"""Conservative display metadata and bounded, opt-in daily exchange rates."""
from __future__ import annotations
from typing import Optional
import json
import os
import time
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext, ROUND_HALF_UP
from threading import Lock
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlglot import parse_one, exp

CURRENCIES = 'USD INR EUR GBP AED CAD AUD JPY SGD CHF CNY NZD SEK NOK DKK ZAR BRL MXN KRW HKD PLN TRY'.split()

class Money(BaseModel):
    currency: Optional[str] = None
    mixed: bool = False
    @field_validator('currency')
    @classmethod
    def valid_currency(cls, value):
        if value is not None and value not in CURRENCIES:
            raise ValueError('Select a supported ISO currency.')
        return value


def annotate(sql, columns, settings):
    """Only direct columns, casts and single-source SUM/AVG/MIN/MAX preserve units.

    Complex expressions, joins, CTEs, counts and ratios deliberately abstain.
    """
    output = [dict(c) for c in columns]
    try:
        tree = parse_one(sql, read='duckdb')
        if not isinstance(tree, exp.Select) or len(list(tree.find_all(exp.Select))) != 1 or tree.args.get('joins'):
            return output
        def source(node):
            if isinstance(node, (exp.Alias, exp.Cast, exp.TryCast, exp.Sum, exp.Avg, exp.Min, exp.Max, exp.Paren)):
                return source(node.this)
            return node.name if isinstance(node, exp.Column) else None
        metrics = {}
        for metric in settings.metrics:
            if metric.money:
                definition = parse_one(metric.sql, read='duckdb')
                # Whole-query equality preserves filters, grouping and metric semantics.
                normalized = tree.copy()
                expected = definition.copy()
                for query in (normalized, expected):
                    query.set('expressions', [n.this.copy() if isinstance(n, exp.Alias) else n.copy() for n in query.expressions])
                if normalized == expected:
                    metrics.update({i: metric.money.model_dump() for i in range(len(tree.expressions))})
        for i, (col, node) in enumerate(zip(output, tree.expressions)):
            if i in metrics and not node.find(exp.Count) and col['type'].split('(')[0] in {'BIGINT','DOUBLE','DECIMAL','FLOAT','INTEGER','HUGEINT'}:
                col['money'] = metrics[i]
                continue
            name = source(node)
            if name in settings.monetary_columns:
                col['money'] = settings.monetary_columns[name].model_dump()
    except Exception:
        pass  # Unknown lineage must never become currency proof.
    return output

class Rates:
    def __init__(self, fetch=None):
        self.fetch = fetch or self.remote
        self.cache = {}
        self.lock = Lock()
        self.unavailable_until = 0
    @staticmethod
    def remote(source, target, day):
        with httpx.Client(timeout=8, follow_redirects=False, trust_env=False) as client:
            with client.stream('GET', f'https://api.frankfurter.dev/v2/rate/{source}/{target}', params={'date': day} if day else {}) as response:
                response.raise_for_status()
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > 65536:
                        raise ValueError('Rate response too large')
                return json.loads(body, parse_float=Decimal)
    def get(self, source, target, day=None):
        if source not in CURRENCIES or target not in CURRENCIES or source == target:
            raise HTTPException(422, 'Select distinct supported currencies.')
        if day and day > date.today():
            raise HTTPException(422, 'Historical rate date cannot be in the future.')
        key = (source, target, day)
        with self.lock:
            cached = self.cache.get(key)
            if cached and cached[0] > time.monotonic():
                return cached[1]
            try:
                raw = self.fetch(source, target, day.isoformat() if day else None)
                if len(str(raw['rate'])) > 100:
                    raise ValueError()
                rate = Decimal(str(raw['rate']))
                effective = date.fromisoformat(raw['date'])
                if not rate.is_finite() or rate < Decimal('1e-20') or rate > Decimal('1e20') or effective > (day or date.today()):
                    raise ValueError()
                if raw.get('base', source).upper() != source or raw.get('quote', target).upper() != target:
                    raise ValueError()
                # Daily reference rates may cross weekends; never silently accept old observations.
                if not day and (date.today() - effective).days > 7:
                    raise ValueError()
            except Exception as exc:
                if not isinstance(exc, httpx.HTTPStatusError) or exc.response.status_code >= 500:
                    self.unavailable_until = time.monotonic() + 30
                raise HTTPException(503, 'Exchange rate unavailable, unsupported, or invalid. Original values retained.') from exc
            value = dict(source_currency=source, target_currency=target, rate=str(rate), rate_source='Frankfurter daily reference', effective_date=effective.isoformat(), fetched_at=datetime.now(timezone.utc).isoformat(), historical=bool(day))
            if len(self.cache) >= 256:
                self.cache.clear()
            self.cache[key] = (time.monotonic() + 3600, value)
            return value

class ConvertRequest(BaseModel):
    source_currency: str
    target_currency: str
    amounts: list[Optional[str]] = Field(max_length=1000)
    historical_date: Optional[date] = None


def convert(amounts, rate):
    result = []
    with localcontext() as ctx:
        ctx.prec = 400
        for amount in amounts:
            if amount is None:
                result.append(None)
                continue
            try:
                if len(amount) > 100:
                    raise ValueError()
                value = Decimal(amount)
                if not value.is_finite() or abs(value.adjusted()) > 300:
                    raise ValueError()
                result.append(str(value * Decimal(rate)))
            except (InvalidOperation, ValueError):
                raise HTTPException(422, 'Amounts must be finite decimal strings.')
    return result


def router(rates=None):
    api = APIRouter(prefix='/api/currency', tags=['currency'])
    rates = rates or Rates()
    @api.get('/status')
    def status():
        configured = os.getenv('FX_PROVIDER', '') == 'frankfurter'
        available = rates.unavailable_until <= time.monotonic()
        enabled = configured and available
        reason = None if enabled else ('Rate service temporarily unavailable. Original amounts retained; retry shortly.' if configured else 'Conversion disabled. Configure FX_PROVIDER=frankfurter on the backend.')
        return {'enabled': enabled, 'configured':configured, 'currencies': CURRENCIES, 'reason': reason}
    @api.post('/convert')
    def conversion(body: ConvertRequest):
        if not status()['enabled']:
            raise HTTPException(503, status()['reason'])
        quote = rates.get(body.source_currency, body.target_currency, body.historical_date)
        return {**quote, 'original_amounts': body.amounts, 'converted_amounts': convert(body.amounts, quote['rate'])}
    return api


def format_money(value, money):
    """Source-currency report presentation; ISO labels survive PDF font limitations."""
    if value is None:
        return 'NULL'
    code = (money or {}).get('currency')
    if not code or (money or {}).get('mixed'):
        return str(value)
    try:
        with localcontext() as ctx:
            ctx.prec = 400
            ctx.rounding = ROUND_HALF_UP
            amount = Decimal(str(value))
            if not amount.is_finite():
                return str(value)
            precision = 0 if code in {'JPY', 'KRW'} else 2
            text = format(abs(amount), f',.{precision}f')
            if code == 'INR':
                whole, dot, fraction = text.replace(',', '').partition('.')
                tail, head = whole[-3:], whole[:-3]
                groups = []
                while head:
                    groups.insert(0, head[-2:]); head = head[:-2]
                text = ','.join(groups + [tail]) + (dot + fraction if dot else '')
            return code + ' ' + ('-' if amount < 0 else '') + text
    except (InvalidOperation, ValueError):
        return str(value)


def mixed_aggregate(sql, settings):
    tree = parse_one(sql, read='duckdb')
    mixed = {name for name, money in settings.monetary_columns.items() if money.mixed}
    if any(c.name in mixed for aggregate in tree.find_all(exp.Sum, exp.Avg, exp.Min, exp.Max) for c in aggregate.find_all(exp.Column)):
        return True
    for projection in tree.expressions:
        units = {settings.monetary_columns[c.name].currency for c in projection.find_all(exp.Column)
                 if c.name in settings.monetary_columns and settings.monetary_columns[c.name].currency}
        if len(units) > 1:
            return True
    return False


def export_result(result, target, rates, day=None):
    """Append converted columns and provenance; retain every original cell."""
    import copy
    if os.getenv('FX_PROVIDER', '') != 'frankfurter':
        raise HTTPException(503, 'Currency conversion is not configured.')
    output = copy.deepcopy(result)
    original_columns = list(result['columns'])
    changed = False
    for i, column in enumerate(original_columns):
        money = column.get('money') or {}
        source = money.get('currency')
        if not source or money.get('mixed') or source == target:
            continue
        quote = rates.get(source, target, day)
        amounts = convert([None if row[i] is None else str(row[i]) for row in result['rows']], quote['rate'])
        names = [column['name']+'__converted_'+target, column['name']+'__source_currency', column['name']+'__rate', column['name']+'__effective_date', column['name']+'__rate_source']
        output['columns'].extend({'name': name, 'type': 'VARCHAR'} for name in names)
        for row, amount in zip(output['rows'], amounts):
            row.extend([amount, source, quote['rate'], quote['effective_date'], quote['rate_source']])
        changed = True
    if not changed:
        raise HTTPException(422, 'No confirmed monetary columns require this conversion.')
    return output


def converted_view(view, target, rates, day=None):
    """An explicit report-only transformation; no snapshot or SQL writes."""
    import copy
    from .charts import validate_chart
    from .evidence import compute_evidence
    if os.getenv('FX_PROVIDER', '') != 'frankfurter':
        raise HTTPException(503, 'Currency conversion is not configured.')
    if target not in CURRENCIES:
        raise HTTPException(422, 'Unsupported report currency.')
    output = copy.deepcopy(view)
    for widget in output['widgets']:
        result = widget.get('result')
        if not result:
            continue
        widget['original_result'] = copy.deepcopy(result)
        widget['currency_conversion'] = []
        for i, column in enumerate(result['columns']):
            money = column.get('money') or {}
            source = money.get('currency')
            if not source or money.get('mixed') or source == target:
                continue
            quote = rates.get(source, target, day)
            values = convert([None if row[i] is None else str(row[i]) for row in result['rows']], quote['rate'])
            for row, value in zip(result['rows'], values):
                row[i] = value
            column['money'] = {'currency': target, 'mixed': False}
            widget['currency_conversion'].append({'column': i, **quote})
        if widget['currency_conversion']:
            widget['evidence'] = compute_evidence(result)
            widget['summary'] = []
            try:
                widget['chart'] = validate_chart(widget['chart']['spec'], result)
            except ValueError:
                widget['chart'] = validate_chart({'kind':'table'}, result)
    output['currency_notice'] = f'Explicit converted report in {target}. Original rows are retained in original_result in JSON. Unconfirmed monetary columns remain original. Rates and effective dates are listed per column.'
    return output
