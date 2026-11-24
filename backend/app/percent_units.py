"""Owner-confirmed percentage columns (2026-11-20).

A result column is flagged `percent` only when the owner confirmed the SOURCE dataset column as a
percentage (knowledge settings `percent_columns`). Same tracing rule as currency: a direct column, a
cast, or a single-source AVG/MIN/MAX. SUM abstains (a total of percentages is not a percentage),
as do counts, ratios, joins and nested queries. Nothing is inferred from names.
"""
from sqlglot import exp, parse_one


def annotate_percent(sql, columns, settings):
    output = [dict(c) for c in columns]
    confirmed = set(getattr(settings, 'percent_columns', None) or [])
    if not confirmed:
        return output
    try:
        tree = parse_one(sql, read='duckdb')
        if not isinstance(tree, exp.Select) or len(list(tree.find_all(exp.Select))) != 1 or tree.args.get('joins'):
            return output

        def source(node):
            if isinstance(node, (exp.Alias, exp.Cast, exp.TryCast, exp.Avg, exp.Min, exp.Max, exp.Paren)):
                return source(node.this)
            return node.name if isinstance(node, exp.Column) else None
        for column, node in zip(output, tree.expressions):
            if column.get('money'):
                continue
            if source(node) in confirmed and column['type'].split('(')[0] in {'BIGINT', 'DOUBLE', 'DECIMAL', 'FLOAT', 'INTEGER', 'HUGEINT'}:
                column['percent'] = True
    except Exception:
        return [dict(c) for c in columns]
    return output
