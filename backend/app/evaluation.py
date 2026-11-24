from .knowledge import KnowledgeSettings
"""Bounded paid generation and zero-provider offline replay with isolated reference data."""
import csv,io,json,os,threading,time
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal,InvalidOperation
from uuid import UUID,uuid4
from typing import List,Literal,Optional
from fastapi import APIRouter,HTTPException,UploadFile
from fastapi.responses import Response
from pydantic import BaseModel,ConfigDict,Field
from .analyst import AskRequest,TERMINAL
from .benchmark import VERSION,MAPPING,FIXTURE,authored_cases,equivalent
from .dashboards import safe_csv
from .execution import execute_isolated,ExecutionError
from .sql_guard import validate_sql,GuardError
from .knowledge import digest
from .persistence import utcnow
from .provider import ModelError,SYSTEM
from .observability import percentile
from .contracts import EvaluationJob
from .evaluation_reporting import enrich_metrics,present_job,COMPARISON_POLICY
from .prompts import PROMPT_VERSION,PROMPT_HASH,WORKFLOW_VERSION


class EvalRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    dataset_id:UUID
    version:Literal['retail-v1']='retail-v1'
    case_ids:List[str]=Field(min_length=1,max_length=10)
    pipeline:Literal['baseline','rag','agentic']
    max_spend_usd:float=Field(gt=0,le=5,allow_inf_nan=False)
    max_total_tokens:int=Field(default=100000,ge=2000,le=500000)
    confirm_paid_calls:Literal[True]


class OfflineRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    dataset_id:UUID
    version:Literal['retail-v1']='retail-v1'
    case_ids:Optional[List[str]]=Field(default=None,min_length=1,max_length=45)
    source_evaluation_id:Optional[UUID]=None


class ReviewLabels(BaseModel):
    model_config=ConfigDict(extra='forbid')
    reviewed:Literal[True]
    labels:List[Literal['wrong_join','wrong_filter','wrong_aggregation','hallucinated_column','hallucinated_table','other']]=Field(max_length=6)
    reason:str=Field(min_length=5,max_length=800)


def rates():
    try:
        values=[Decimal(os.environ[k]) for k in ('LLM_INPUT_USD_PER_MILLION','LLM_OUTPUT_USD_PER_MILLION')]
        return values if all(v.is_finite() and v>=0 for v in values) else None
    except (KeyError,InvalidOperation):return None


class BudgetProvider:
    """Reserves conservative byte-derived token/cost ceilings before every request."""
    def __init__(self,provider,job,cancel,save):self.provider,self.job,self.cancel,self.save=provider,job,cancel,save;self.model=provider.model
    def generate(self,question,context):
        if self.cancel.is_set():raise ModelError('Evaluation cancelled.','cancelled')
        if time.monotonic()>self.job['_deadline']:raise ModelError('Evaluation reached its 10-minute wall deadline.','evaluation_limit')
        inputs=len((json.dumps({'question':question,'dialect':'duckdb','schema':context},ensure_ascii=True)+SYSTEM).encode())+8192;outputs=1600
        pricing=self.job['pricing'];cost=(Decimal(str(pricing['input']))*inputs+Decimal(str(pricing['output']))*outputs)/1000000
        if self.job['provider_calls']>=30 or self.job['reserved_tokens']+inputs+outputs>self.job['max_total_tokens'] or Decimal(str(self.job['reserved_cost_usd']))+cost>Decimal(str(self.job['max_spend_usd'])):
            raise ModelError('Evaluation stopped before a request that would exceed the reserved token/spend/call budget.','evaluation_budget')
        self.job['provider_calls']+=1;self.job['reserved_tokens']+=inputs+outputs;self.job['reserved_cost_usd']=float(Decimal(str(self.job['reserved_cost_usd']))+cost);self.save()
        return self.provider.generate(question,context)


class EvaluationService:
    def __init__(self,analyst,store,upload):
        self.analyst,self.store,self.upload=analyst,store,upload
        self.lock=threading.RLock();self.slot=threading.BoundedSemaphore(1);self.executor=ThreadPoolExecutor(max_workers=1,thread_name_prefix='evaluation');self.cancel={};self.references=None
    def start(self):
        for job in self.store.list('Evaluation'):
            if job['status'] not in {'completed','failed','cancelled'}:
                job.update(status='failed',error='API restarted before evaluation completed.',completed_at=utcnow());self.store.save('Evaluation',job)
    def close(self):
        for event in self.cancel.values():event.set()
        self.executor.shutdown(wait=True,cancel_futures=True)
    def fingerprint(self,identifier):
        item=self.analyst.get_item(identifier)
        with self.analyst.connector(self.analyst.root/(item.id+'.duckdb')) as db:
            description=db.execute('DESCRIBE records').fetchall()
            rows=db.execute('SELECT * FROM records LIMIT 1001').fetchall()
        return digest({'columns':[r[0] for r in description],'rows':rows})
    def install(self):
        with self.lock:
            for entry in self.store.list('BenchmarkInstall'):
                if entry['version']==VERSION:
                    try:
                        item=self.analyst.get_item(entry['dataset_id'])
                        if getattr(item,'archived_at',None):raise HTTPException(409,'Restore the archived controlled benchmark in Data workspace.')
                        return entry
                    except HTTPException as exc:
                        if exc.status_code!=404:raise
            file=UploadFile(filename='CONTROLLED-BENCHMARK-retail-v1.csv',file=io.BytesIO(FIXTURE.read_bytes()))
            item=self.upload(file)
            record={'id':str(uuid4()),'dataset_id':item.id,'version':VERSION,'updated_at':utcnow(),'fingerprint':self.fingerprint(item.id)}
            return self.store.save('BenchmarkInstall',record)
    def require_active(self,identifier):
        if getattr(self.analyst.get_item(identifier),"archived_at",None):raise HTTPException(409,"Restore the controlled benchmark dataset to make Evaluation available.")
    def authorize_dataset(self,identifier,check_knowledge=True):
        entry=next((e for e in self.store.list('BenchmarkInstall') if e['dataset_id']==str(identifier) and e['version']==VERSION),None)
        if entry is None or self.fingerprint(identifier)!=entry['fingerprint']:raise HTTPException(409,'Select the explicitly installed, unchanged controlled benchmark dataset. Uploaded datasets are not benchmark-compatible.')
        settings=self.analyst.knowledge.settings(identifier) if check_knowledge else None
        if settings is not None and (settings['verified_examples'] or settings['settings']!=KnowledgeSettings().model_dump()):
            raise HTTPException(409,'Benchmark knowledge contains custom definitions/examples. Remove them to avoid gold leakage before evaluating.')
        return entry
    def verify(self,identifier):
        self.require_active(identifier)
        self.authorize_dataset(identifier);cases=authored_cases()
        if not self.analyst.slots.acquire(False):raise HTTPException(429,'Query execution slots are busy.')
        try:
            for case in cases:
                if case['expectation']=='abstain':continue
                try:
                    sql=validate_sql(case['reference_sql'],{c:MAPPING.get(c,'VARCHAR') for c in next(csv.reader(io.StringIO(FIXTURE.read_text())))})
                    actual=execute_isolated(self.analyst.root/(str(identifier)+'.duckdb'),sql,MAPPING)
                    ok,reason=equivalent(actual,case['expected'],case['ordered'])
                    case.update(verification='verified' if ok else 'pending',verification_reason=reason,verification_method='Authored expected values checked against guard + isolated reference execution')
                except (ExecutionError,GuardError) as exc:case.update(verification='pending',verification_reason=str(exc))
        finally:self.analyst.slots.release()
        self.references={'version':VERSION,'dataset_id':str(identifier),'cases':cases,'verified_at':utcnow()}
        entry=self.authorize_dataset(identifier);entry['verification']=self.references;entry['updated_at']=utcnow();self.store.save('BenchmarkInstall',entry)
        return self.overview()
    def overview(self):
        installations=self.store.list('BenchmarkInstall');entry=next((e for e in installations if e['version']==VERSION),None)
        verification=entry.get('verification') if entry else None
        cases=verification['cases'] if verification else authored_cases()
        verified=sum(c['verification']=='verified' for c in cases)
        return {'version':VERSION,'title':'Controlled retail benchmark — fictional authored data','dataset_id':entry['dataset_id'] if entry else None,'fingerprint':entry['fingerprint'] if entry else None,
            'case_count':len(cases),'verified_count':verified,'pending_count':len(cases)-verified,'cases':cases,
            'scope':'One authorized dataset; join cases use self joins. Requests for a separate physical customer database must abstain.',
            'comparison_policy':'Exact output aliases/type families; NULLs/duplicates preserved. Order required only when marked. Integers compare exactly; other numeric abs tolerance 1e-9, relative 1e-6. Unordered matching limited to 100 rows.',
            'pricing':{'input':str(rates()[0]),'output':str(rates()[1])} if rates() is not None else None,
            'limits':{'max_cases':10,'max_provider_calls':30,'output_tokens_per_call':1600,'max_seconds':600,'cost_policy':'Conservative byte-derived token/spend reservations before each call; configured rates required. Not a billing reconciliation.'}}
    def submit(self,request):
        entry=self.authorize_dataset(request.dataset_id);verification=entry.get('verification')
        if not verification:raise HTTPException(409,'Verify the authored benchmark references before evaluating.')
        selected=[c for c in verification['cases'] if c['id'] in request.case_ids]
        if len(selected)!=len(set(request.case_ids)) or len(request.case_ids)!=len(set(request.case_ids)) or any(c['verification']!='verified' for c in selected):raise HTTPException(422,'Select unique, verified benchmark case IDs only.')
        pricing=rates()
        if pricing is None:raise HTTPException(409,'Configure documented input/output pricing rates before paid evaluation; spend cannot be bounded with unknown prices.')
        self.admit()
        time_now=utcnow();job={'id':str(uuid4()),'dataset_fingerprint':entry['fingerprint'],**request.model_dump(mode='json'),'status':'queued','created_at':time_now,'updated_at':time_now,'completed_at':None,
            'mode':'paid','prompt_version':PROMPT_VERSION,'prompt_hash':PROMPT_HASH,'workflow_version':WORKFLOW_VERSION,'comparison_policy':COMPARISON_POLICY,'model':self.analyst.provider.model,'provider_endpoint':self.provider_origin(),'pricing':{'input':str(pricing[0]),'output':str(pricing[1]),'source':'User-configured USD per million tokens; verify current provider rates.'},
            'results':[],'active_run_id':None,'provider_calls':0,'reserved_tokens':0,'reserved_cost_usd':0.0,'error':None,'metrics':None}
        return self.launch(job,selected)

    def launch(self,job,selected):
        try:
            self.store.save('Evaluation',job);response=json.loads(json.dumps(job));event=threading.Event();self.cancel[job['id']]=event;self.executor.submit(self.work,job,selected,event)
        except Exception:self.slot.release();raise
        return response
    def admit(self):
        if len(self.store.list('Evaluation'))>=100:raise HTTPException(409,'Maximum 100 saved evaluation records. Delete old records before running more.')
        if not self.slot.acquire(False):raise HTTPException(429,'One evaluation is already active.')

    @staticmethod
    def compare_prediction(case,run,actual,expected=None):
        if case['expectation']=='abstain':
            correct=run['status']=='clarification' and bool(run.get('clarification'))
            return correct,'Appropriate clarification/abstention.' if correct else 'Expected clarification/abstention, not SQL or a provider error.'
        if actual is None:return False,'No successful query result: '+str(run.get('error') or run['status'])
        return equivalent(actual,expected if expected is not None else case['expected'],case['ordered'])

    def submit_offline(self,request):
        # This admission path intentionally never consults provider, rates or RAG.
        entry=self.authorize_dataset(request.dataset_id,check_knowledge=False)
        verification=entry.get('verification')
        if not verification or verification.get('version')!=request.version or verification.get('dataset_id')!=str(request.dataset_id):
            raise HTTPException(409,'Verify this benchmark dataset before offline prediction scoring.')
        identifiers=request.case_ids if request.case_ids is not None else [c['id'] for c in verification['cases'] if c['verification']=='verified']
        selected=[c for c in verification['cases'] if c['id'] in identifiers]
        if not selected or len(selected)!=len(identifiers) or len(set(identifiers))!=len(identifiers) or any(c['verification']!='verified' for c in selected):
            raise HTTPException(422,'Select unique, verified benchmark question IDs only.')
        if request.source_evaluation_id:self.store.get('Evaluation',request.source_evaluation_id)
        self.admit();now=utcnow()
        job={'id':str(uuid4()),'mode':'offline','pipeline':'offline','version':request.version,'dataset_id':str(request.dataset_id),
            'dataset_fingerprint':entry['fingerprint'],'source_evaluation_id':str(request.source_evaluation_id) if request.source_evaluation_id else None,
            'case_ids':identifiers,'confirm_paid_calls':False,'max_spend_usd':0,'max_total_tokens':0,'status':'queued','created_at':now,
            'updated_at':now,'completed_at':None,'model':'Saved predictions only','provider_endpoint':'offline://local',
            'pricing':{'input':'0','output':'0','source':'Offline replay: zero new model calls; historical usage is not charged again.'},
            'results':[],'active_run_id':None,'provider_calls':0,'reserved_tokens':0,'reserved_cost_usd':0.0,'error':None,'metrics':None}
        return self.launch(job,selected)

    def matching_prediction(self,job,case):
        sources=[self.store.get('Evaluation',job['source_evaluation_id'])] if job.get('source_evaluation_id') else self.store.list('Evaluation')
        # Creation time, not post-run review time, determines the latest prediction.
        for source in sorted(sources,key=lambda s:s.get('created_at',''),reverse=True):
            if (source.get('mode','paid')!='paid' or source.get('pipeline') not in {'baseline','rag','agentic'} or
                source.get('confirm_paid_calls') is not True or source.get('status') not in {'completed','failed','cancelled'} or
                source.get('version')!=job['version'] or source.get('dataset_id')!=job['dataset_id'] or
                source.get('dataset_fingerprint')!=job['dataset_fingerprint']):continue
            for prediction in source.get('results',[]):
                run=prediction.get('run')
                if (prediction.get('case_id')!=case['id'] or prediction.get('question')!=case['question'] or not isinstance(run,dict) or
                    not run.get('id') or run.get('activity_kind')!='evaluation' or run.get('dataset_id')!=job['dataset_id'] or
                    run.get('question')!=case['question'] or run.get('type_mapping')!=MAPPING or run.get('pipeline')!=source['pipeline']):continue
                try:original=self.analyst.load(run['id'])
                except HTTPException:continue
                fields=('dataset_id','question','pipeline','activity_kind','type_mapping','sql','executed_sql','clarification','status')
                if any(original.get(key)!=run.get(key) for key in fields):continue
                sql=original.get('executed_sql') or original.get('sql')
                abstention=original.get('status')=='clarification' and bool(original.get('clarification'))
                if (isinstance(sql,str) and sql.strip()) or abstention:return source,original
        return None

    def execute_saved(self,job,sql,cancel):
        with self.analyst.connector(self.analyst.root/(job['dataset_id']+'.duckdb')) as db:
            schema={c[0]:MAPPING.get(c[0],'VARCHAR') for c in db.execute('DESCRIBE records').fetchall()}
        validated=validate_sql(sql,schema)
        result=execute_isolated(self.analyst.root/(job['dataset_id']+'.duckdb'),validated,MAPPING,cancel)
        return {key:result[key] for key in ('columns','rows','row_count')}

    def work_offline(self,job,cases,cancel):
        deadline=time.monotonic()+600
        def save():
            job['updated_at']=utcnow();job['metrics']=self.metrics(job['results'],'offline');self.store.save('Evaluation',job)
        try:
            job['status']='running';save()
            for case in cases:
                if cancel.is_set():break
                if time.monotonic()>deadline:raise ModelError('Offline evaluation reached its 10-minute SQL replay deadline.','evaluation_limit')
                # Reference provenance is checked separately from prediction eligibility.
                entry=self.authorize_dataset(job['dataset_id'],check_knowledge=False)
                if entry['fingerprint']!=job['dataset_fingerprint']:raise HTTPException(409,'Dataset changed during offline evaluation.')
                found=self.matching_prediction(job,case)
                row={'case_id':case['id'],'category':case['category'],'difficulty':case['difficulty'],'question':case['question'],
                     'reference_sql':case['reference_sql'],'expected':case['expected'],'ordered':case['ordered'],'actual':None,'correct':None,'run':None,'replay_diagnostics':{},
                     'status':'missing_prediction','comparison':'Not evaluated — no saved prediction','failure_labels':[],
                     'source_evaluation_id':None,'source_run_id':None,'source_model':None,'source_pipeline':None,'replayed_sql':None,'offline_latency_ms':None}
                if found:
                    source,run=found;sql=run.get('executed_sql') or run.get('sql');start=time.monotonic()
                    row.update(run=run,source_evaluation_id=source['id'],source_run_id=run['id'],source_model=source.get('model'),source_pipeline=source['pipeline'],replayed_sql=sql)
                    if not self.analyst.slots.acquire(False):raise HTTPException(429,'Query execution slots are busy; no model calls were made.')
                    try:
                        with self.analyst.knowledge.lock:
                            self.authorize_dataset(job['dataset_id'],check_knowledge=False)
                            if case['expectation']=='sql':
                                try:
                                    reference=self.execute_saved(job,case['reference_sql'],cancel)
                                    verified,reason=equivalent(reference,case['expected'],case['ordered'])
                                    if not verified:raise GuardError('Reference output no longer matches its verified contract: '+reason)
                                    row['expected']=reference
                                except (GuardError,ExecutionError) as exc:
                                    row.update(status='reference_failed',comparison='Reference verification failed; prediction not scored: '+str(exc))
                            if row['status']!='reference_failed':
                                try:
                                    if sql:
                                        row['actual']=self.execute_saved(job,sql,cancel)
                                        row['replay_diagnostics']={'validation':'passed','execution':'succeeded'}
                                    correct,reason=self.compare_prediction(case,run,row['actual'],row['expected'])
                                    row.update(correct=correct,status='correct' if correct else 'incorrect',comparison=reason)
                                except (GuardError,ExecutionError) as exc:
                                    row['replay_diagnostics']={'validation':'rejected' if isinstance(exc,GuardError) else 'passed','execution':'not_started' if isinstance(exc,GuardError) else 'failed'}
                                    row.update(correct=False,status='execution_failed',comparison='Saved SQL validation/execution failed: '+str(exc),failure_labels=['offline_execution_failure'])
                    finally:
                        self.analyst.slots.release();row['offline_latency_ms']=round((time.monotonic()-start)*1000)
                if cancel.is_set():break
                job['results'].append(row);save()
            job['status']='cancelled' if cancel.is_set() else 'completed'
        except (HTTPException,ModelError) as exc:
            job.update(status='cancelled' if cancel.is_set() else 'failed',error=exc.detail if isinstance(exc,HTTPException) else str(exc))
        except Exception:job.update(status='failed',error='Offline replay failed internally; no provider or embedding calls were requested.')
        finally:
            job['completed_at']=utcnow()
            try:save()
            finally:self.cancel.pop(job['id'],None);self.slot.release()

    @staticmethod
    def offline_metrics(results):
        evaluated=[r for r in results if r.get('correct') is not None]
        correct=sum(r['correct'] is True for r in evaluated);count=len(evaluated)
        timings=[r['offline_latency_ms'] for r in evaluated if r.get('offline_latency_ms') is not None]
        groups=lambda key:{name:{'total':sum(r[key]==name for r in evaluated),'correct':sum(r[key]==name and r['correct'] is True for r in evaluated)} for name in sorted({r[key] for r in evaluated})}
        return enrich_metrics(results,{'completed_cases':len(results),'evaluated_count':count,'correct_count':correct,'incorrect_count':count-correct,
            'missing_predictions':sum(r['status']=='missing_prediction' for r in results),'execution_failures':sum(r['status']=='execution_failed' for r in results),
            'reference_failures':sum(r['status']=='reference_failed' for r in results),'accuracy':correct/count if count else None,
            'valid_sql_rate':None,'execution_success_rate':None,'result_accuracy':correct/count if count else None,'average_attempts':0,'repair_success_rate':None,
            'p50_latency_ms':percentile(timings,.5),'p95_latency_ms':percentile(timings,.95),'total_tokens':0,'estimated_cost_usd':0,
            'categories':groups('category'),'difficulties':groups('difficulty'),'diagnostic_counts':{},'wrong_join_rate':None,'wrong_filter_rate':None,
            'wrong_aggregation_rate':None,'hallucinated_column_rate':None,'hallucinated_table_rate':None,'reviewed_cases':0,
            'diagnostic_note':'Offline: 0 new LLM calls. Accuracy uses matching saved predictions only; validation/execution failures count as incorrect. Missing predictions and failed references are not scored. Historical model usage is not new usage.'},'offline')

    def provider_origin(self):
        from urllib.parse import urlsplit
        url=urlsplit(os.getenv('LLM_BASE_URL','https://api.openai.com/v1'))
        return url.scheme+'://'+(url.hostname or '')  # never include URL credentials/query strings
    def work(self,job,cases,cancel):
        if job.get('mode')=='offline':
            return self.work_offline(job,cases,cancel)
        job['_deadline']=time.monotonic()+600
        def save():
            job['updated_at']=utcnow();self.store.save('Evaluation',{k:v for k,v in job.items() if not k.startswith('_')})
        provider=BudgetProvider(self.analyst.provider,job,cancel,save)
        try:
            job['status']='running';save()
            for case in cases:
                if cancel.is_set():break
                if time.monotonic()>job['_deadline']:raise ModelError('Evaluation wall deadline reached.','evaluation_limit')
                # Recheck canonical fixture and clean knowledge before every case.
                self.authorize_dataset(job['dataset_id'])
                request=AskRequest(dataset_id=job['dataset_id'],question=case['question'],type_mapping=MAPPING)
                with self.analyst.knowledge.lock:run=self.analyst.submit(request,pipeline=job['pipeline'],activity_kind='evaluation',provider=provider)
                job['active_run_id']=run['id'];save()
                while True:
                    run=self.analyst.load(run['id'])
                    if run['status'] in TERMINAL:break
                    if cancel.is_set() or time.monotonic()>job['_deadline']:
                        event=self.analyst.events.get(run['id'])
                        if event:event.set()
                    time.sleep(.05)
                if cancel.is_set():break
                if run['error_code'] in {'evaluation_budget','evaluation_limit'}:raise ModelError(run['error'],run['error_code'])
                actual=None
                if run['status']=='succeeded':
                    _,result=self.analyst.result(run['id']);actual={k:result[k] for k in ('columns','rows','row_count')}
                correct,reason=self.compare_prediction(case,run,actual)
                entry={'case_id':case['id'],'category':case['category'],'difficulty':case['difficulty'],'question':case['question'],
                    'reference_sql':case['reference_sql'],'expected':case['expected'],'ordered':case['ordered'],'actual':actual,'correct':correct,'comparison':reason,
                    'run':run,'failure_labels':self.labels(run,case,correct)}
                job['results'].append(entry);job['active_run_id']=None;job['metrics']=self.metrics(job['results']);save()
            job['status']='cancelled' if cancel.is_set() else 'completed'
        except (HTTPException,ModelError) as exc:job.update(status='cancelled' if cancel.is_set() else 'failed',error=exc.detail if isinstance(exc,HTTPException) else str(exc))
        except Exception:job.update(status='failed',error='Evaluation failed internally; completed case records are retained.')
        finally:
            job['completed_at']=utcnow();job['active_run_id']=None;job['metrics']=self.metrics(job['results'])
            try:save()
            finally:self.cancel.pop(job['id'],None);self.slot.release()
    @staticmethod
    def labels(run,case,correct):
        if correct:return []
        text=' '.join(e.get('summary','') for e in run.get('events',[]) if e.get('step')=='validate' and e.get('status')=='rejected').casefold()
        labels=[]
        if any(t in text for t in ('unknown column','unknown table','unknown relation','not found','does not exist')):labels.append('hallucinated_reference')
        # Structural differences are diagnostics, not proof of error causality.
        if run.get('sql'):
            import sqlglot
            from sqlglot import exp
            try:
                candidate=sqlglot.parse_one(run['sql'],read='duckdb')
                header=set(next(csv.reader(io.StringIO(FIXTURE.read_text()))))
                ctes={n.alias for n in candidate.find_all(exp.CTE)}
                if any(n.name not in {'data'}|ctes for n in candidate.find_all(exp.Table)):labels.append('hallucinated_table_signal')
                if not ctes:
                    aliases={n.alias for n in candidate.find_all(exp.Alias)}
                    if any(n.name not in header|aliases for n in candidate.find_all(exp.Column)):labels.append('hallucinated_column_signal')
            except sqlglot.errors.SqlglotError:pass
        if run.get('executed_sql') and case['reference_sql']:
            import sqlglot
            from sqlglot import exp
            predicted=sqlglot.parse_one(run['executed_sql'],read='duckdb');gold=sqlglot.parse_one(case['reference_sql'],read='duckdb')
            for node,label in [(exp.Join,'join_structure_differs'),(exp.Where,'filter_structure_differs'),(exp.AggFunc,'aggregation_structure_differs')]:
                if [n.sql() for n in predicted.find_all(node)]!=[n.sql() for n in gold.find_all(node)]:labels.append(label)
        return labels or ['unclassified_mismatch']
    @staticmethod
    def metrics(results,mode="paid"):
        if mode=="offline":return EvaluationService.offline_metrics(results)
        n=len(results);sql=[r for r in results if r['expected'] is not None];executed=[r for r in sql if r['actual'] is not None]
        times=[r['run']['metrics'].get('total_latency_ms') for r in results];times=[v for v in times if v is not None]
        attempts=[r['run'].get('attempts',0) for r in results];repair=[r for r in results if r['run'].get('attempts',0)>1]
        categories={c:{'total':sum(r['category']==c for r in results),'correct':sum(r['category']==c and r['correct'] for r in results)} for c in sorted({r['category'] for r in results})}
        difficulties={d:{'total':sum(r['difficulty']==d for r in results),'correct':sum(r['difficulty']==d and r['correct'] for r in results)} for d in sorted({r['difficulty'] for r in results})}
        labels={l:sum(l in r['failure_labels'] for r in results) for l in sorted({l for r in results for l in r['failure_labels']})}
        reviewed=[r for r in results if (r.get('review') or {}).get('reviewed')]
        reviewed_rate=lambda label:sum(label in r['review']['labels'] for r in reviewed)/len(reviewed) if reviewed else None
        attempts_total=sum(r['run'].get('attempts',0) for r in sql)
        validated_attempts=sum(sum(e['step']=='validate' and e['status']=='passed' for e in r['run'].get('events',[])) for r in sql)
        def total(key):
            vals=[r['run']['metrics'].get(key) for r in results]
            return sum(vals) if vals and all(v is not None for v in vals) else None
        return enrich_metrics(results,{'completed_cases':n,'accuracy':sum(r['correct'] for r in results)/n if n else None,
            'valid_sql_rate':validated_attempts/attempts_total if attempts_total else None,
            'execution_success_rate':len(executed)/len(sql) if sql else None,'result_accuracy':sum(r['correct'] for r in sql)/len(sql) if sql else None,
            'average_attempts':sum(attempts)/len(attempts) if attempts else None,'repair_success_rate':sum(r['correct'] for r in repair)/len(repair) if repair else None,
            'p50_latency_ms':percentile(times,.5),'p95_latency_ms':percentile(times,.95),'total_tokens':total('total_tokens'),'estimated_cost_usd':total('estimated_cost_usd'),
            'categories':categories,'difficulties':difficulties,'diagnostic_counts':labels,'wrong_join_rate':reviewed_rate('wrong_join'),'wrong_filter_rate':reviewed_rate('wrong_filter'),'wrong_aggregation_rate':reviewed_rate('wrong_aggregation'),
            'hallucinated_column_rate':reviewed_rate('hallucinated_column'),'hallucinated_table_rate':reviewed_rate('hallucinated_table'),'reviewed_cases':len(reviewed),
            'diagnostic_note':'Structural differences and guard reference errors are observable signals, not semantic error-cause certification. Cause rates use only independently reviewed cases and remain unknown without review; see reviewed-case denominator.'})
    def router(self):
        router=APIRouter(prefix='/api',tags=['Evaluation'])
        @router.get('/benchmarks')
        def overview():return self.overview()
        @router.post('/benchmarks/retail-v1/install',status_code=201)
        def install():return self.install()
        @router.post('/benchmarks/retail-v1/verify')
        def verify(dataset_id:UUID):return self.verify(dataset_id)
        @router.get('/evaluations',response_model=List[EvaluationJob],response_model_exclude={'__all__':{'results'}})
        def history():return [{k:v for k,v in present_job(j).items() if k!='results'} for j in self.store.list('Evaluation')]
        @router.post('/evaluations/offline',status_code=202,response_model=EvaluationJob)
        def offline(body:OfflineRequest):
            with self.lock:
                self.require_active(body.dataset_id)
                return self.submit_offline(body)
        @router.post('/evaluations',status_code=202,response_model=EvaluationJob)
        def create(body:EvalRequest):
            with self.lock:
                self.require_active(body.dataset_id)
                return self.submit(body)
        @router.get('/evaluations/{identifier}',response_model=EvaluationJob)
        def detail(identifier:UUID):return present_job(self.store.get('Evaluation',identifier))
        @router.delete('/evaluations/{identifier}',response_model=EvaluationJob)
        def cancel(identifier:UUID):
            job=self.store.get('Evaluation',identifier);event=self.cancel.get(str(identifier))
            if event:event.set()
            return job
        @router.put('/evaluations/{identifier}/cases/{case_id}/review',response_model=EvaluationJob)
        def review(identifier:UUID,case_id:str,body:ReviewLabels):
            with self.lock:
                job=self.store.get('Evaluation',identifier)
                if job['status'] not in {'completed','failed','cancelled'}:raise HTTPException(409,'Wait for the evaluation to stop before reviewing causes.')
                case=next((c for c in job['results'] if c['case_id']==case_id),None)
                if case is None:raise HTTPException(404,'Evaluation case not found.')
                if case.get('correct') is None:raise HTTPException(409,'This case has no evaluated prediction to review.')
                if len(set(body.labels))!=len(body.labels):raise HTTPException(422,'Cause labels must be unique.')
                case['review']={**body.model_dump(),'reviewed_at':utcnow(),'reviewer':'local user'}
                job['metrics']=self.metrics(job['results'],job.get('mode','paid'));job['updated_at']=utcnow();self.store.save('Evaluation',job)
                return present_job(job)
        @router.delete('/evaluations/{identifier}/record',status_code=204)
        def purge(identifier:UUID):
            with self.lock:
                job=self.store.get('Evaluation',identifier)
                if job['status'] not in {'completed','failed','cancelled'}:raise HTTPException(409,'Cancel the active evaluation first.')
                self.store.delete('Evaluation',identifier)
        @router.get('/evaluations/{identifier}/report.json',response_model=EvaluationJob)
        def export_json(identifier:UUID):return present_job(self.store.get('Evaluation',identifier))
        @router.get('/evaluations/{identifier}/report.csv')
        def export_csv(identifier:UUID):
            job=present_job(self.store.get('Evaluation',identifier))
            keys=['case_id','category','correct','comparison','predicted_sql','reference_sql','latency_ms','attempts','tokens','estimated_cost_usd','evaluation_mode','prediction_status','source_evaluation_id','alias_only_mismatch','positional_values_match','prompt_version']
            rows=[[r['case_id'],r['category'],r['correct'],r['comparison'],(r.get('run') or {}).get('sql'),r['reference_sql'],r.get('offline_latency_ms') if job.get('mode')=='offline' else r['run']['metrics'].get('total_latency_ms'),0 if job.get('mode')=='offline' else r['run']['attempts'],0 if job.get('mode')=='offline' else r['run']['metrics'].get('total_tokens'),0 if job.get('mode')=='offline' else r['run']['metrics'].get('estimated_cost_usd'),job.get('mode','paid'),r.get('status','evaluated'),r.get('source_evaluation_id'),(r.get('comparison_details') or {}).get('alias_only_mismatch'),(r.get('comparison_details') or {}).get('positional_values_match'),(r.get('run') or {}).get('prompt_version')] for r in job['results']]
            return Response(safe_csv({'columns':[{'name':k} for k in keys],'rows':rows}),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="insightiq-evaluation.csv"'})
        return router
