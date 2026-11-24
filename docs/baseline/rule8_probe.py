# Read-only Rule 8 probe: lists the original dashboard's widgets and flags duplicate saved charts.
import sqlite3, json, collections
db = sqlite3.connect('file:/data/catalog.sqlite?mode=ro', uri=True)
for i, p in db.execute("SELECT id, payload FROM dashboards"):
    d = json.loads(p)
    charts = collections.Counter(w.get('chart_id') for w in d.get('widgets', []) if w.get('chart_id'))
    print(json.dumps({'dashboard': d.get('title'), 'widgets': len(d.get('widgets', [])),
                      'duplicate_chart_ids': {k: v for k, v in charts.items() if v > 1},
                      'widget_titles': [w.get('title') for w in d.get('widgets', [])]}))
