"""Chronological local forecasting with past-only lags and untouched final holdout."""
from collections import defaultdict
from datetime import datetime,timedelta
import time
import numpy as np
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge
from .data import number,moment,missing,MLFailure
from .engine import save_model


def bucket(d,frequency):
    d=d.replace(hour=0,minute=0,second=0,microsecond=0)
    return d if frequency=='day' else d-timedelta(days=d.weekday()) if frequency=='week' else d.replace(day=1)
def next_period(d,frequency):
    if frequency=='day':return d+timedelta(days=1)
    if frequency=='week':return d+timedelta(days=7)
    return datetime(d.year+int(d.month==12),1 if d.month==12 else d.month+1,1)

def aggregate(data,spec):
    for key in ('date_column','measure'):
        if spec[key] not in data['columns']:raise MLFailure('Forecast configuration references a missing column.')
    di=data['columns'].index(spec['date_column']);mi=data['columns'].index(spec['measure']);totals=defaultdict(float)
    for row in data['rows']:
        if missing(row[di]) or missing(row[mi]):raise MLFailure('Forecast dates and measures must be nonmissing; clean or filter the registered data explicitly.')
        try:d=bucket(moment(row[di]),spec['frequency']);value=number(row[mi])
        except (ValueError,TypeError,OverflowError):raise MLFailure('Forecast dates must be ISO date/time and measures finite numbers.')
        totals[d]+=value
    if not totals:raise MLFailure('No dated observations to forecast.')
    dates=[];values=[];imputed=[];d=min(totals);end=max(totals)
    while d<=end:
        if len(dates)>=1200:raise MLFailure('Maximum 1200 aggregated periods; choose a coarser frequency.','period_limit')
        if d not in totals:
            if spec['missing_periods']=='error':raise MLFailure('Missing time periods detected. Explicitly choose zero-fill or past-only forward-fill.')
            value=0.0 if spec['missing_periods']=='zero' else values[-1];imputed.append(d.isoformat()[:10])
        else:value=totals[d]
        dates.append(d);values.append(value);d=next_period(d,spec['frequency'])
    return dates,np.array(values,dtype=float),imputed

class ForecastModel:
    def __init__(self,algorithm,season=7):self.algorithm=algorithm;self.season=season
    def fit(self,values):
        self.history_=np.asarray(values,dtype=float).tolist();self.lags_=max(3,self.season)
        if self.algorithm=='LagRidge':
            x=[];y=[]
            for i in range(self.lags_,len(values)):
                x.append(self.vector(self.history_[:i]));y.append(values[i])
            if len(y)<10:raise MLFailure('Insufficient history for lag regression.')
            self.pipeline_=Pipeline([('scale',StandardScaler()),('model',Ridge(alpha=1))]).fit(x,y)
        return self
    def vector(self,past):return [past[-j] for j in range(1,self.lags_+1)]+[float(np.mean(past[-3:])),float(np.mean(past[-self.lags_:]))]
    def forecast(self,horizon):
        history=list(self.history_);pred=[]
        for i in range(horizon):
            value=history[-1] if self.algorithm=='Naive' else history[-self.season] if self.algorithm=='SeasonalNaive' else float(self.pipeline_.predict([self.vector(history)])[0])
            if not np.isfinite(value):raise MLFailure('Forecast became nonfinite; use a stable baseline.')
            history.append(value);pred.append(value)
        return np.asarray(pred)

def metrics(y,p):
    errors=np.abs(y-p);den=float(np.abs(y).sum())
    return {'mae':float(errors.mean()),'rmse':float(np.sqrt(np.mean((y-p)**2))),'wape':float(errors.sum()/den) if den else None}

def train_forecast(data,cfg,experiment,folder):
    spec=cfg['forecast'];dates,values,imputed=aggregate(data,spec);h=spec['horizon'];n=len(values);season=spec['seasonal_period']
    max_h=min(30,max(0,(n-12)//3))
    if h>max_h:raise MLFailure(f'Only {n} periods available. Three chronological holdout windows require at least 12 earlier periods. Maximum horizon is {max_h}; use more history or a smaller horizon.')
    cutoffs=[n-3*h,n-2*h,n-h];names=['Naive']
    if cutoffs[0]>=2*season:names.append('SeasonalNaive')
    if cutoffs[0]>=max(30,3*season):names.append('LagRidge')
    leaderboard=[];backtests=[];began=time.monotonic()
    for name in names:
        actual=[];predicted=[];started=time.monotonic()
        for fold,cut in enumerate(cutoffs[:2]):
            model=ForecastModel(name,season).fit(values[:cut]);p=model.forecast(h);y=values[cut:cut+h]
            actual.extend(y);predicted.extend(p)
            backtests.append({'algorithm':name,'fold':fold+1,'scope':'selection validation','train_end':dates[cut-1].isoformat()[:10],'evaluation_start':dates[cut].isoformat()[:10],'evaluation_end':dates[cut+h-1].isoformat()[:10],
                              'train_count':cut,'horizon':h,'metrics':metrics(y,p)})
        leaderboard.append({'algorithm':name,'status':'completed','training_metrics':None,'validation_metrics':metrics(np.asarray(actual),np.asarray(predicted)),'test_metrics':None,'selected':False,'model_id':None,'fit_seconds':round(time.monotonic()-started,4)})
    winner=min(leaderboard,key=lambda r:r['validation_metrics']['rmse']);winner['selected']=True
    cut=cutoffs[-1];test=ForecastModel(winner['algorithm'],season).fit(values[:cut]);prediction=test.forecast(h);winner['test_metrics']=metrics(values[cut:],prediction)
    test_rows=[{'date':dates[cut+i].isoformat()[:10],'actual':float(y),'predicted':float(prediction[i])} for i,y in enumerate(values[cut:])]
    models=[];future=None
    for row in leaderboard:
        final=ForecastModel(row['algorithm'],season).fit(values)
        extra={'last_date':dates[-1].isoformat(),'frequency':spec['frequency'],'max_horizon':h,'refit_scope':'Full observed history after selection/test scores were frozen.'}
        model=save_model(folder,experiment,row['algorithm'],final,[],{'validation_backtests':row['validation_metrics'],'test':row['test_metrics']},row['selected'],'validation backtest rmse',{'seasonal_period':season,'horizon':h,'ridge_alpha':1 if row['algorithm']=='LagRidge' else None},cfg,extra)
        row['model_id']=model['id'];models.append(model)
        if row['selected']:future=final.forecast(h)
    future_dates=[];d=dates[-1]
    for _ in range(h):d=next_period(d,spec['frequency']);future_dates.append(d)
    series=[{'date':d.isoformat()[:10],'actual':float(y),'forecast':None} for d,y in zip(dates,values)]
    series.extend({'date':d.isoformat()[:10],'actual':None,'forecast':float(y)} for d,y in zip(future_dates,future))
    warning=['No intervals are estimated. Forecasts are point predictions; backtests do not guarantee future accuracy.']
    if imputed:warning.append(f'{len(imputed)} missing periods filled by explicit {spec["missing_periods"]} policy.')
    if 'SeasonalNaive' not in names:warning.append('Seasonal baseline omitted: insufficient training history for two seasonal cycles.')
    if 'LagRidge' not in names:warning.append('Lag regression omitted: insufficient initial backtest training history.')
    return {'leaderboard':leaderboard,'models':models,'selected_model_id':winner['model_id'],'selection_metric':'rmse','selection_split':'earlier chronological backtests',
            'split':{'method':'chronological expanding windows','validation_origins':cutoffs[:2],'test_origin':cutoffs[-1],'horizon':h,'test_never_used_for_selection':True},
            'rows_used':n,'plots':{'forecast':series,'backtest':test_rows},'details':{'backtests':backtests,'missing_periods':imputed,'frequency':spec['frequency'],'measure':spec['measure'],'max_supported_horizon':max_h,'artifact_refit_scope':'full history after evaluation','wape_definition':'Sum absolute errors / sum absolute actuals; undefined when actual denominator is zero.'},
            'warnings':warning,'scope':'Selection uses two earlier expanding-window backtests. Only the selected model receives a final chronological test. Deployment artifacts refit on all observed history afterward. No random split or future rolling values.',
            'feature_importance':{'method':'Lag/rolling features use past observations only; no causal importance claim.','values':[]}}
