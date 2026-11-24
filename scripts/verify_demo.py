#!/usr/bin/env python3
"""Independent check of InsightIQ's answers on YOUR file. Not part of the app: it reads the CSV with pandas and computes each expected answer
its own way (it never uses InsightIQ's SQL path), then prints a table for you to compare with what InsightIQ says.

    pip install -r backend/requirements-verify.txt
    python scripts/verify_demo.py --csv /path/to/your.csv --questions my_questions.json [--json out.json]

The questions file is a JSON list. Each item: {"question": "...", "compute": {...}}. Supported compute forms:
  {"op": "count"}                                    number of rows
  {"op": "sum|mean|median|min|max|count|nunique", "column": "revenue"}
  {"op": "sum|mean|median|min|max|count|nunique", "column": "revenue", "by": "region", "top": 5, "order": "desc|asc"}
  optional "where": [{"column": "region", "is": "North"}, {"column": "quantity", "gt": 2}]   (is, not, gt, gte, lt, lte)
Numbers are read the way a spreadsheet would (numbers as numbers). If you told InsightIQ a column is Text, pass --text column. See
docs/demo/verify_questions.template.json. No real data is stored by this tool; do not commit your CSV.
"""
import argparse
import json
import sys

try:
    import pandas as pd
except ImportError:                                           # pragma: no cover
    sys.exit('This tool needs pandas: pip install -r backend/requirements-verify.txt')

AGGREGATES = {'sum': 'sum', 'mean': 'mean', 'median': 'median', 'min': 'min', 'max': 'max', 'count': 'count', 'nunique': 'nunique'}
FILTERS = {'is': lambda s, v: s == v, 'not': lambda s, v: s != v, 'gt': lambda s, v: s > v, 'gte': lambda s, v: s >= v, 'lt': lambda s, v: s < v, 'lte': lambda s, v: s <= v}


def filtered(frame, rules):
    for rule in rules or []:
        column = rule['column']
        kinds = [k for k in FILTERS if k in rule]
        if column not in frame.columns or len(kinds) != 1:
            raise ValueError(f'bad filter {rule}')
        frame = frame[FILTERS[kinds[0]](frame[column], rule[kinds[0]])]
    return frame


def compute(frame, spec):
    frame = filtered(frame, spec.get('where'))
    op = spec['op']
    if op == 'count' and 'column' not in spec and 'by' not in spec:
        return int(len(frame))
    if op not in AGGREGATES or 'column' not in spec and op != 'count':
        raise ValueError(f'unsupported compute {spec}')
    column = spec.get('column')
    if 'by' in spec:
        grouped = frame.groupby(spec['by'], dropna=False)[column].agg(AGGREGATES[op]) if column else frame.groupby(spec['by'], dropna=False).size()
        grouped = grouped.sort_values(ascending=spec.get('order', 'desc') == 'asc', kind='stable')
        if spec.get('top'):
            grouped = grouped.head(int(spec['top']))
        return [(str(k), float(v)) for k, v in grouped.items()]
    value = getattr(frame[column], AGGREGATES[op])()
    return float(value) if isinstance(value, (int, float)) or hasattr(value, 'item') else value


def show(value):
    if isinstance(value, list):
        return '; '.join(f'{k}: {v:,.2f}'.rstrip('0').rstrip('.') for k, v in value)
    if isinstance(value, float):
        return f'{value:,.4f}'.rstrip('0').rstrip('.')
    return f'{value:,}' if isinstance(value, int) else str(value)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--csv', required=True)
    parser.add_argument('--questions', required=True)
    parser.add_argument('--json')
    parser.add_argument('--text', action='append', default=[], help='read this column as text (repeat for several)')
    args = parser.parse_args(argv)
    frame = pd.read_csv(args.csv, dtype={c: str for c in args.text}, keep_default_na=True)
    with open(args.questions, encoding='utf-8') as handle:
        questions = json.load(handle)
    rows, results = [], []
    for item in questions:
        try:
            value = compute(frame, item['compute'])
            rows.append((item['question'], show(value)))
            results.append({'question': item['question'], 'expected': value})
        except Exception as exc:                              # a bad question must not hide the others
            rows.append((item['question'], f'could not compute ({exc})'))
            results.append({'question': item['question'], 'error': str(exc)})
    width = max(len(q) for q, _ in rows) if rows else 8
    print(f'File: {args.csv}   rows: {len(frame):,}   columns: {len(frame.columns)}\n')
    print(f'{"Question".ljust(width)}  Expected answer (pandas)')
    print(f'{"-" * width}  {"-" * 40}')
    for question, answer in rows:
        print(f'{question.ljust(width)}  {answer}')
    print('\nCompare each line with the answer InsightIQ gives. A difference is worth a look: check the column types you confirmed and any filters.')
    if args.json:
        with open(args.json, 'w', encoding='utf-8') as handle:
            json.dump(results, handle, indent=1, default=str)
    return 0


if __name__ == '__main__':
    sys.exit(main())
