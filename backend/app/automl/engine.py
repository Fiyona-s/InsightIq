"""Fixed local model candidates, leakage-aware splits and measured outputs."""
import hashlib,json,platform,time
from collections import Counter
from uuid import uuid4
from pathlib import Path
from datetime import datetime,timedelta,timezone
import joblib,numpy as np,scipy,sklearn
from sklearn.pipeline import Pipeline
from sklearn.dummy import DummyRegressor,DummyClassifier
from sklearn.linear_model import LinearRegression,Ridge,LogisticRegression
from sklearn.ensemble import RandomForestRegressor,RandomForestClassifier,HistGradientBoostingRegressor,HistGradientBoostingClassifier,IsolationForest
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import mean_absolute_error,mean_squared_error,r2_score,accuracy_score,precision_recall_fscore_support,confusion_matrix,roc_auc_score,silhouette_score
from sklearn.model_selection import GroupShuffleSplit,StratifiedGroupKFold
from .data import MLFailure,validate_features,number,moment,missing,VERSION
from .preprocessing import preprocessor,feature_array


def versions():return {'python':platform.python_version(),'sklearn':sklearn.__version__,'numpy':np.__version__,'scipy':scipy.__version__,'joblib':joblib.__version__,'automl':VERSION}
def serial(value):
    if isinstance(value,dict):return {str(k):serial(v) for k,v in value.items()}
    if isinstance(value,(list,tuple,np.ndarray)):return [serial(v) for v in value]
    if isinstance(value,np.generic):return serial(value.item())
    if isinstance(value,float) and not np.isfinite(value):return None
    return value

def supervised_split(x,y,task,seed,features=None):
    # Group identical selected feature vectors, including conflicting labels.
    def canonical(row):
        if features is None:return row.tolist()
        values=[]
        for value,spec in zip(row,features):
            if missing(value):values.append(None)
            elif spec['kind']=='numeric':
                v=number(value);values.append(0.0 if v==0 else v)
            elif spec['kind']=='datetime':
                d=moment(value);values.append([d.year,d.month,d.day,d.weekday()])
            else:values.append(str(value))
        return values
    groups=np.array([hashlib.sha256(json.dumps(canonical(row),default=str).encode()).hexdigest() for row in x])
    if len(set(groups))<30:raise MLFailure('At least 30 independent feature groups are needed for supervised train/validation/test separation.')
    if task=='classification':
        counts=Counter(y)
        if len(counts)<2 or len(counts)>20 or min(counts.values())<10:raise MLFailure('Use 2–20 classes with at least 10 observations per class.')
        if any(len(set(groups[y==c]))<5 for c in counts):raise MLFailure('Each class needs at least 5 independent feature groups for grouped stratification.')
        folds=[test for _,test in StratifiedGroupKFold(5,shuffle=True,random_state=seed).split(x,y,groups)]
        test=folds[0];val=folds[1];train=np.concatenate(folds[2:])
        if any(set(y[a])!=set(y) for a in (train,val,test)):raise MLFailure('Grouped stratification cannot retain every class in every split; add independent examples.')
    else:
        rest,test=next(GroupShuffleSplit(n_splits=1,test_size=.2,random_state=seed).split(x,y,groups))
        a,b=next(GroupShuffleSplit(n_splits=1,test_size=.25,random_state=seed+1).split(x[rest],y[rest],groups[rest]));train,val=rest[a],rest[b]
    if min(len(train),len(val),len(test))<8 or len(train)<25:raise MLFailure('Insufficient independent holdout rows; need at least 25 training and 8 validation/test rows.')
    assert not(set(groups[train])&set(groups[val]) or set(groups[train])&set(groups[test]) or set(groups[val])&set(groups[test]))
    return train,val,test,groups

def reg_metrics(y,p):
    mse=float(mean_squared_error(y,p));return {'mae':float(mean_absolute_error(y,p)),'mse':mse,'rmse':float(np.sqrt(mse)),'r2':float(r2_score(y,p,force_finite=False)) if len(y)>1 and np.var(y)>0 else None}
def cls_metrics(y,p,model,x):
    precision,recall,f1,_=precision_recall_fscore_support(y,p,average='macro',zero_division=0)
    auc=None
    try:
        probabilities=model.predict_proba(x);classes=model.classes_
        if set(y)==set(classes):auc=float(roc_auc_score(np.array(y)==classes[1],probabilities[:,1])) if len(classes)==2 else float(roc_auc_score(y,probabilities,labels=classes,multi_class='ovr',average='macro'))
    except (ValueError,AttributeError):pass
    return {'accuracy':float(accuracy_score(y,p)),'precision_macro':float(precision),'recall_macro':float(recall),'f1_macro':float(f1),'roc_auc':auc}

def importance(pipe,features):
    model=pipe.named_steps['model'];values=None;method=None
    if hasattr(model,'feature_importances_'):values=model.feature_importances_;method='Training impurity importance of transformed features; not causal evidence.'
    elif hasattr(model,'coef_'):
        values=np.abs(model.coef_);values=values.mean(axis=0) if values.ndim>1 else values;method='Absolute coefficient of transformed/scaled features; not directly comparable across feature units.'
    if values is None:return {'method':'Unavailable for this algorithm.','values':[]}
    names=pipe.named_steps['prepare'].get_feature_names_out([f['name'] for f in features])
    return {'method':method,'values':[{'feature':str(names[i]),'importance':float(values[i])} for i in np.argsort(values)[::-1][:20]]}

def save_model(folder,experiment,algorithm,pipe,features,metrics,selected,selection,hyperparameters,configuration,extra=None):
    identifier=str(uuid4());path=Path(folder)/(identifier+'.joblib')
    bundle={'pipeline':pipe,'features':features,'task':configuration['task'],'versions':versions(),'configuration':configuration,'extra':extra or {}}
    joblib.dump(bundle,path,compress=3)
    if path.stat().st_size>20*1024*1024:path.unlink();raise MLFailure('Model exceeds 20 MiB artifact limit.','artifact_limit')
    path.chmod(0o600)
    return {'id':identifier,'experiment_id':experiment['id'],'dataset_id':experiment['dataset_id'],'dataset_fingerprint':experiment['dataset_fingerprint'],
            'algorithm':algorithm,'task':configuration['task'],'created_at':datetime.now(timezone.utc).isoformat(),'hyperparameters':hyperparameters,'metrics':metrics,'feature_schema':features,
            'selected':selected,'selection_metric':selection,'artifact_path':'automl/models/'+path.name,'artifact_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'versions':versions(),'configuration':configuration}

def train_supervised(data,cfg,experiment,folder):
    profile=validate_features(data,cfg);warnings=list(profile['readiness']['warnings']);target=data['columns'].index(cfg['target'])
    rows=[i for i,r in enumerate(data['rows']) if not missing(r[target])]
    if len(rows)<60:raise MLFailure('At least 60 labeled rows are required after excluding missing targets.')
    x=feature_array(data,cfg['features'])[rows]
    y=np.array([number(data['rows'][i][target]) for i in rows]) if cfg['task']=='regression' else np.array([str(data['rows'][i][target]) for i in rows])
    if len(np.unique(y))<2:raise MLFailure('Target has fewer than two distinct values.')
    tr,va,te,groups=supervised_split(x,y,cfg['task'],cfg['seed'],cfg['features'])
    if len(rows)<len(data['rows']):warnings.append(f'{len(data["rows"])-len(rows)} rows with missing target excluded before splitting.')
    seed=cfg['seed']
    if cfg['task']=='regression':
        algorithms=[('DummyRegressor',DummyRegressor(strategy='mean')),('LinearRegression',LinearRegression()),('Ridge',Ridge(alpha=1)),('RandomForestRegressor',RandomForestRegressor(n_estimators=40,max_depth=8,min_samples_leaf=2,n_jobs=1,random_state=seed)),('HistGradientBoostingRegressor',HistGradientBoostingRegressor(max_iter=60,max_leaf_nodes=15,early_stopping=False,random_state=seed))]
        score='rmse';lower=True
    else:
        counts=Counter(y[tr]);ratio=max(counts.values())/min(counts.values())
        if ratio>3:warnings.append('Class imbalance observed. Balanced class weights are used where supported; macro F1 selects the model.')
        algorithms=[('DummyClassifier',DummyClassifier(strategy='prior',random_state=seed)),('LogisticRegression',LogisticRegression(max_iter=300,class_weight='balanced',random_state=seed)),('RandomForestClassifier',RandomForestClassifier(n_estimators=40,max_depth=8,min_samples_leaf=2,class_weight='balanced',n_jobs=1,random_state=seed)),('HistGradientBoostingClassifier',HistGradientBoostingClassifier(max_iter=60,max_leaf_nodes=15,early_stopping=False,class_weight='balanced',random_state=seed))]
        score='f1_macro';lower=False
    fitted=[];leaderboard=[]
    for name,estimator in algorithms:
        pipe=Pipeline([('prepare',preprocessor(cfg['features'],cfg['scaler'])),('model',estimator)]);started=time.monotonic()
        try:
            # No fitting/selection observes validation or test transformations.
            pipe.fit(x[tr],y[tr]);width=pipe.named_steps['prepare'].transform(x[tr[:1]]).shape[1]
            if width>512:raise MLFailure('Encoded width exceeds 512 features. Reduce selected features/categories.','feature_limit')
            train_pred=pipe.predict(x[tr]);val_pred=pipe.predict(x[va])
            calc=lambda ids,p:reg_metrics(y[ids],p) if cfg['task']=='regression' else cls_metrics(y[ids],p,pipe,x[ids])
            record={'algorithm':name,'status':'completed','training_metrics':calc(tr,train_pred),'validation_metrics':calc(va,val_pred),'test_metrics':None,'fit_seconds':round(time.monotonic()-started,4),'selected':False,'model_id':None}
            fitted.append((pipe,record,estimator));leaderboard.append(record)
        except (ValueError,FloatingPointError) as exc:
            leaderboard.append({'algorithm':name,'status':'failed','error':str(exc)[:200] if isinstance(exc,MLFailure) else 'Algorithm could not fit the confirmed feature/target shape.','training_metrics':None,'validation_metrics':None,'test_metrics':None,'fit_seconds':round(time.monotonic()-started,4),'selected':False,'model_id':None})
    if not fitted:raise MLFailure('No candidate fitted this dataset.')
    chosen=min(fitted,key=lambda p:p[1]['validation_metrics'][score]) if lower else max(fitted,key=lambda p:p[1]['validation_metrics'][score])
    winner,record,_=chosen;record['selected']=True;pred=winner.predict(x[te]);record['test_metrics']=reg_metrics(y[te],pred) if cfg['task']=='regression' else cls_metrics(y[te],pred,winner,x[te])
    models=[]
    for pipe,r,estimator in fitted:
        params={k:v for k,v in estimator.get_params().items() if isinstance(v,(str,int,float,bool,type(None)))}
        model=save_model(folder,experiment,r['algorithm'],pipe,cfg['features'],{'training':r['training_metrics'],'validation':r['validation_metrics'],'test':r['test_metrics']},r['selected'],'validation '+score,params,cfg)
        r['model_id']=model['id'];models.append(model)
    plots={};details={}
    if cfg['task']=='regression':plots['regression']=[{'row_index':rows[int(i)],'actual':float(y[i]),'predicted':float(p),'residual':float(y[i]-p)} for i,p in zip(te[:200],pred[:200])]
    else:
        labels=winner.classes_.tolist();details={'labels':labels,'confusion_matrix':confusion_matrix(y[te],pred,labels=labels).tolist(),'averaging':'Macro precision/recall/F1; zero division contributes 0.','roc_auc_note':'ROC-AUC is unmeasured when the held-out split lacks classes or probabilities are undefined.'}
        plots['classification']=[{'class':str(c),'actual':int(sum(y[te]==c)),'predicted':int(sum(pred==c))} for c in labels]
    split={name:{'count':len(ids),'row_indices':[rows[int(i)] for i in ids],'groups_hash':hashlib.sha256('|'.join(sorted(set(groups[ids]))).encode()).hexdigest()} for name,ids in [('train',tr),('validation',va),('test',te)]}
    return {'leaderboard':leaderboard,'models':models,'selected_model_id':record['model_id'],'selection_metric':score,'selection_split':'validation','split':split,'plots':plots,'details':details,'feature_importance':importance(winner,cfg['features']),
            'rows_used':len(rows),'warnings':warnings,'scope':'Model selection uses validation only. Selected model is evaluated once on untouched test rows; other test metrics are unmeasured. Pipelines remain fitted on training rows only.'}

def rfm_data(data,cfg):
    spec=cfg['rfm'];cols=data['columns']
    for key in ('customer','date','amount'):
        if spec[key] not in cols:raise MLFailure('RFM mapping references a missing column.')
    if spec.get('order') and spec['order'] not in cols:raise MLFailure('RFM order column is unavailable.')
    indices={k:cols.index(v) for k,v in spec.items() if k in {'customer','date','amount','order'} and v}
    customers={};latest=None
    for row in data['rows']:
        if any(missing(row[indices[k]]) for k in ('customer','date','amount')):raise MLFailure('RFM requires nonmissing customer/date/amount for every included row.')
        try:d=moment(row[indices['date']]);amount=number(row[indices['amount']])
        except (ValueError,TypeError,OverflowError):raise MLFailure('RFM dates/amounts must validate as ISO dates and finite numeric values.')
        customer=str(row[indices['customer']]);entry=customers.setdefault(customer,{'date':d,'frequency':0,'monetary':0,'orders':set()})
        entry['date']=max(entry['date'],d);entry['frequency']+=1;entry['monetary']+=amount
        if 'order' in indices:
            if missing(row[indices['order']]):raise MLFailure('RFM order IDs cannot be missing.')
            entry['orders'].add(str(row[indices['order']]))
        latest=d if latest is None else max(latest,d)
    reference=moment(spec['reference_date']) if spec.get('reference_date') else latest+timedelta(days=1)
    if reference<latest:raise MLFailure('RFM reference date must be at or after the latest included transaction.')
    rows=[[str(customer),max(0,(reference-e['date']).total_seconds()/86400),len(e['orders']) if 'order' in indices else e['frequency'],e['monetary']] for customer,e in sorted(customers.items())]
    return {'columns':['customer','recency_days','frequency','monetary'],'rows':rows,'total_rows':len(rows),'dataset_id':data['dataset_id'],'dataset_name':data['dataset_name'],'fingerprint':data['fingerprint']},[{'name':n,'kind':'numeric'} for n in ['recency_days','frequency','monetary']],{'reference_date':reference.isoformat(),'frequency_definition':'Distinct order IDs per customer' if 'order' in indices else 'Transaction row count per customer','scope':'One row per customer. Identifiers are labels only; no held-out predictive accuracy is claimed.'}

def train_unsupervised(data,cfg,experiment,folder):
    p=validate_features(data,cfg);features=cfg['features'];extra={};labels=None
    if cfg.get('rfm'):
        data,features,extra=rfm_data(data,cfg);labels=[r[0] for r in data['rows']]
    if len(data['rows'])<(12 if cfg['task']=='clustering' else 20):raise MLFailure('Insufficient rows/customers for unsupervised analysis.')
    x=feature_array(data,features)
    if len({json.dumps(r.tolist(),default=str) for r in x})<cfg['clusters'] and cfg['task']=='clustering':raise MLFailure('Fewer distinct feature rows than requested clusters.')
    estimator=KMeans(n_clusters=cfg['clusters'],n_init=10,max_iter=150,random_state=cfg['seed']) if cfg['task']=='clustering' else IsolationForest(n_estimators=60,max_samples=min(256,len(x)),contamination=cfg['contamination'],n_jobs=1,random_state=cfg['seed'])
    started=time.monotonic();pipe=Pipeline([('prepare',preprocessor(features,cfg['scaler'])),('model',estimator)]);pipe.fit(x)
    z=pipe.named_steps['prepare'].transform(x)
    if z.shape[1]>512:raise MLFailure('Encoded width exceeds 512.','feature_limit')
    assignments=pipe.predict(x);metrics={};details={**extra};plots={}
    if cfg['task']=='clustering':
        unique=set(assignments);sil=float(silhouette_score(z,assignments,sample_size=min(len(z),1000),random_state=cfg['seed'])) if 1<len(unique)<len(z) else None
        metrics={'silhouette':sil};profiles=[]
        for cluster in sorted(unique):
            ids=np.flatnonzero(assignments==cluster);profile={'cluster':int(cluster),'count':len(ids),'features':{}}
            for j,f in enumerate(features):
                raw=[x[i,j] for i in ids if not missing(x[i,j])]
                profile['features'][f['name']]=float(np.mean([number(v) for v in raw])) if f['kind']=='numeric' and raw else Counter(map(str,raw)).most_common(1)[0][0] if raw else None
            profiles.append(profile)
        components=min(2,z.shape[1],z.shape[0]);pca=PCA(n_components=components,random_state=cfg['seed']);coords=pca.fit_transform(z)
        details.update(cluster_profiles=profiles,pca_explained_variance=pca.explained_variance_ratio_.tolist(),pca_note='PCA components are projections of transformed features, not original business variables.',descriptive_only=True)
        extra.update(cluster_profiles=profiles,pca=pca)
        plots['clusters']=[{'x':float(v[0]),'y':float(v[1]) if components>1 else 0,'cluster':int(assignments[i]),'entity':labels[i] if labels else str(i)} for i,v in enumerate(coords[:500])]
        scope='Descriptive clustering on fitted data. Silhouette is internal separation, not prediction accuracy.'
    else:
        scores=-pipe.decision_function(x);flags=assignments==-1;metrics={'flagged_count':int(flags.sum()),'flagged_fraction':float(flags.mean())}
        details.update(score_definition='Negative decision_function; higher values are more unusual; values above zero are flagged.',fraud_accuracy=None)
        plots['anomalies']=[{'row_index':i,'score':float(scores[i]),'anomaly':bool(flags[i]),'features':{f['name']:None if missing(x[i,j]) else number(x[i,j]) for j,f in enumerate(features)}} for i in sorted(range(len(x)),key=lambda j:float(scores[j]),reverse=True)[:500]]
        counts,edges=np.histogram(scores,bins=20)
        flagged,_=np.histogram(scores[flags],bins=edges)
        plots['anomaly_distribution']=[{'lower':float(edges[i]),'upper':float(edges[i+1]),'count':int(counts[i]),'flagged':int(flagged[i])} for i in range(len(counts))]
        scope='Unsupervised anomaly flags are not ground-truth fraud labels. No fraud accuracy is measured.'
    algorithm=type(estimator).__name__;record={'algorithm':algorithm,'status':'completed','training_metrics':metrics,'validation_metrics':None,'test_metrics':None,'fit_seconds':round(time.monotonic()-started,4),'selected':True,'model_id':None}
    params={k:v for k,v in estimator.get_params().items() if isinstance(v,(str,int,float,bool,type(None)))}
    model=save_model(folder,experiment,algorithm,pipe,features,{'descriptive':metrics},True,'fixed configured algorithm; descriptive metrics only',params,cfg,extra);record['model_id']=model['id']
    return {'leaderboard':[record],'models':[model],'selected_model_id':model['id'],'selection_metric':'Configured algorithm','selection_split':'descriptive','split':{'fitted_rows':len(x),'held_out':False},'rows_used':len(x),'plots':plots,'details':details,'warnings':p['readiness']['warnings'],'scope':scope,'feature_importance':{'method':'Unavailable; inspect actual feature profiles/context.','values':[]}}
