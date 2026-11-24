"""Fixed read-only dataset access, explicit scalar parsing and conservative readiness."""
import hashlib,json,math,re
from collections import Counter
from datetime import datetime,timezone

MAX_ROWS=5000
MAX_FEATURES=24
MAX_CATEGORIES=100
VERSION='automl-v1.1'
class MLFailure(ValueError):
    def __init__(self,message,code='invalid_ml_data'):super().__init__(message);self.code=code

def missing(v):return v is None or isinstance(v,str) and not v.strip()
def number(v):
    if missing(v):return float('nan')
    if isinstance(v,bool):raise ValueError('Boolean is not an explicit numeric value.')
    f=float(v)
    if not math.isfinite(f) or abs(f)>1e15:raise ValueError('Numeric value must be finite and bounded.')
    return f

def moment(v):
    if missing(v):return None
    s=str(v).strip()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:[T ].+)?',s):raise ValueError('Use ISO YYYY-MM-DD or an ISO timestamp.')
    d=datetime.fromisoformat(s.replace('Z','+00:00'))
    return d.astimezone(timezone.utc).replace(tzinfo=None) if d.tzinfo else d

def read_dataset(analyst,identifier,allow_archived=False):
    item=analyst.get_item(identifier)
    if getattr(item,"archived_at",None) and not allow_archived:raise MLFailure("Restore this archived dataset before using it for a new model operation.")
    with analyst.connector(analyst.root/(item.id+'.duckdb')) as db:
        columns=[c[0] for c in db.execute('DESCRIBE records').fetchall()]
        digest=hashlib.sha256(json.dumps(columns,ensure_ascii=True).encode());rows=[];total=0
        cursor=db.execute('SELECT * FROM records')
        while True:
            batch=cursor.fetchmany(500)
            if not batch:break
            for row in batch:
                digest.update(json.dumps(row,ensure_ascii=True,separators=(',',':')).encode());digest.update(b'\n')
                if len(rows)<MAX_ROWS:rows.append(list(row))
                total+=1
                if total>20000:raise MLFailure('Dataset exceeds registered ingestion limits.','dataset_limit')
    return {'dataset_id':item.id,'dataset_name':item.name,'columns':columns,'rows':rows,'total_rows':total,'fingerprint':digest.hexdigest()}

def profile(data,task='regression',target=None):
    rows=data['rows'];n=len(rows);columns=[];warnings=[]
    for i,name in enumerate(data['columns']):
        values=[r[i] for r in rows if not missing(r[i])];counts=Counter(map(str,values));numeric=[];dates=[]
        for v in values:
            try:numeric.append(number(v))
            except (ValueError,TypeError,OverflowError):pass
            try:
                d=moment(v)
                if d is not None:dates.append(d)
            except (ValueError,TypeError,OverflowError):pass
        leading_zeros=any(re.fullmatch(r'[+-]?0[0-9]+',str(v).strip()) for v in values)
        kind='numeric' if values and len(numeric)==len(values) and not leading_zeros else 'datetime' if values and len(dates)==len(values) else 'categorical'
        identifier=bool(re.search(r'(^id$|(?:^|_)id$|_identifier$|^uuid$|^index$)',name,re.I)) or kind=='categorical' and n>=20 and len(counts)>.95*n
        if kind=='numeric' and len(counts)==n and n>=20:
            ordered=sorted(numeric)
            identifier=identifier or all(abs(b-a-1)<1e-10 for a,b in zip(ordered,ordered[1:]))
        leakage=task in {'regression','classification'} and bool(re.search(r'(^|_)(future|outcome|predicted|prediction|label|target|actual|status|refunded|delivered)(_|$)|^net_revenue',name,re.I)) and name!=target
        c={'name':name,'kind':kind,'missing':n-len(values),'cardinality':len(counts),'constant':len(counts)<=1,
           'potential_identifier':identifier,'potential_leakage':leakage,'high_cardinality':kind=='categorical' and len(counts)>MAX_CATEGORIES,
           'numeric_valid':len(numeric),'date_valid':len(dates),'minimum':min(numeric) if kind=='numeric' else None,'maximum':max(numeric) if kind=='numeric' else None,
           'date_start':min(dates).isoformat() if dates else None,'date_end':max(dates).isoformat() if dates else None}
        columns.append(c)
    distribution=None
    if target in data['columns']:
        j=data['columns'].index(target);values=[r[j] for r in rows if not missing(r[j])]
        counts=Counter(map(str,values))
        distribution={'observed':len(values),'missing':n-len(values),'unique':len(counts),'top_values':[{'value':k,'count':v} for k,v in counts.most_common(20)],'remaining_values':max(0,len(counts)-20)}
        for c in columns:
            if c['name']!=target:
                i=data['columns'].index(c['name']);pairs=[(r[i],r[j]) for r in rows if not missing(r[j])]
                if pairs and all(str(a)==str(b) for a,b in pairs):c['potential_leakage']=True;c['target_copy']=True
                elif c['kind']=='numeric' and next(t for t in columns if t['name']==target)['kind']=='numeric':
                    nums=[(number(a),number(b)) for a,b in pairs if not missing(a)]
                    if len(nums)>2:
                        x,y=zip(*nums);mx=sum(x)/len(x);my=sum(y)/len(y)
                        xx=sum((a-mx)**2 for a in x);yy=sum((b-my)**2 for b in y)
                        corr=sum((a-mx)*(b-my) for a,b in nums)/math.sqrt(xx*yy) if xx and yy else 0
                        if abs(corr)>.995:warnings.append(c['name']+' is almost perfectly correlated with the target. Check prediction-time availability and target derivation.')
    reasons=[]
    if data['total_rows']>MAX_ROWS:reasons.append('Training is limited to 5000 rows. Create an explicitly bounded registered dataset; no automatic training sample is taken.')
    minimum=60 if task in {'regression','classification'} else 20 if task=='anomaly' else 12
    if n<minimum:reasons.append(f'{task} needs at least {minimum} rows before task-specific checks.')
    if task in {'regression','classification'}:
        if target not in data['columns']:reasons.append('Select a target column.')
        elif distribution and distribution['observed']<60:reasons.append('At least 60 labeled rows are required after excluding missing targets.')
        elif next(c for c in columns if c['name']==target)['constant']:reasons.append('The target needs at least two distinct observed values.')
        elif task=='regression' and next(c for c in columns if c['name']==target)['kind']!='numeric':reasons.append('Regression target must contain valid finite numbers.')
        elif task=='classification':
            counts=Counter(str(r[data['columns'].index(target)]) for r in rows if not missing(r[data['columns'].index(target)]))
            if any(len(v)>128 for v in counts):reasons.append('Classification labels must be at most 128 characters.')
            if len(counts)>20 or not counts or min(counts.values())<10:reasons.append('Classification supports 2–20 classes with at least 10 labeled examples per class and enough independent groups for holdouts.')
    if task=='forecasting':warnings.append('Forecast readiness also depends on period coverage, horizon and missing-period policy.')
    duplicates=n-len({json.dumps(r,sort_keys=True) for r in rows})
    return {'dataset_id':data['dataset_id'],'dataset_name':data['dataset_name'],'fingerprint':data['fingerprint'],'total_rows':data['total_rows'],'sampled_rows':n,'sampled':n<data['total_rows'],
            'duplicate_rows':duplicates,'columns':columns,'target_distribution':distribution,'readiness':{'ready':not reasons,'reasons':reasons,'warnings':warnings},
            'policy':'Types are suggestions; confirm feature types. Statistics describe the profiling sample. Learned preprocessing fits training rows only.'}

def validate_features(data,config):
    p=profile(data,config['task'],config.get('target'))
    if not p['readiness']['ready']:raise MLFailure(' '.join(p['readiness']['reasons']))
    if data['total_rows']>MAX_ROWS:raise MLFailure('Maximum 5000 rows per local experiment.','dataset_limit')
    lookup={c['name']:c for c in p['columns']}
    for spec in config['features']:
        name=spec['name']
        if name not in lookup:raise MLFailure('Unknown feature: '+name)
        c=lookup[name]
        if name==config.get('target'):raise MLFailure('The target cannot be a feature.','target_leakage')
        if c['potential_identifier'] or c['potential_leakage'] or c['constant']:raise MLFailure(name+' is an identifier, constant, future/outcome field or target copy. Exclude it.','unsafe_feature')
        if c['cardinality']>MAX_CATEGORIES and spec['kind']=='categorical':raise MLFailure(name+' exceeds 100 categorical levels.','cardinality_limit')
        if spec['kind'] in {'numeric','datetime'}:
            key='numeric_valid' if spec['kind']=='numeric' else 'date_valid'
            if c[key]!=len(data['rows'])-c['missing']:raise MLFailure(name+' has nonempty values incompatible with its confirmed type. Clean them or choose the correct type.','invalid_type')
        if config['task']=='anomaly' and spec['kind']!='numeric':raise MLFailure('Anomaly detection supports numerical predictors only.')
    return p
