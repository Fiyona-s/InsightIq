from datetime import date
"""Explicitly saved, bounded snapshots and dashboard layout persistence."""
import copy,csv,io,json,threading
from typing import List,Literal,Optional
from uuid import UUID,uuid4
from fastapi import APIRouter,HTTPException
from fastapi.responses import Response
from pydantic import BaseModel,ConfigDict,Field,field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from .charts import ChartSpec,chart_options,validate_chart
from .evidence import compute_evidence
from .filters import ResultFilter,filter_rows
from .execution import execute_isolated,ExecutionError
from .sql_guard import validate_sql,GuardError
from .knowledge import digest
from .persistence import utcnow
from .contracts import DashboardView,DashboardSummary,SavedChartInfo,SavedChartRecord


class DashboardCreate(BaseModel):
    @field_validator('title')
    @classmethod
    def valid_title(cls, value):
        from .dashboard_workspace import title
        return title(value)

    model_config=ConfigDict(extra='forbid')
    title:str=Field(min_length=1,max_length=120)
    description:str=Field(default='',max_length=2000)


class WidgetInput(BaseModel):
    @field_validator('custom_title')
    @classmethod
    def valid_custom_title(cls, value):
        from .dashboard_workspace import title
        return title(value) if value is not None else None

    model_config=ConfigDict(extra='forbid')
    id:UUID=Field(default_factory=uuid4)
    chart_id:Optional[UUID]=None
    kind:Literal['chart','text']='chart'
    title:str=Field(default='',max_length=120)
    custom_title:Optional[str]=None
    text:str=Field(default='',max_length=2000)
    spec:Optional[ChartSpec]=None
    filters:List[ResultFilter]=Field(default_factory=list,max_length=12)
    width:int=Field(default=6,ge=3,le=12)
    height:int=Field(default=4,ge=2,le=8)


class DashboardUpdate(DashboardCreate):
    revision:int=Field(ge=1)
    filters:List[ResultFilter]=Field(default_factory=list,max_length=12)
    widgets:List[WidgetInput]=Field(default_factory=list,max_length=24)


class SaveChart(BaseModel):
    model_config=ConfigDict(extra='forbid')
    run_id:UUID
    title:str=Field(min_length=1,max_length=120)
    spec:Optional[ChartSpec]=None
    refresh_policy:Literal['snapshot','manual']='snapshot'
    persist_snapshot_confirmed:Literal[True]


class ConfirmCurrencyMetadata(BaseModel):
    model_config=ConfigDict(extra='forbid')
    expected_snapshot_digest:str=Field(pattern=r'^[0-9a-f]{64}$')


class DocumentStore:
    def __init__(self,engine,models):self.engine,self.models=engine,models
    def get(self,kind,identifier):
        with Session(self.engine) as session:
            row=session.get(self.models[kind],str(identifier))
            if row is None:raise HTTPException(404,kind+' not found.')
            return json.loads(row.payload)
    def list(self,kind,limit=100):
        with Session(self.engine) as session:
            return [json.loads(r.payload) for r in session.scalars(select(self.models[kind]).order_by(self.models[kind].updated_at.desc()).limit(limit))]
    def save(self,kind,data):
        encoded=json.dumps(data,allow_nan=False)
        if len(encoded.encode())>2*1024*1024:raise HTTPException(413,'Saved document exceeds 2 MiB.')
        with Session(self.engine) as session:
            row=session.get(self.models[kind],data['id'])
            if row is None:row=self.models[kind](id=data['id']);session.add(row)
            row.payload,row.updated_at,row.dataset_id=encoded,data.get('updated_at',utcnow()),data.get('dataset_id')
            session.commit()
        return data
    def delete(self,kind,identifier):
        with Session(self.engine) as session:
            row=session.get(self.models[kind],str(identifier))
            if row is None:raise HTTPException(404,kind+' not found.')
            session.delete(row);session.commit()


def safe_csv(result):
    def safe(v):return "'"+v if isinstance(v,str) and v.lstrip().startswith(('=','+','-','@','\t','\r','\n')) else v
    stream=io.StringIO(newline='');writer=csv.writer(stream)
    writer.writerow([safe(c['name']) for c in result['columns']]);writer.writerows([[safe(v) for v in row] for row in result['rows']]);return stream.getvalue()


class DashboardService:
    def __init__(self,analyst,store):self.analyst,self.store=analyst,store;self.lock=threading.RLock();self.report_slots=threading.BoundedSemaphore(2)
    def schema_signature(self,dataset_id):
        profile=self.analyst.knowledge.profile(dataset_id)
        return digest([{'name':c['name'],'type':c['storage_type']} for c in profile['columns']]),profile
    def create(self,body):
        with self.lock:
            if len(self.store.list('Dashboard'))>=50:raise HTTPException(409,'Maximum 50 dashboards.')
            time=utcnow();data={'id':str(uuid4()),'title':body.title.strip() or 'Untitled dashboard','description':body.description,
                'created_at':time,'updated_at':time,'revision':1,'filters':[],'widgets':[]}
            saved=self.store.save('Dashboard',data)
            if getattr(self,'projects',None):self.projects.assign('dashboard',saved['id'])
            return saved
    def update(self,identifier,body):
        with self.lock:
            data=self.store.get('Dashboard',identifier)
            if data['revision']!=body.revision:raise HTTPException(409,'Dashboard changed. Reload before saving.')
            if len({str(w.id) for w in body.widgets})!=len(body.widgets):raise HTTPException(422,'Widget IDs must be unique.')
            existing={w['id']:w for w in data['widgets']}
            for w in body.widgets:
                old=existing.get(str(w.id))
                if old and old['kind']=='chart' and w.title!=old['title']:raise HTTPException(409,'Use the widget title override; the original generated title is retained.')
                if old and 'custom_title' not in w.model_fields_set:w.custom_title=old.get('custom_title')
                if old and str(w.chart_id)!=str(old.get('chart_id')):
                    self.store.get('SavedChart',w.chart_id)
                    raise HTTPException(409,'Use the confirmed replacement action to keep the previous snapshot.')
                if w.kind=='chart':
                    if w.chart_id is None:raise HTTPException(422,'Chart widgets require a saved chart.')
                    chart=self.store.get('SavedChart',w.chart_id)
                    if w.spec:
                        try:validate_chart(w.spec,filter_rows(chart['snapshot'],[f.model_dump() for f in body.filters+w.filters])[0])
                        except ValueError as exc:raise HTTPException(422,str(exc))
                elif w.chart_id is not None:raise HTTPException(422,'Text cards cannot reference a chart.')
            data.update(body.model_dump(mode='json'));data['revision']+=1;data['updated_at']=utcnow()
            return self.store.save('Dashboard',data)
    def save_chart(self,body):
        with self.lock,self.analyst.knowledge.lock:
            if len(self.store.list('SavedChart'))>=100:raise HTTPException(409,'Maximum 100 saved charts.')
            run=self.analyst.load(body.run_id)
            if run['status']!='succeeded':raise HTTPException(422,'Save charts only from successful runs.')
            _,result=self.analyst.result(body.run_id)
            snapshot={key:copy.deepcopy(result[key]) for key in ('columns','rows','row_count')}
            spec=body.spec or ChartSpec.model_validate(chart_options(snapshot)['recommended']['spec'])
            try:validate_chart(spec,snapshot)
            except ValueError as exc:raise HTTPException(422,str(exc))
            signature,_=self.schema_signature(run['dataset_id']);time=utcnow()
            data={'id':str(uuid4()),'title':body.title,'dataset_id':run['dataset_id'],'dataset_name':run['dataset_name'],
                  'source_run_id':run['id'],'question':run['question'],'sql':run['executed_sql'],'type_mapping':run['type_mapping'],
                  'schema_signature':signature,'spec':spec.model_dump(),'refresh_policy':body.refresh_policy,
                  'created_at':time,'updated_at':time,'last_successful_refresh':time,'error':None,'status':'snapshot',
                  'data_as_of':run.get('completed_at') or time,'source_revision':copy.deepcopy(result.get('source_revision')),'refreshed_at':None,'result_hash':digest(snapshot),
                  'snapshot':snapshot,'summary':copy.deepcopy(result.get('analysis',{}).get('narrative',[])),
                  'narrative_source':result.get('analysis',{}).get('narrative_source','computed')}
            return self.store.save('SavedChart',data)
    @staticmethod
    def snapshot_digest(chart):
        return digest({'snapshot':chart['snapshot'],'sql':chart['sql']})

    def info(self,chart):
        return {**{k:v for k,v in chart.items() if k!='snapshot'},'source_revision':chart.get('source_revision'),
            'data_as_of':chart.get('data_as_of'),'refreshed_at':chart.get('refreshed_at'),
            'result_hash':chart.get('result_hash') or digest(chart['snapshot']),'snapshot_digest':self.snapshot_digest(chart)}

    @staticmethod
    def display_snapshot(chart):
        # Display metadata is separate from immutable original SQL snapshot columns/rows.
        result=copy.deepcopy(chart['snapshot'])
        for key,money in chart.get('currency_metadata',{}).items():
            index=int(key)
            if 0<=index<len(result['columns']) and not (result['columns'][index].get('money') or {}).get('currency') and not (result['columns'][index].get('money') or {}).get('mixed'):
                result['columns'][index]['money']=copy.deepcopy(money)
        return result

    def currency_candidates(self,chart):
        from .currency import annotate,mixed_aggregate
        # Current definitions suggest an explicit repair; GET never writes or backfills.
        settings=self.analyst.knowledge.sync(chart['dataset_id'])[3]
        if mixed_aggregate(chart['sql'],settings):
            return {},settings
        annotated=annotate(chart['sql'],chart['snapshot']['columns'],settings)
        existing=self.display_snapshot(chart)['columns']
        return {str(i):c['money'] for i,c in enumerate(annotated)
                if (c.get('money') or {}).get('currency') and not c['money'].get('mixed') and not (existing[i].get('money') or {}).get('currency') and not (existing[i].get('money') or {}).get('mixed')},settings

    def confirm_currency_metadata(self,identifier,body):
        with self.lock,self.analyst.knowledge.lock:
            chart=self.store.get('SavedChart',identifier)
            if self.snapshot_digest(chart)!=body.expected_snapshot_digest:
                raise HTTPException(409,'Snapshot changed. Reload before applying currency metadata.')
            signature,_=self.schema_signature(chart['dataset_id'])
            if signature!=chart['schema_signature']:
                raise HTTPException(409,'Source schema changed. Confirm the historical currency explicitly before reusing this snapshot.')
            additions,settings=self.currency_candidates(chart)
            if not additions:
                raise HTTPException(422,'No missing confirmed source currencies. Confirm monetary columns in Knowledge base first.')
            chart['currency_metadata']={**chart.get('currency_metadata',{}),**additions}
            chart['currency_metadata_provenance']={'source':'confirmed_dataset_metadata','dataset_id':chart['dataset_id'],
                'settings_digest':digest(settings.model_dump()),'snapshot_digest':body.expected_snapshot_digest,'confirmed_at':utcnow()}
            chart['updated_at']=utcnow()
            self.store.save('SavedChart',chart)
            return self.info(chart)

    def refresh(self,identifier):
        # Legacy explicit manual-refresh API remains available, with retained history.
        with self.workspace.lifecycle.admission_lock,self.lock,self.analyst.knowledge.lock:
            data=self.store.get('SavedChart',identifier)
            if data['refresh_policy']!='manual':raise HTTPException(409,'This is a saved snapshot; use the confirmed widget refresh action.')
            if not self.analyst.slots.acquire(False):raise HTTPException(429,'Query execution slots are busy.')
            try:
                self.analyst.get_item(data['dataset_id'])
                current=self.workspace.execute(data)
                with Session(self.store.engine) as session:
                    self.workspace.retain(session,'library:'+str(identifier),identifier,data,current,'manual library refresh')
                    row=session.get(self.store.models['SavedChart'],str(identifier));row.payload=json.dumps(current);row.updated_at=current['updated_at']
                    self.workspace.audit(session,current,'library:'+str(identifier),identifier,'success');session.commit()
                return current
            except (HTTPException,ExecutionError,GuardError) as exc:
                detail=exc.detail if isinstance(exc,HTTPException) else str(exc)
                data.update(status='refresh_failed',error=detail,updated_at=utcnow())
                self.store.save('SavedChart',data)
                raise HTTPException(exc.status_code if isinstance(exc,HTTPException) else 422,detail) from exc
            finally:self.analyst.slots.release()
    def view(self,identifier):
        data=self.store.get('Dashboard',identifier);widgets=[];currency_candidates={}
        from .dashboard_workspace import readable, duplicate_key
        matches={}
        for w in data['widgets']:
            if w['kind']=='chart':
                try:
                    chart=self.workspace.effective(identifier,w)
                    matches.setdefault(duplicate_key(chart,w.get('spec')),[]).append(w['id'])
                except HTTPException:pass
        for widget in data['widgets']:
            view=copy.deepcopy(widget)
            if widget['kind']=='chart':
                try:
                    chart=self.workspace.effective(identifier,widget)
                    view.update(default_title=readable(widget.get('title') or chart['spec'].get('title') or chart['question']),
                        display_title=widget.get('custom_title') or readable(widget.get('title') or chart['spec'].get('title') or chart['question']),
                        original_title=widget.get('title') or chart['title'], freshness=self.workspace.status(chart),
                        matching_widget_ids=[key for key in matches.get(duplicate_key(chart,widget.get('spec')),[]) if key!=widget['id']],
                        history_count=len(self.workspace.rows(identifier,widget['id'])[1:]))
                    missing=any(not (c.get('money') or {}).get('currency') and not (c.get('money') or {}).get('mixed') for c in self.display_snapshot(chart)['columns'])
                    if missing and chart['id'] not in currency_candidates:
                        try:currency_candidates[chart['id']]=bool(self.currency_candidates(chart)[0])
                        except HTTPException:currency_candidates[chart['id']]=False
                    result,filters=filter_rows(self.display_snapshot(chart),data['filters']+widget['filters'])
                    spec=widget.get('spec') or chart['spec']
                    try:rendered=validate_chart(spec,result);fallback=None
                    except ValueError as exc:rendered=validate_chart({'kind':'table'},result);fallback=str(exc)
                    evidence=compute_evidence(result)
                    rendered['spec']['title']=view['display_title']
                    view.update(source=self.info(chart),currency_metadata_available=currency_candidates.get(chart['id'],False),result=result,chart=rendered,
                        chart_options=chart_options(result)['options'],filters_applied=filters,evidence=evidence,
                        fallback_reason=fallback,summary=[] if filters['applied'] else chart['summary'])
                except HTTPException as exc:view['error']=exc.detail
            widgets.append(view)
        return {**data,'widgets':widgets,'snapshot_notice':'Persisted query-output snapshots. Refresh is manual and never calls the model.'}
    def router(self):
        router=APIRouter(prefix='/api',tags=['Dashboards'])
        @router.get('/dashboards',response_model=List[DashboardSummary])
        def listing():
            mine=self.projects.dashboard_ids() if getattr(self,'projects',None) else None
            return [{k:v for k,v in d.items() if k!='widgets'}|{'widget_count':len(d['widgets'])} for d in self.store.list('Dashboard') if mine is None or d['id'] in mine]
        @router.post('/dashboards',status_code=201,response_model=DashboardView)
        def create(body:DashboardCreate):return self.create(body)
        @router.get('/dashboards/{identifier}',response_model=DashboardView)
        def detail(identifier:UUID):return self.view(identifier)
        @router.put('/dashboards/{identifier}',response_model=DashboardView)
        def update(identifier:UUID,body:DashboardUpdate):self.update(identifier,body);return self.view(identifier)
        @router.delete('/dashboards/{identifier}',status_code=204)
        def remove(identifier:UUID):
            with self.lock,Session(self.store.engine) as session:
                row=session.get(self.store.models['Dashboard'],str(identifier))
                if row is None:raise HTTPException(404,'Dashboard not found.')
                from sqlalchemy import delete
                session.execute(delete(self.workspace.Model).where(self.workspace.Model.dashboard_id==str(identifier)))
                session.delete(row);session.commit()
        @router.post('/dashboards/{identifier}/duplicate',status_code=201,response_model=DashboardView)
        def duplicate(identifier:UUID):
            with self.lock:
                source=self.store.get('Dashboard',identifier);created=self.create(DashboardCreate(title=(source['title']+' copy')[:120],description=source['description']))
                widgets=copy.deepcopy(source['widgets'])
                for w in widgets:w['id']=str(uuid4())
                result=self.update(created['id'],DashboardUpdate(title=created['title'],description=source['description'],revision=1,filters=source['filters'],widgets=widgets))
                for old,new in zip(source['widgets'],widgets):self.workspace.clone(identifier,old['id'],created['id'],new['id'])
                return self.view(result['id'])
        @router.get('/saved-charts',response_model=List[SavedChartInfo])
        def charts():
            allowed=self.projects.dataset_ids() if getattr(self,'projects',None) else None
            return [self.info(d) for d in self.store.list('SavedChart') if allowed is None or d.get('dataset_id') in allowed]
        @router.post('/saved-charts',status_code=201,response_model=SavedChartInfo)
        def save(body:SaveChart):return self.info(self.save_chart(body))
        @router.get('/saved-charts/{identifier}',response_model=SavedChartRecord)
        def chart(identifier:UUID):
            record=self.store.get('SavedChart',identifier)
            return {**record,'snapshot_digest':self.snapshot_digest(record)}
        @router.post('/saved-charts/{identifier}/currency-metadata',response_model=SavedChartInfo)
        def currency_metadata(identifier:UUID,body:ConfirmCurrencyMetadata):return self.confirm_currency_metadata(identifier,body)
        @router.post('/saved-charts/{identifier}/refresh',response_model=SavedChartInfo)
        def refresh(identifier:UUID):return self.info(self.refresh(identifier))
        @router.get('/saved-charts/{identifier}/history')
        def library_history(identifier:UUID):
            self.store.get('SavedChart',identifier)
            return {'limit':3,'snapshots':[{'id':key,**value} for key,value in self.workspace.rows('library:'+str(identifier),identifier)[1:]]}
        @router.delete('/saved-charts/{identifier}',status_code=204)
        def remove_chart(identifier:UUID):
            with self.lock:
                if any(w.get('chart_id')==str(identifier) for d in self.store.list('Dashboard') for w in d['widgets']):raise HTTPException(409,'Remove this chart from dashboards first.')
                self.store.delete('SavedChart',identifier)
        @router.get('/dashboards/{identifier}/widgets/{widget_id}/results.csv')
        def export_csv(identifier:UUID,widget_id:UUID,target_currency:Optional[str]=None,historical_date:Optional[date]=None):
            view=self.view(identifier);widget=next((w for w in view['widgets'] if w['id']==str(widget_id)),None)
            if not widget or 'result' not in widget:raise HTTPException(404,'Widget results unavailable.')
            if target_currency:
                from .currency import export_result
                widget['result'] = export_result(widget['result'], target_currency, self.analyst.currency_rates, historical_date)
            return Response(safe_csv(widget['result']),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="insightiq-widget.csv"'})
        return router
