"""One-thread, CPU/wall/RSS-bounded, killable local ML process runner."""
import json,os,signal,subprocess,sys,time
from pathlib import Path
from .data import MLFailure
LIMITS={'max_rows':5000,'max_features':24,'max_encoded_features':512,'memory_mib':512,'wall_seconds':120,'cpu_seconds':90,'concurrent_jobs':1,'numerical_threads':1}

def rss_bytes(process):
    if sys.platform.startswith('linux'):
        try:
            for line in Path('/proc/'+str(process.pid)+'/status').read_text().splitlines():
                if line.startswith('VmRSS:'):return int(line.split()[1])*1024
        except (FileNotFoundError,ProcessLookupError):return 0
    elif sys.platform=='darwin':
        result=subprocess.run(['/bin/ps','-o','rss=','-p',str(process.pid)],capture_output=True,text=True,timeout=1,env={'PATH':'/usr/bin:/bin'})
        return int(result.stdout.strip() or 0)*1024
    return 0

def run_process(payload,directory,cancel,timeout=120,memory_mib=512):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    source=directory/'request.json';output=directory/'response.json';encoded=json.dumps(payload,allow_nan=False)
    if len(encoded.encode())>16*1024*1024:raise MLFailure('ML request exceeds 16 MiB.','request_limit')
    source.write_text(encoded);source.chmod(0o600)
    if cancel.is_set():raise MLFailure('ML operation cancelled.','cancelled')
    worker=Path(__file__).with_name('worker.py')
    env={'PATH':'/usr/bin:/bin','OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1','MKL_NUM_THREADS':'1','NUMEXPR_NUM_THREADS':'1','VECLIB_MAXIMUM_THREADS':'1','PYTHONHASHSEED':'0'}
    process=subprocess.Popen([sys.executable,'-I',str(worker),str(source),str(output)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env,cwd='/tmp',start_new_session=True)
    started=time.monotonic()
    try:
        while process.poll() is None:
            if cancel.is_set():raise MLFailure('ML operation cancelled.','cancelled')
            if time.monotonic()-started>timeout:raise MLFailure('ML worker exceeded its wall-clock deadline.','timeout')
            if rss_bytes(process)>memory_mib*1024*1024:raise MLFailure('ML worker exceeded its memory budget.','resource_limit')
            cancel.wait(.2)
        if cancel.is_set():raise MLFailure('ML operation cancelled.','cancelled')
        if time.monotonic()-started>timeout:raise MLFailure('ML worker exceeded its wall-clock deadline.','timeout')
        if not output.is_file() or output.stat().st_size>8*1024*1024:raise MLFailure('ML worker exited or exceeded its CPU/output resource budget.','resource_limit')
        result=json.loads(output.read_text())
        if 'error' in result:raise MLFailure(result['error'],result.get('code','training_error'))
        return result
    finally:
        if process.poll() is None:
            try:os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError:pass
        process.wait()
        source.unlink(missing_ok=True)
