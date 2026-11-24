"""Registered-data AutoML lifecycle; no provider, retrieval or generated SQL dependency."""
import hashlib,json,shutil,threading,time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import UUID,uuid4
from fastapi import APIRouter,HTTPException,Query
from fastapi.responses import Response
from .contracts import TrainRequest,PredictRequest,ExperimentInfo,ModelInfo,PredictionInfo,Task
from .data import MLFailure,read_dataset,profile,validate_features
from .process import run_process,LIMITS
from ..persistence import utcnow
from ..dashboards import safe_csv

TERMINAL={'completed','failed','cancelled'}
class AutoMLService:
    def __init__(self,analyst,store):
        self.analyst,self.store=analyst,store;self.root=analyst.root/'automl'
        self.lock=threading.RLock();self.slot=threading.BoundedSemaphore(1);self.profile_slots=threading.BoundedSemaphore(2)
        self.active_predictions={};self.events={};self.executor=ThreadPoolExecutor(max_workers=1,thread_name_prefix='automl');self.stopping=False
    def start(self):
        for sub in ('models','jobs','predictions'):(self.root/sub).mkdir(parents=True,exist_ok=True,mode=0o700)
        for job in self.store.list('MLExperiment'):
            if job['status'] not in TERMINAL:
                job.update(status='failed',error='API restarted during this experiment; no automatic retraining.',error_code='interrupted',completed_at=utcnow(),updated_at=utcnow());self.store.save('MLExperiment',job)
        # Only uncommitted staging directories are discarded. Registry files persist.
        for directory in (self.root/'jobs').iterdir():
            if directory.is_dir() and not directory.is_symlink():shutil.rmtree(directory)
    def close(self):
        self.stopping=True
        for event in list(self.events.values()):event.set()
        self.executor.shutdown(wait=True,cancel_futures=True)
    def active(self,dataset_id):return any(j['dataset_id']==str(dataset_id) and j['status'] not in TERMINAL for j in self.store.list('MLExperiment'))
    def owned(self,sub,identifier,suffix):
        path=self.root/sub/(str(UUID(str(identifier)))+suffix)
        if path.is_symlink() or path.resolve().parent!=(self.root/sub).resolve():raise HTTPException(409,'Artifact path is not application owned.')
        return path
    def snapshot(self,identifier):
        with self.analyst.knowledge.lock:
            try:return read_dataset(self.analyst,identifier)
            except MLFailure as exc:raise HTTPException(422,str(exc)) from exc
    def dataset_profile(self,identifier,task,target):
        if not self.profile_slots.acquire(False):raise HTTPException(429,'Two ML profiles are already running.')
        try:return profile(self.snapshot(identifier),task,target)
        finally:self.profile_slots.release()
    def submit(self,body):
        with self.analyst.knowledge.lock,self.lock:
            if self.stopping:raise HTTPException(503,'AutoML is shutting down.')
            if len(self.store.list('MLExperiment'))>=50:raise HTTPException(409,'Maximum 50 experiments; delete a stopped experiment before training more.')
            if len(self.store.list('MLModel'))>95:raise HTTPException(409,'Model registry is full (100 models); delete a stopped experiment.')
            if not self.slot.acquire(False):raise HTTPException(429,'One ML operation is already active. Wait or cancel training.')
            try:
                data=read_dataset(self.analyst,body.dataset_id);config=body.model_dump(mode='json');validate_features(data,config)
                stamp=utcnow();job={'id':str(uuid4()),'dataset_id':data['dataset_id'],'dataset_name':data['dataset_name'],'dataset_fingerprint':data['fingerprint'],'title':body.title,'task':body.task,'status':'queued','created_at':stamp,'updated_at':stamp,'completed_at':None,'duration_seconds':None,'configuration':config,'limits':dict(LIMITS),'result':None,'error':None,'error_code':None}
                self.store.save('MLExperiment',job);event=threading.Event();self.events[job['id']]=event
                response=json.loads(json.dumps(job));self.executor.submit(self.work,job,data,event)
                return response
            except Exception as exc:
                self.slot.release()
                if isinstance(exc,MLFailure):raise HTTPException(422,str(exc)) from exc
                raise
    def work(self,job,data,cancel):
        started=time.monotonic();directory=self.root/'jobs'/job['id'];models=[];promoted=[]
        try:
            job.update(status='running',updated_at=utcnow());self.store.save('MLExperiment',job)
            (directory/'models').mkdir(parents=True,mode=0o700)
            output=run_process({'operation':'train','data':data,'configuration':job['configuration'],'experiment':{k:job[k] for k in ('id','dataset_id','dataset_fingerprint','created_at')},'models_dir':str(directory/'models')},directory,cancel)
            with self.analyst.knowledge.lock,self.lock:
                current=read_dataset(self.analyst,job['dataset_id'])
                if current['fingerprint']!=job['dataset_fingerprint']:raise MLFailure('Dataset changed during training. Results were not registered.','fingerprint_mismatch')
                if cancel.is_set():raise MLFailure('Training cancelled.','cancelled')
                models=output.pop('models')
                for model in models:
                    source=directory/'models'/(str(UUID(model['id']))+'.joblib');target=self.owned('models',model['id'],'.joblib')
                    if not source.is_file() or source.is_symlink() or hashlib.sha256(source.read_bytes()).hexdigest()!=model['artifact_sha256']:raise MLFailure('Generated model artifact failed integrity verification.','artifact_invalid')
                    source.replace(target);promoted.append(model['id']);self.store.save('MLModel',model)
                job.update(status='completed',result=output)
        except Exception as exc:
            for identifier in promoted:
                self.owned('models',identifier,'.joblib').unlink(missing_ok=True)
                try:self.store.delete('MLModel',identifier)
                except HTTPException:pass
            job.update(status='cancelled' if cancel.is_set() else 'failed',error=str(exc) if isinstance(exc,MLFailure) else 'Local training failed. Check dataset/task configuration and resource limits.',error_code=getattr(exc,'code','training_error'))
        finally:
            job.update(completed_at=utcnow(),updated_at=utcnow(),duration_seconds=round(time.monotonic()-started,3))
            try:self.store.save('MLExperiment',job)
            finally:
                shutil.rmtree(directory,ignore_errors=True);self.events.pop(job['id'],None);self.slot.release()
    def registered_model(self,identifier):
        model=self.store.get('MLModel',identifier)
        if self.store.get('MLExperiment',model['experiment_id'])['status']!='completed':
            raise HTTPException(409,'This model was not published by a completed experiment. Delete the stopped experiment and retrain.')
        return model
    def predict(self,identifier,body):
        if not self.slot.acquire(False):raise HTTPException(429,'One ML operation is already active.')
        directory=self.root/'jobs'/str(uuid4())
        try:
            with self.analyst.knowledge.lock,self.lock:
                model=self.registered_model(identifier)
                source=read_dataset(self.analyst,model['dataset_id'])
                if source['fingerprint']!=model['dataset_fingerprint']:raise MLFailure('Training dataset fingerprint changed. Retrain before using this model.','fingerprint_mismatch')
                if len(self.store.list('MLPrediction'))>=50:raise MLFailure('Maximum 50 prediction records; delete an old prediction before generating more.','record_limit')
                if model['task']=='forecasting' and body.horizon is None:raise MLFailure('Saved forecasters accept a horizon, not tabular records.')
                if model['task']!='forecasting' and body.horizon is not None:raise MLFailure('Only forecast models accept a horizon.')
                artifact=self.owned('models',model['id'],'.joblib')
                data=read_dataset(self.analyst,body.dataset_id) if body.dataset_id else None
                if data and data['total_rows']>LIMITS['max_rows']:raise MLFailure('Batch prediction is limited to 5000 registered rows.','dataset_limit')
                records=[dict(zip(data['columns'],r)) for r in data['rows']] if data else body.records
                self.active_predictions[directory.name]={'id':directory.name,'dataset_ids':[model['dataset_id']]+([str(body.dataset_id)] if body.dataset_id else []),'created_at':utcnow()}
                payload={'operation':'predict','model':model,'artifact':str(artifact),'records':records,'horizon':body.horizon,'batch':bool(data),'data':data}
            output=run_process(payload,directory,threading.Event(),timeout=35)
            # Validate source identity again before publishing any output.
            with self.analyst.knowledge.lock:
                if read_dataset(self.analyst,model['dataset_id'],allow_archived=True)['fingerprint']!=model['dataset_fingerprint']:raise MLFailure('Training dataset changed during prediction.','fingerprint_mismatch')
                if data and read_dataset(self.analyst,body.dataset_id,allow_archived=True)['fingerprint']!=data['fingerprint']:raise MLFailure('Batch dataset changed during prediction.','fingerprint_mismatch')
            prediction_id=str(uuid4());path=self.owned('predictions',prediction_id,'.json');encoded=json.dumps(output,allow_nan=False)
            path.write_text(encoded);path.chmod(0o600)
            scope='Future point forecasts; no intervals.' if body.horizon else 'Inference on the training dataset; not held-out evaluation.' if body.dataset_id and str(body.dataset_id)==model['dataset_id'] else 'Batch inference on the explicitly selected registered dataset.' if body.dataset_id else 'User-supplied records; not labeled evaluation.'
            meta={'id':prediction_id,'model_id':model['id'],'dataset_id':str(body.dataset_id) if body.dataset_id else None,'created_at':utcnow(),'row_count':len(output['rows']),'scope':scope,'columns':output['columns'],'sha256':hashlib.sha256(encoded.encode()).hexdigest()}
            self.store.save('MLPrediction',meta)
            return {**meta,'rows':output['rows'][:50],'offset':0}
        except MLFailure as exc:raise HTTPException(409 if exc.code in {'fingerprint_mismatch','artifact_invalid','version_mismatch'} else 422,str(exc)) from exc
        finally:shutil.rmtree(directory,ignore_errors=True);self.slot.release();self.active_predictions.pop(directory.name,None)
    def prediction(self,identifier):
        meta=self.store.get('MLPrediction',identifier);path=self.owned('predictions',identifier,'.json')
        if not path.is_file() or path.stat().st_size>8*1024*1024 or hashlib.sha256(path.read_bytes()).hexdigest()!=meta['sha256']:raise HTTPException(409,'Prediction artifact missing or corrupted.')
        return meta,json.loads(path.read_text())
    def purge(self,identifier):
        if not self.slot.acquire(False):raise HTTPException(409,'Wait for the ML operation to stop before deleting experiments.')
        try:
            job=self.store.get('MLExperiment',identifier)
            if job['status'] not in TERMINAL:raise HTTPException(409,'Cancel the active experiment first.')
            models=[m for m in self.store.list('MLModel') if m['experiment_id']==str(identifier)];ids={m['id'] for m in models}
            for pred in self.store.list('MLPrediction'):
                if pred['model_id'] in ids:self.owned('predictions',pred['id'],'.json').unlink(missing_ok=True);self.store.delete('MLPrediction',pred['id'])
            for model in models:self.owned('models',model['id'],'.joblib').unlink(missing_ok=True);self.store.delete('MLModel',model['id'])
            self.store.delete('MLExperiment',identifier)
        finally:self.slot.release()
    def router(self):
        router=APIRouter(prefix='/api/automl',tags=['AutoML Studio'])
        @router.get('/datasets/{identifier}/profile')
        def inspect(identifier:UUID,task:Task='regression',target:str=Query(default='',max_length=128)):return self.dataset_profile(identifier,task,target or None)
        @router.post('/experiments',status_code=202,response_model=ExperimentInfo)
        def train(body:TrainRequest):return self.submit(body)
        @router.get('/experiments',response_model=list[ExperimentInfo])
        def history():return self.store.list('MLExperiment',50)
        @router.get('/experiments/{identifier}',response_model=ExperimentInfo)
        def detail(identifier:UUID):return self.store.get('MLExperiment',identifier)
        @router.post('/experiments/{identifier}/cancel',response_model=ExperimentInfo)
        def cancel(identifier:UUID):
            job=self.store.get('MLExperiment',identifier);event=self.events.get(str(identifier))
            if event:event.set()
            return job
        @router.delete('/experiments/{identifier}',status_code=204)
        def purge(identifier:UUID):self.purge(identifier)
        @router.get('/models',response_model=list[ModelInfo])
        def models():
            committed={j['id'] for j in self.store.list('MLExperiment') if j['status']=='completed'}
            return [m for m in self.store.list('MLModel') if m['experiment_id'] in committed]
        @router.get('/models/{identifier}',response_model=ModelInfo)
        def model(identifier:UUID):return self.registered_model(identifier)
        @router.post('/models/{identifier}/predict',response_model=PredictionInfo)
        def predict(identifier:UUID,body:PredictRequest):return self.predict(identifier,body)
        @router.get('/predictions',response_model=list[PredictionInfo],response_model_exclude={'__all__':{'rows'}})
        def predictions():return [{**p,'rows':[]} for p in self.store.list('MLPrediction',50)]
        @router.get('/predictions/{identifier}',response_model=PredictionInfo)
        def prediction(identifier:UUID,offset:int=Query(0,ge=0,le=5000),limit:int=Query(50,ge=1,le=100)):
            meta,result=self.prediction(identifier);return {**meta,'rows':result['rows'][offset:offset+limit],'offset':offset}
        @router.get('/predictions/{identifier}/export.csv')
        def export(identifier:UUID):
            meta,result=self.prediction(identifier)
            rows=[[json.dumps(row.get(c),ensure_ascii=False) if isinstance(row.get(c),(dict,list)) else row.get(c) for c in meta['columns']] for row in result['rows']]
            return Response(safe_csv({'columns':[{'name':c} for c in meta['columns']],'rows':rows}),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="insightiq-predictions.csv"'})
        @router.delete('/predictions/{identifier}',status_code=204)
        def delete_prediction(identifier:UUID):
            self.store.get('MLPrediction',identifier);self.owned('predictions',identifier,'.json').unlink(missing_ok=True);self.store.delete('MLPrediction',identifier)
        return router
