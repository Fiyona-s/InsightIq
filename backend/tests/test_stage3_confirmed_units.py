"""Units are shown only after the owner confirms them (decision 2026-11-20, Rule 4 amended).

No column is money or a percentage because of its NAME. Money uses the existing currency path
(knowledge settings `monetary_columns`); percentages use the new `percent_columns`.
"""
import pytest
from fastapi.testclient import TestClient
from app import reports
from app.main import create_app
from app.percent_units import annotate_percent
from app.knowledge import KnowledgeSettings
from tests.test_analyst import ControlledProvider, dataset, finish, submit
from tests.test_phase3 import ControlledEmbedding

CSV = b'order_date,region,sales,discount_pct,revenue\n2026-01-01,North,3,5,100.5\n2026-01-02,South,4,10,200.25\n'
MAP = {'sales': 'BIGINT', 'discount_pct': 'DOUBLE', 'revenue': 'DOUBLE'}


def boot(root, sql):
    return create_app(root, provider=ControlledProvider(sql=sql), embedder=ControlledEmbedding())


def settings(client, ds):
    return client.get(f'/api/datasets/{ds}/knowledge').json()['settings']


def put(client, ds, **changes):
    body = {**settings(client, ds), **changes}
    r = client.put(f'/api/datasets/{ds}/knowledge', json=body)
    assert r.status_code == 200, r.text


def answer(client, ds, question='q'):
    run = finish(client, submit(client, ds, MAP, question))
    assert run['status'] == 'succeeded', run
    return client.get(f"/api/analyst/runs/{run['id']}/results").json()


def test_upload_marks_nothing_even_for_money_and_percent_names(tmp_path):
    with TestClient(boot(tmp_path, 'SELECT SUM(revenue) AS total FROM data')) as c:
        ds = c.post('/api/datasets', files={'file': ('shop.csv', CSV)}, data={'default_currency': 'USD'}).json()['id']
        s = settings(c, ds)
        assert s['monetary_columns'] == {} and s['percent_columns'] == [] and s['units_confirmed'] is False


def test_unconfirmed_columns_carry_no_unit_even_when_named_like_money(tmp_path):
    with TestClient(boot(tmp_path, 'SELECT SUM(sales) AS total FROM data')) as c:   # "sales" here holds counts
        data = answer(c, dataset(c, CSV))
        col = data['columns'][0]
        assert 'money' not in col and 'percent' not in col


def test_confirmed_money_uses_the_currency_path_and_percent_is_flagged(tmp_path):
    with TestClient(boot(tmp_path, 'SELECT AVG(discount_pct) AS avg_discount, SUM(revenue) AS total FROM data')) as c:
        ds = dataset(c, CSV)
        put(c, ds, monetary_columns={'revenue': {'currency': 'USD', 'mixed': False}}, percent_columns=['discount_pct'], units_confirmed=True)
        cols = answer(c, ds)['columns']
        assert cols[0].get('percent') is True and 'money' not in cols[0]
        assert cols[1]['money'] == {'currency': 'USD', 'mixed': False} and 'percent' not in cols[1]


def test_percent_never_survives_a_sum(tmp_path):
    with TestClient(boot(tmp_path, 'SELECT SUM(discount_pct) AS s FROM data')) as c:
        ds = dataset(c, CSV)
        put(c, ds, percent_columns=['discount_pct'], units_confirmed=True)
        assert all('percent' not in col for col in answer(c, ds)['columns'])


def test_a_column_cannot_be_money_and_percent_and_names_must_exist(tmp_path):
    with TestClient(boot(tmp_path, 'SELECT 1 AS x FROM data')) as c:
        ds = dataset(c, CSV)
        base = settings(c, ds)
        both = {**base, 'monetary_columns': {'revenue': {'currency': 'USD', 'mixed': False}}, 'percent_columns': ['revenue']}
        assert c.put(f'/api/datasets/{ds}/knowledge', json=both).status_code == 422
        assert c.put(f'/api/datasets/{ds}/knowledge', json={**base, 'percent_columns': ['nope']}).status_code == 422


def test_annotate_percent_unit_rules():
    s = KnowledgeSettings(percent_columns=['p'])
    cols = [{'name': 'a', 'type': 'DOUBLE'}]
    assert annotate_percent('SELECT p AS a FROM data', cols, s)[0].get('percent') is True
    assert annotate_percent('SELECT AVG(CAST(p AS DOUBLE)) AS a FROM data', cols, s)[0].get('percent') is True
    assert 'percent' not in annotate_percent('SELECT COUNT(p) AS a FROM data', [{'name': 'a', 'type': 'BIGINT'}], s)[0]
    assert 'percent' not in annotate_percent('SELECT AVG(q) AS a FROM data', cols, s)[0]
    assert 'percent' not in annotate_percent('SELECT AVG(p) AS a FROM data', cols, KnowledgeSettings())[0]


def test_pdf_follows_confirmed_units_only():
    assert reports.friendly_value(12.5, None, 'DOUBLE', True) == '12.5%'
    assert reports.friendly_value(12.5, None, 'DOUBLE', None) == '12.5'
    assert reports.friendly_value(None, None, 'DOUBLE', True) == '—'
    assert reports.friendly_value(1500, {'currency': 'USD', 'mixed': False}, 'DOUBLE', None).startswith('$')


def test_annotate_percent_abstains_on_ratios_and_nested_queries():
    s = KnowledgeSettings(percent_columns=['p'])
    cols = [{'name': 'a', 'type': 'DOUBLE'}]
    assert 'percent' not in annotate_percent('SELECT p / 100 AS a FROM data', cols, s)[0]
    assert 'percent' not in annotate_percent('SELECT AVG(x) AS a FROM (SELECT p AS x FROM data) t', cols, s)[0]


def test_pdf_headline_shows_percent_only_for_a_confirmed_column_and_dollars_follow_confirmation(monkeypatch):
    from tests.test_stage3_report_pdf import widget, view
    from reportlab.platypus import Paragraph
    seen = []
    original = reports.Paragraph
    monkeypatch.setattr(reports, 'Paragraph', lambda text, *a, **k: (seen.append(text), original(text, *a, **k))[1])
    def headline(column_flags, money=None):
        seen.clear()
        w = widget(title='Discount', value=12.5, name='avg_discount', money=money)
        w['result']['columns'][0].update(column_flags)
        reports.dashboard_pdf(view([w]), 'Shop')
        return list(seen)
    assert '12.5%' in headline({'percent': True})
    assert '12.5%' not in headline({}) and '12.5' in headline({})                 # unconfirmed: bare number
    assert any(t.startswith('$12.5') for t in headline({}, {'currency': 'USD', 'mixed': False}))


def test_chart_data_carries_percent_only_for_a_confirmed_column():
    from app.charts import chart_options
    def recommended(flag):
        column = {'name': 'avg_discount', 'type': 'DOUBLE'}
        if flag:
            column['percent'] = True
        options = chart_options({'columns': [{'name': 'region', 'type': 'VARCHAR'}, column], 'rows': [['N', 5.5], ['S', 7.25]], 'row_count': 2})
        return options['recommended'] if isinstance(options, dict) else options.recommended
    top = recommended(True)
    assert (top['percent'] if isinstance(top, dict) else top.percent) is True
    plain = recommended(False)
    assert (plain['percent'] if isinstance(plain, dict) else plain.percent) in (None, False)


def test_money_marks_stored_by_the_old_name_based_default_are_not_used_until_the_owner_confirms(tmp_path):
    with TestClient(boot(tmp_path, 'SELECT SUM(revenue) AS total FROM data')) as c:
        ds = dataset(c, CSV)
        base = settings(c, ds)
        old_build = {**base, 'monetary_columns': {'revenue': {'currency': 'USD', 'mixed': False}, 'sales': {'currency': 'EUR', 'mixed': False}},
                     'default_currency_columns': ['revenue']}                      # 'revenue' was a name-based guess; 'sales' was chosen by hand
        assert c.put(f'/api/datasets/{ds}/knowledge', json=old_build).status_code == 200
        now = settings(c, ds)
        assert now['monetary_columns'] == {'sales': {'currency': 'EUR', 'mixed': False}}   # the guess is ignored, the hand-made choice stays
        assert 'money' not in answer(c, ds)['columns'][0]                       # so the answer is a bare number
        put(c, ds, monetary_columns={'revenue': {'currency': 'USD', 'mixed': False}}, default_currency_columns=[], units_confirmed=True)
        assert answer(c, ds)['columns'][0]['money'] == {'currency': 'USD', 'mixed': False}
