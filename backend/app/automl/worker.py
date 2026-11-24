"""Fresh, secret-free local ML process. No user code, executable uploads or providers."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import hashlib,json,os,resource,ctypes,errno
from uuid import UUID
import joblib,numpy as np
from app.automl.contracts import TrainRequest
from app.automl.data import MLFailure,missing,number,moment
from app.automl.engine import train_supervised,train_unsupervised,serial,versions,rfm_data
from app.automl.forecasting import train_forecast,next_period


def limits():
    resource.setrlimit(resource.RLIMIT_CPU,(90,95))
    resource.setrlimit(resource.RLIMIT_FSIZE,(20*1024*1024,20*1024*1024))
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    if sys.platform.startswith('linux'):
        resource.setrlimit(resource.RLIMIT_AS,(1536*1024*1024,1536*1024*1024))
        lib=ctypes.CDLL('libseccomp.so.2',use_errno=True)
        lib.seccomp_init.argtypes=[ctypes.c_uint32];lib.seccomp_init.restype=ctypes.c_void_p
        lib.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p];lib.seccomp_syscall_resolve_name.restype=ctypes.c_int
        lib.seccomp_rule_add.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_int,ctypes.c_uint];lib.seccomp_rule_add.restype=ctypes.c_int
        lib.seccomp_load.argtypes=[ctypes.c_void_p];lib.seccomp_release.argtypes=[ctypes.c_void_p]
        ctx=lib.seccomp_init(0x7fff0000)
        if not ctx:raise MLFailure('ML network sandbox initialization failed.','sandbox_unavailable')
        try:
            for name in ('socket','socketpair','connect','bind','listen','accept','accept4','sendto','recvfrom','sendmsg','recvmsg'):
                code=lib.seccomp_syscall_resolve_name(name.encode())
                if code>=0 and lib.seccomp_rule_add(ctx,0x00050000|errno.EPERM,code,0)!=0:raise MLFailure('ML network sandbox rule failed.','sandbox_unavailable')
            if lib.seccomp_load(ctx)!=0:raise MLFailure('ML network sandbox load failed.','sandbox_unavailable')
        finally:lib.seccomp_release(ctx)
    elif sys.platform=='darwin':
        lib=ctypes.CDLL('/usr/lib/libsandbox.dylib');lib.sandbox_init.argtypes=[ctypes.c_char_p,ctypes.c_uint64,ctypes.POINTER(ctypes.c_char_p)]
        error=ctypes.c_char_p()
        if lib.sandbox_init(b'(version 1)(allow default)(deny network*)(deny process-exec)',0,ctypes.byref(error))!=0:raise MLFailure('ML network sandbox unavailable; use Docker.','sandbox_unavailable')
    else:raise MLFailure('ML worker isolation supports Linux and macOS; use Docker.','sandbox_unavailable')

def predict(request):
    model=request['model'];path=Path(request['artifact']);identifier=str(UUID(model['id']))
    if path.name!=identifier+'.joblib' or path.is_symlink() or not path.is_file() or path.stat().st_size>20*1024*1024:raise MLFailure('Registered model artifact is missing or invalid.','artifact_invalid')
    if hashlib.sha256(path.read_bytes()).hexdigest()!=model['artifact_sha256']:raise MLFailure('Model artifact checksum mismatch.','artifact_invalid')
    if model['versions']!=versions():raise MLFailure('Model library/runtime versions differ. Retrain in this environment.','version_mismatch')
    bundle=joblib.load(path)
    if bundle['versions']!=versions():raise MLFailure('Artifact version mismatch.','version_mismatch')
    pipe=bundle['pipeline'];features=bundle['features'];task=bundle['task'];extra=bundle['extra']
    if task=='forecasting':
        horizon=request['horizon']
        if not horizon or horizon>extra['max_horizon']:raise MLFailure('Forecast horizon must stay within the saved model\'s evaluated horizon.')
        from app.automl.data import moment
        date=moment(extra['last_date']);rows=[]
        for value in pipe.forecast(horizon):
            date=next_period(date,extra['frequency']);rows.append({'date':date.isoformat()[:10],'prediction':float(value)})
        return {'rows':rows,'columns':['date','prediction']}
    records=request['records']
    if bundle['configuration'].get('rfm') and request.get('batch'):
        data,_,_=rfm_data(request['data'],{**bundle['configuration'],'rfm':{**bundle['configuration']['rfm'],'reference_date':extra['reference_date']}})
        records=[dict(zip(data['columns'],r)) for r in data['rows']]
    expected={f['name'] for f in features};matrix=[];contexts=[]
    for record in records:
        if not expected.issubset(record):raise MLFailure('Missing model features: '+', '.join(sorted(expected-set(record))))
        if not request.get('batch') and set(record)!=expected:raise MLFailure('Single-record inputs must contain exactly the saved feature names.')
        row=[];context={}
        for feature in features:
            value=record[feature['name']]
            if isinstance(value,(dict,list,bool)) or isinstance(value,str) and len(value)>512:raise MLFailure('Prediction values must be scalar, at most 512 characters, and compatible with the saved schema.')
            try:
                if feature['kind']=='numeric' and not missing(value):number(value)
                elif feature['kind']=='datetime' and not missing(value):moment(value)
            except (ValueError,TypeError,OverflowError):raise MLFailure('Incompatible type for feature '+feature['name']+'. Use finite numeric or ISO date/time values as configured.','invalid_type')
            row.append(value);context[feature['name']]=value
        matrix.append(row);contexts.append(context)
    x=np.asarray(matrix,dtype=object);values=pipe.predict(x);probabilities=pipe.predict_proba(x) if task=='classification' and hasattr(pipe,'predict_proba') else None
    scores=-pipe.decision_function(x) if task=='anomaly' else None
    profiles={int(p['cluster']):p for p in extra.get('cluster_profiles',[])}
    rows=[]
    for i,value in enumerate(values):
        out={'row_index':i,'features':contexts[i]}
        if task=='classification':out.update(prediction=str(value),probabilities={str(c):float(p) for c,p in zip(pipe.classes_,probabilities[i])} if probabilities is not None else None)
        elif task=='regression':out['prediction']=float(value)
        elif task=='clustering':out.update(cluster=int(value),cluster_profile=profiles.get(int(value)))
        else:out.update(anomaly=bool(value==-1),anomaly_score=float(scores[i]))
        if task=='clustering' and request.get('batch') and bundle['configuration'].get('rfm'):out['customer']=records[i]['customer']
        rows.append(out)
    return {'rows':rows,'columns':list(rows[0]) if rows else []}

def main():
    source=Path(sys.argv[1]);output=Path(sys.argv[2])
    if source.stat().st_size>16*1024*1024:raise MLFailure('Worker request exceeds 16 MiB.','request_limit')
    request=json.loads(source.read_text());limits()
    if request['operation']=='train':
        cfg=TrainRequest.model_validate(request['configuration']).model_dump(mode='json')
        func=train_supervised if cfg['task'] in {'regression','classification'} else train_forecast if cfg['task']=='forecasting' else train_unsupervised
        result=func(request['data'],cfg,request['experiment'],request['models_dir'])
    elif request['operation']=='predict':result=predict(request)
    else:raise MLFailure('Unsupported ML worker operation.')
    encoded=json.dumps(serial(result),allow_nan=False)
    if len(encoded.encode())>8*1024*1024:raise MLFailure('ML output exceeds 8 MiB. Reduce input size.','result_limit')
    output.write_text(encoded);output.chmod(0o600)

if __name__=='__main__':
    try:main()
    except BaseException as exc:
        error=str(exc) if isinstance(exc,MLFailure) else 'Local ML worker failed safely ('+type(exc).__name__+'). Confirm task data/types and installed versions.'
        Path(sys.argv[2]).write_text(json.dumps({'error':error,'code':getattr(exc,'code','training_error')}))
        sys.exit(1)
