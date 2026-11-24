"""Exact conversion counts over the imported records; raw values never leave here."""
from .sql_guard import TYPES


def q(name):
    return '"' + name.replace('"', '""') + '"'


def profile_dataset(path, connector):
    with connector(path) as db:
        columns = db.execute('DESCRIBE records').fetchall()
        total = db.execute('SELECT count(*) FROM records').fetchone()[0]
        result = []
        for name, storage, *_ in columns:
            col = q(name)
            non_null = db.execute('SELECT count(' + col + ') FROM records').fetchone()[0]
            conversions = {}
            for typ in sorted(TYPES - {'VARCHAR'}):
                cast = 'TRY_CAST(' + col + ' AS ' + typ + ')'
                predicate = 'isfinite(' + cast + ')' if typ == 'DOUBLE' else cast + ' IS NOT NULL'
                if typ == 'BIGINT':
                    predicate += ' AND regexp_full_match(trim(' + col + "), '[+-]?[0-9]+')"

                valid = db.execute('SELECT count(*) FROM records WHERE ' + predicate).fetchone()[0]
                conversions[typ] = {'valid': valid, 'failed': non_null - valid}
            # Numeric-looking identifiers with leading zeros should remain text by default.
            zeros = db.execute("SELECT count(*) FROM records WHERE regexp_matches(" + col + ", '^[-+]?0[0-9]+$')").fetchone()[0]
            iso_dates = db.execute("SELECT count(*) FROM records WHERE regexp_full_match(" + col + ", '[0-9]{4}-[0-9]{2}-[0-9]{2}')").fetchone()[0]
            suggested = 'VARCHAR'
            if non_null:
                for typ in ('BIGINT', 'DOUBLE', 'DATE', 'TIMESTAMP', 'BOOLEAN'):
                    if conversions[typ]['failed'] == 0 and not (zeros and typ in ('BIGINT', 'DOUBLE')) and (typ != 'DATE' or iso_dates == non_null):
                        suggested = typ
                        break
            result.append({'name': name, 'storage_type': storage, 'missing': total - non_null,
                           'suggested_type': suggested, 'conversions': conversions})
        return {'table': 'data', 'rows': total, 'columns': result,
                'policy': 'Raw values stay unchanged. Confirm mappings per run; failed TRY_CAST conversions become NULL and are excluded from aggregates.'}


def explicit_cast_diagnostics(sql, path, connector, mapping):
    """Dataset-wide counts for direct raw-column TRY_CAST, before query filters.

    Complex CTE/subquery expression lineage is deliberately not guessed. Their
    conversion behavior remains inspectable in SQL and the type preview.
    """
    import sqlglot
    from sqlglot import exp
    tree = sqlglot.parse_one(sql, read='duckdb')
    if any(tree.find_all(exp.Subquery, exp.CTE)):
        return []
    aliases = {t.alias_or_name.casefold() for t in tree.find_all(exp.Table) if t.name.casefold() == 'data'}
    with connector(path) as db:
        actual = {c[0].casefold(): c[0] for c in db.execute('DESCRIBE records').fetchall()}
        seen, result = set(), []
        for cast in tree.find_all(exp.TryCast):
            if not isinstance(cast.this, exp.Column):
                continue
            column = cast.this
            name = actual.get(column.name.casefold())
            target = cast.args['to'].sql(dialect='duckdb').upper()
            if not name or (column.table and column.table.casefold() not in aliases) or mapping.get(name, 'VARCHAR') != 'VARCHAR' or target == 'VARCHAR' or (name, target) in seen:
                continue
            seen.add((name, target))
            raw = q(name)
            missing, failed = db.execute('SELECT count(*) FILTER (WHERE ' + raw + ' IS NULL), count(*) FILTER (WHERE ' + raw + ' IS NOT NULL AND TRY_CAST(' + raw + ' AS ' + target + ') IS NULL) FROM records').fetchone()
            result.append({'column': name, 'type': target, 'missing': missing, 'failed': failed})
        return result
