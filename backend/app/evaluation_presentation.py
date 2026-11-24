"""Bounded read-only row diagnostics; stored verdicts and scoring remain authoritative."""
from .benchmark import equivalent
from functools import lru_cache

LIMIT = 20

def row_diff(row):
    if 'ordered' not in row:
        return {'available':False,'notice':'Matching order was not recorded; row diff omitted.','rows':[]}
    actual, expected = row.get('actual'), row.get('expected')
    if actual is None or expected is None:
        return {'available': False, 'notice': 'Both stored outputs are required for a row diff.', 'rows': []}
    columns_match = actual['columns'] == expected['columns']
    # Delegate each typed row match to the unchanged comparator. Matching uses the
    # complete bounded multiset, not a greedy pairing (tolerance is non-transitive).
    a, e = actual['rows'], expected['rows']
    if len(a)>100 or len(e)>100:
        return {'available': False, 'notice': 'Row matching omitted above 100 rows; inspect the explicitly bounded output previews.', 'rows': []}
    @lru_cache(maxsize=10000)
    def matches(i,j):
        return equivalent({**actual,'rows':[a[i]]},{**expected,'rows':[e[j]]},True)[0]
    matched={}
    if row.get('ordered',False):
        matched={j:j for j in range(min(len(a),len(e))) if matches(j,j)}
    else:
        def assign(i,seen):
            for j in range(len(e)):
                if j in seen or not matches(i,j):continue
                seen.add(j)
                if j not in matched or assign(matched[j],seen):matched[j]=i;return True
            return False
        for i in range(len(a)):assign(i,set())
    used=set(matched.values())
    changes=([{'side':'actual','row':i+1,'value':r,'match':'Matched' if i in used else 'Unmatched'} for i,r in enumerate(a)] +
             [{'side':'expected','row':j+1,'value':r,'match':'Matched' if j in matched else 'Unmatched'} for j,r in enumerate(e)])
    return {'available':True,'notice':'Display only: typed row matching uses the existing comparator; the stored verdict is unchanged.',
            'ordered':bool(row.get('ordered',False)), 'column_metadata_identical':columns_match,
            'total_rows':len(changes),'shown_rows':min(LIMIT,len(changes)),'rows':changes[:LIMIT]}

def presentation(job):
    metrics=job.get('metrics') or {}
    # Never infer the scorer version from the currently installed application.
    return {'id':job['id'],'scoring_version':metrics.get('metrics_version'),
            'comparison_policy':job.get('comparison_policy'),
            'results':[{'case_id':r['case_id'],'diff':row_diff(r)} for r in job.get('results',[])]}
