"""Fail-closed DuckDB SELECT subset. This is a guard, not the execution sandbox."""
from typing import Dict

import sqlglot
from sqlglot import exp
from sqlglot.errors import SqlglotError
from sqlglot.optimizer.qualify import qualify
from sqlglot.optimizer.annotate_types import annotate_types

TYPES = {'VARCHAR', 'BIGINT', 'DOUBLE', 'DATE', 'TIMESTAMP', 'BOOLEAN'}
# Every AST node must be explicitly supported. Unknown/new syntax is rejected.
NODES = set('''Select From Table Identifier Column Star Alias TableAlias Where Group Having Order Ordered
Limit Offset Join With CTE Subquery Union Intersect Except Distinct Literal Null Boolean Paren
And Or Not EQ NEQ GT GTE LT LTE Is In Between Like ILike Escape Add Sub Mul Div Mod Neg
Case If Coalesce Nullif Count Sum Avg Min Max Round Abs Ceil Floor Lower Upper Length Trim
Cast TryCast DataType DataTypeParam DateTrunc TimestampTrunc Extract Var Tuple'''.split())
FUNCTIONS = {'AND', 'OR', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ROUND', 'ABS', 'CEIL', 'FLOOR', 'LOWER',
             'UPPER', 'LENGTH', 'TRIM', 'COALESCE', 'NULLIF', 'CASE', 'IF', 'CAST', 'TRY_CAST',
             'DATE_TRUNC', 'TIMESTAMP_TRUNC', 'EXTRACT'}


class GuardError(ValueError):
    pass


def validate_sql(sql: str, schema: Dict[str, str]) -> str:
    if not sql.strip() or len(sql) > 12000:
        raise GuardError('SQL must contain 1–12,000 characters.')
    try:
        statements = sqlglot.parse(sql, read='duckdb')
        if len(statements) != 1 or not isinstance(statements[0], (exp.Select, exp.SetOperation)):
            raise GuardError('Only a single read-only SELECT query is allowed.')
        tree = statements[0]
        nodes = list(tree.walk())
        if len(nodes) > 600:
            raise GuardError('SQL is too complex (maximum 600 syntax nodes).')
        ctes = {c.alias.lower() for c in tree.find_all(exp.CTE)}
        if 'data' in ctes:
            raise GuardError('CTEs may not shadow the authorized data table.')
        for node in nodes:
            if type(node).__name__ not in NODES:
                raise GuardError('Unsupported or unsafe SQL operation: ' + type(node).__name__)
            if isinstance(node, exp.With) and node.args.get('recursive'):
                raise GuardError('Recursive queries are not allowed.')
            if isinstance(node, exp.Table):
                if not isinstance(node.this, exp.Identifier) or node.db or node.catalog or node.name.lower() not in {'data'} | ctes:
                    raise GuardError('Only the selected dataset table "data" and local CTEs are authorized.')
            if isinstance(node, exp.Func) and node.sql_name() not in FUNCTIONS:
                raise GuardError('Function is not allowlisted: ' + node.sql_name())
            if isinstance(node, (exp.Cast, exp.TryCast)):
                target = node.args['to'].sql(dialect='duckdb').upper()
                if target not in TYPES:
                    raise GuardError('Cast target must be an approved scalar type.')
                # Raw string columns must not be silently converted with a throwing CAST.
                if not isinstance(node, exp.TryCast) and any(node.this.find_all(exp.Column)) and target != 'VARCHAR':
                    raise GuardError('Use TRY_CAST for explicit conversions or confirm a type mapping.')
        if not list(tree.find_all(exp.Table)):
            raise GuardError('Query must use the selected dataset table "data".')
        # Full scope-aware validation handles CTEs, aliases, self joins and stars.
        qualified = qualify(tree.copy(), dialect='duckdb', schema={'data': schema},
                            validate_qualify_columns=True, allow_partial_qualification=False)
        typed = annotate_types(qualified, schema={'data': schema}, dialect='duckdb')
        def string_type(expr):
            return expr is not None and expr.type is not None and expr.type.this in exp.DataType.TEXT_TYPES
        def scalar_type(expr):
            return expr is not None and expr.type is not None and expr.type.this in (exp.DataType.NUMERIC_TYPES | exp.DataType.TEMPORAL_TYPES | {exp.DataType.Type.BOOLEAN})
        numeric_ops = (exp.Sum, exp.Avg, exp.Add, exp.Sub, exp.Mul, exp.Div, exp.Mod,
                       exp.Round, exp.Abs, exp.Ceil, exp.Floor, exp.Neg)
        for node in typed.walk():
            if isinstance(node, numeric_ops) and any(string_type(child) for child in node.iter_expressions()):
                raise GuardError('Numeric analysis of text requires a confirmed type mapping or explicit TRY_CAST.')
            if isinstance(node, (exp.EQ, exp.NEQ, exp.GT, exp.GTE, exp.LT, exp.LTE)):
                if (string_type(node.this) and scalar_type(node.expression)) or (scalar_type(node.this) and string_type(node.expression)):
                    raise GuardError('Implicit text conversions are not allowed. Confirm types or use explicit TRY_CAST.')
            if isinstance(node, (exp.Between, exp.In)):
                children = [node.this] + (node.expressions if isinstance(node, exp.In) else [node.args.get('low'), node.args.get('high')])
                if any(string_type(c) for c in children) and any(scalar_type(c) for c in children):
                    raise GuardError('Implicit text conversions are not allowed. Confirm types or use explicit TRY_CAST.')
            if isinstance(node, (exp.Coalesce, exp.Nullif)):
                children = list(node.iter_expressions())
                if any(string_type(c) for c in children) and any(scalar_type(c) for c in children):
                    raise GuardError('Mixed text/scalar values require explicit TRY_CAST or confirmed types.')
        # Preserve semantics; no LIMIT or other clauses are injected.
        return tree.sql(dialect='duckdb')
    except GuardError:
        raise
    except (SqlglotError, ValueError, TypeError, RecursionError) as exc:
        raise GuardError('SQL could not be validated against the selected schema.') from exc
