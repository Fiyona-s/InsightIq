"""Persisted operational outcomes, explicitly separate from benchmark correctness."""
import json
from collections import Counter
from datetime import datetime
from typing import Optional
from uuid import UUID
from fastapi import APIRouter,Query,HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session


def percentile(values,p):
    values=sorted(values)
    if not values:return None
    x=(len(values)-1)*p;i=int(x)
    return values[i]+(values[min(i+1,len(values)-1)]-values[i])*(x-i)


def measured_summary(runs):
    total=len(runs);success=sum(r['status']=='succeeded' for r in runs)
    lat=[r.get('metrics',{}).get('total_latency_ms') for r in runs];lat=[v for v in lat if isinstance(v,(int,float))]
    retrieval=[r.get('metrics',{}).get('retrieval_latency_ms') for r in runs];retrieval=[v for v in retrieval if isinstance(v,(int,float))]
    def known_sum(key):
        vals=[r.get('metrics',{}).get(key) for r in runs]
        return {'known_sum':sum(v for v in vals if v is not None),'known_records':sum(v is not None for v in vals),'unknown_records':sum(v is None for v in vals)}
    return {'total_questions':total,'succeeded':success,'failed':sum(r['status']=='failed' for r in runs),
        'execution_success_rate':success/total if total else None,'correctness':'Not measured for normal user activity.',
        'validation_failures':sum((r.get('error_code')=='validation_error' or any(e.get('step')=='validate' and e.get('status')=='rejected' for e in r.get('events',[]))) for r in runs),
        'attempts':dict(Counter(str(r.get('attempts',0)) for r in runs)),
        'latency_ms':{'average':sum(lat)/len(lat) if lat else None,'p50':percentile(lat,.5),'p95':percentile(lat,.95),'measured_records':len(lat)},
        'retrieval_latency_ms':{'average':sum(retrieval)/len(retrieval) if retrieval else None,'measured_records':len(retrieval)},
        'tokens':known_sum('total_tokens'),'cost_usd':known_sum('estimated_cost_usd'),
        'error_categories':dict(Counter(r.get('error_code') or r['status'] for r in runs if r['status']!='succeeded'))}


# The few fields a list of recent questions needs (Home asks for this form: a smaller answer on a phone connection).
COMPACT_KEYS=('id','question','status','created_at','dataset_id','dataset_name','activity_kind','thread_id','error_code')


class ObservabilityService:
    def __init__(self,analyst):self.analyst=analyst
    def query(self,dataset_id=None,model=None,status=None,start=None,end=None,search='',recent=100,compact=False):
        try:
            for date in (start,end):
                if date:datetime.fromisoformat(date)
        except ValueError:raise HTTPException(422,'Use ISO date bounds.')
        with Session(self.analyst.engine) as session:
            statement=select(self.analyst.Run).order_by(self.analyst.Run.created_at.desc()).limit(10000)
            if dataset_id:statement=statement.where(self.analyst.Run.dataset_id==str(dataset_id))
            if getattr(self.analyst,'projects',None):statement=statement.where(self.analyst.projects.dataset_clause(self.analyst.Run.dataset_id))
            runs=[json.loads(r.payload) for r in session.scalars(statement)]
        runs=[r for r in runs if not r.get('activity_kind')=='evaluation' and (not model or r.get('metrics',{}).get('model')==model) and (not status or r['status']==status)
            and (not start or r['created_at'][:10]>=start[:10]) and (not end or r['created_at'][:10]<=end[:10]) and search.casefold() in r['question'].casefold()]
        with Session(self.analyst.engine) as session:
            feedback=list(session.scalars(select(self.analyst.ux.Feedback).where(self.analyst.ux.Feedback.run_id.in_([r['id'] for r in runs]))))
        feedback_counts={rating:sum(r.rating==rating for r in feedback) for rating in ('helpful','not_helpful')}
        return {'feedback_counts':feedback_counts,**measured_summary(runs),'coverage':'Latest 10,000 matching dataset run records; normal activity only. Evaluation accuracy is separate.',
                'recent':[({k:r.get(k) for k in COMPACT_KEYS} if compact else {k:v for k,v in r.items() if k!='_model_calls'}) for r in runs[:recent]],'models':sorted({r.get('metrics',{}).get('model') for r in runs if r.get('metrics',{}).get('model')})}
    def router(self):
        router=APIRouter(prefix='/api',tags=['Run analytics'])
        @router.get('/analytics/runs')
        def analytics(dataset_id:Optional[UUID]=None,model:Optional[str]=Query(None,max_length=120),status:Optional[str]=Query(None,max_length=30),start:Optional[str]=None,end:Optional[str]=None,search:str=Query('',max_length=200),limit:int=Query(100,ge=1,le=100),compact:bool=False):
            return self.query(dataset_id,model,status,start,end,search,limit,compact)
        return router
